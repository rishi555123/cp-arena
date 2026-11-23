import { describe, expect, it } from "vitest";
import { generateVerifyToken, parseProfileInput } from "../src/parse";

const ok = (platform: Parameters<typeof parseProfileInput>[0], input: string) => {
  const r = parseProfileInput(platform, input);
  if (!r.ok) throw new Error(`expected ok for ${input}: ${r.error}`);
  return r.handle;
};
const err = (platform: Parameters<typeof parseProfileInput>[0], input: string) => {
  const r = parseProfileInput(platform, input);
  if (r.ok) throw new Error(`expected error for ${input}`);
  return r.error;
};

describe("parseProfileInput", () => {
  it("parses LeetCode URL shapes", () => {
    expect(ok("leetcode", "https://leetcode.com/u/lee215/")).toBe("lee215");
    expect(ok("leetcode", "leetcode.com/u/lee215")).toBe("lee215");
    expect(ok("leetcode", "https://leetcode.com/lee215/")).toBe("lee215");
    expect(ok("leetcode", "https://www.leetcode.com/u/some_user-1/?tab=x")).toBe("some_user-1");
  });
  it("rejects leetcode.cn with a clear message", () => {
    expect(err("leetcode", "https://leetcode.cn/u/someone/")).toMatch(/leetcode\.cn/);
  });
  it("rejects non-profile LeetCode paths", () => {
    expect(err("leetcode", "https://leetcode.com/problems/two-sum/")).toMatch(/Couldn't find a handle/);
    expect(err("leetcode", "leetcode.com")).toMatch(/Couldn't find a handle/);
  });
  it("parses Codeforces and CodeChef URLs", () => {
    expect(ok("codeforces", "https://codeforces.com/profile/tourist")).toBe("tourist");
    expect(ok("codeforces", "codeforces.com/profile/Benq/")).toBe("Benq");
    expect(ok("codechef", "https://www.codechef.com/users/gennady.korotkevich")).toBe("gennady.korotkevich");
    expect(err("codeforces", "https://codeforces.com/contest/1")).toMatch(/profile/);
  });
  it("accepts raw handles, including dotted ones", () => {
    expect(ok("codeforces", "  tourist ")).toBe("tourist");
    expect(ok("codechef", "gennady.korotkevich")).toBe("gennady.korotkevich");
    expect(ok("leetcode", "@lee215")).toBe("lee215");
  });
  it("rejects garbage and cross-platform links", () => {
    expect(err("codeforces", "")).toMatch(/Enter/);
    expect(err("codeforces", "bad handle!")).toMatch(/valid handle/);
    expect(err("codeforces", "https://leetcode.com/u/lee215")).toMatch(/leetcode\.com link/);
    expect(err("codechef", "https://example.com/users/x")).toMatch(/Unrecognised/);
  });
});

describe("generateVerifyToken", () => {
  it("is short and unambiguous", () => {
    const t = generateVerifyToken();
    expect(t).toMatch(/^CPA-[A-HJ-NP-Z2-9]{6}$/);
  });
});
