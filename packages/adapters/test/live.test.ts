/**
 * Live smoke tests — hit the real sites. Run with `npm run test:live` (sets LIVE=1).
 * Run these from the production host on day 0: datacenter IPs are often blocked by LeetCode.
 */
import { describe, expect, it } from "vitest";
import { CodechefAdapter, CodeforcesAdapter, LeetcodeAdapter } from "../src";

const live = process.env.LIVE === "1";

describe.skipIf(!live)("live smoke", () => {
  it("codeforces", async () => {
    const p = await new CodeforcesAdapter().getProfile("tourist");
    expect(p.rating).toBeGreaterThan(0);
  });
  it("leetcode", async () => {
    const p = await new LeetcodeAdapter().getProfile("lee215");
    expect(p.rating).toBeGreaterThan(0);
  });
  it("codechef", async () => {
    const p = await new CodechefAdapter().getProfile("gennady.korotkevich");
    expect(p.rating).toBeGreaterThan(0);
  });
});
