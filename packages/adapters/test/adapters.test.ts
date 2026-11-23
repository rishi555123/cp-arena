import { describe, expect, it } from "vitest";
import { AdapterError, CodechefAdapter, CodeforcesAdapter, LeetcodeAdapter, parseCodechefProfile } from "../src";
import { fakeClient, fixture, respond } from "./helpers";

describe("CodeforcesAdapter (recorded fixtures)", () => {
  const cf = new CodeforcesAdapter(
    fakeClient("codeforces", (url) => {
      if (url.includes("user.info")) return respond(fixture("cf_info.json"));
      if (url.includes("user.rating")) return respond(fixture("cf_rating.json"));
      if (url.includes("user.status")) return respond(fixture("cf_status.json"));
      if (url.includes("contest.list")) return respond(fixture("cf_contests.json"));
      return respond(JSON.stringify({ status: "FAILED", comment: "handles: User with handle nobody not found" }), 400);
    }),
  );

  it("maps user.info", async () => {
    const p = await cf.getProfile("tourist");
    expect(p.handle).toBe("tourist");
    expect(p.rating).toBeGreaterThan(3000);
    expect(p.maxRating).toBeGreaterThanOrEqual(p.rating!);
    expect(p.displayName).toContain("Gennady");
    expect(p.percentile).toBeNull();
  });

  it("builds rating history with in-contest solves", async () => {
    const h = await cf.getRatingHistory("Benq");
    expect(h.length).toBeGreaterThan(100);
    const last = h[h.length - 1];
    expect(last.contestId).toBe("2262");
    expect(last.oldRating).toBe(3857);
    expect(last.newRating).toBe(3676);
    expect(last.solved).not.toBeNull();
  });

  it("counts unique accepted problems by rating bucket", async () => {
    const s = await cf.getSolvedStats("Benq");
    expect(s.breakdown.kind).toBe("codeforces");
    const sum = Object.values((s.breakdown as { buckets: Record<string, number> }).buckets).reduce((a, b) => a + b, 0);
    expect(sum).toBe(s.total);
  });

  it("lists upcoming contests only", async () => {
    const c = await cf.getUpcomingContests();
    const before = JSON.parse(fixture("cf_contests.json")).result.filter((x: { phase: string }) => x.phase === "BEFORE").length;
    expect(before).toBeGreaterThan(0);
    expect(c.length).toBe(before);
    expect(c[0].url).toMatch(/codeforces\.com\/contests\/\d+/);
  });

  it("maps 'not found' to not_found", async () => {
    const bad = new CodeforcesAdapter(fakeClient("codeforces", () => respond(JSON.stringify({ status: "FAILED", comment: "handles: User with handle nobody not found" }), 400)));
    await expect(bad.getProfile("nobody")).rejects.toMatchObject({ kind: "not_found" });
  });

  it("verifies a token in the first name", async () => {
    const v = new CodeforcesAdapter(
      fakeClient("codeforces", () => respond(JSON.stringify({ status: "OK", result: [{ handle: "x", firstName: "cpa-ab12cd Bob" }] }))),
    );
    expect((await v.verifyToken("x", "CPA-AB12CD")).ok).toBe(true);
    expect((await v.verifyToken("x", "CPA-ZZZZZZ")).ok).toBe(false);
  });
});

describe("LeetcodeAdapter (recorded fixtures)", () => {
  const lc = new LeetcodeAdapter(
    fakeClient("leetcode", (_url, init) => {
      const q = JSON.parse(String(init?.body)).query as string;
      if (q.includes("userContestRankingHistory")) return respond(fixture("lc_hist.json"));
      if (q.includes("topTwoContests")) return respond(fixture("lc_upcoming.json"));
      if (q.includes("userCalendar")) return respond(fixture("lc_hist.json"));
      // profile + solved share the recorded profile payload
      return respond(fixture("lc_profile.json"));
    }),
  );

  it("maps contest ranking to a percentile", async () => {
    const p = await lc.getProfile("lee215");
    expect(p.rating).toBe(2204);
    expect(p.percentile).toBeCloseTo(0.991, 3);
    expect(p.tier).toBe("Guardian");
  });

  it("returns attended contests with old/new rating", async () => {
    const h = await lc.getRatingHistory("lee215");
    expect(h.length).toBeGreaterThan(0);
    const last = h[h.length - 1];
    expect(last.newRating).toBe(2204);
    expect(last.contestId).toBe("weekly-contest-416");
    expect(last.solved).toBe(4);
  });

  it("reads solved stats by difficulty", async () => {
    const s = await lc.getSolvedStats("lee215");
    expect(s.breakdown).toEqual({ kind: "leetcode", easy: 128, medium: 426, hard: 155 });
    expect(s.total).toBe(709);
  });

  it("reads the submission calendar", async () => {
    const a = await lc.getRecentActivity("lee215", new Date(0));
    expect(a.measure).toBe("submissions");
    expect(a.days.length).toBeGreaterThan(0);
  });

  it("detects Cloudflare HTML as blocked", async () => {
    const blocked = new LeetcodeAdapter(fakeClient("leetcode", () => respond("<html>Just a moment...</html>", 403, "text/html")));
    const e = await blocked.getProfile("x").catch((err) => err);
    expect(e).toBeInstanceOf(AdapterError);
    expect(e.kind).toBe("blocked");
  });

  it("opens the circuit after repeated failures", async () => {
    const blocked = new LeetcodeAdapter(fakeClient("leetcode", () => respond("<html/>", 403, "text/html")));
    for (let i = 0; i < 3; i++) await blocked.getProfile("x").catch(() => undefined);
    await expect(blocked.getProfile("x")).rejects.toMatchObject({ kind: "circuit_open" });
  });

  it("maps a null matchedUser to not_found", async () => {
    const none = new LeetcodeAdapter(fakeClient("leetcode", () => respond(JSON.stringify({ data: { matchedUser: null, userContestRanking: null } }))));
    await expect(none.getProfile("ghost")).rejects.toMatchObject({ kind: "not_found" });
  });
});

describe("CodechefAdapter (recorded fixtures)", () => {
  it("parses the profile page", () => {
    const p = parseCodechefProfile(fixture("cc_profile.html"));
    expect(p.name).toBe("Gennady Korotkevich");
    expect(p.rating).toBe(3355);
    expect(p.highestRating).toBe(3445);
    expect(p.stars).toBe(7);
    expect(p.globalRank).toBeNull(); // "Inactive"
    expect(p.totalSolved).toBe(632);
    expect(p.history.length).toBeGreaterThan(10);
    expect(p.history[0].code).toBe("JAN10");
  });

  it("throws a parse error when markers are missing", () => {
    expect(() => parseCodechefProfile("<html><body>new layout</body></html>")).toThrow(/parse/);
  });

  it("treats the home-page redirect as not_found", async () => {
    const cc = new CodechefAdapter(fakeClient("codechef", () => respond("", 302, "text/html")));
    await expect(cc.getProfile("nobody")).rejects.toMatchObject({ kind: "not_found" });
  });

  it("maps upcoming contests", async () => {
    const cc = new CodechefAdapter(fakeClient("codechef", () => respond(fixture("cc_contests.json"))));
    const c = await cc.getUpcomingContests();
    expect(c.length).toBeGreaterThan(0);
    expect(c[0].durationSeconds).toBeGreaterThan(0);
  });

  it("builds history and profile", async () => {
    const cc = new CodechefAdapter(fakeClient("codechef", () => respond(fixture("cc_profile.html"), 200, "text/html")));
    const p = await cc.getProfile("gennady.korotkevich");
    expect(p.tier).toBe("7★");
    const h = await cc.getRatingHistory("gennady.korotkevich");
    expect(h[1].oldRating).toBe(h[0].newRating);
  });
});
