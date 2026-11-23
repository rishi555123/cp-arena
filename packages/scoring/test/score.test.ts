import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  cfBucketKey,
  cfProblemWeight,
  codechefWeighted,
  codeforcesWeighted,
  computePower,
  contestStrength,
  divisionFor,
  estimateGains,
  leetcodePercentile,
  leetcodeWeighted,
  momentumPoints,
  percentileFromDistribution,
  percentileFromTable,
  percentileToPoints,
  positiveRatingGain,
  problemPoints,
  rankEntries,
  rankPercentile,
  tierFor,
} from "../src";

describe("percentileToPoints", () => {
  it("matches the documented anchors", () => {
    expect(percentileToPoints(0.9)).toBeCloseTo(333.33, 1);
    expect(percentileToPoints(0.99)).toBeCloseTo(666.67, 1);
    expect(percentileToPoints(0.999)).toBeCloseTo(1000, 5);
  });
  it("is 0 at the bottom, capped at 1000, and monotonic", () => {
    expect(percentileToPoints(0)).toBe(0);
    expect(percentileToPoints(-1)).toBe(0);
    expect(percentileToPoints(1)).toBe(1000);
    expect(percentileToPoints(0.99999)).toBe(1000);
    let prev = -1;
    for (let p = 0; p < 0.999; p += 0.01) {
      const v = percentileToPoints(p);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
  it("handles NaN defensively", () => {
    expect(percentileToPoints(Number.NaN)).toBe(0);
  });
});

describe("platform percentiles", () => {
  it("LeetCode uses 1 − topPercentage/100", () => {
    expect(leetcodePercentile(0.9)).toBeCloseTo(0.991);
    expect(leetcodePercentile(50)).toBeCloseTo(0.5);
    expect(leetcodePercentile(120)).toBe(0);
  });
  it("rank percentile", () => {
    expect(rankPercentile(100, 10_000)).toBeCloseTo(0.99);
    expect(rankPercentile(1, 0)).toBe(0);
  });
  it("interpolates the fallback table", () => {
    const t: [number, number][] = [
      [0, 0],
      [1000, 0.5],
      [2000, 0.9],
    ];
    expect(percentileFromTable(500, t)).toBeCloseTo(0.25);
    expect(percentileFromTable(1500, t)).toBeCloseTo(0.7);
    expect(percentileFromTable(5000, t)).toBe(0.9);
    expect(percentileFromTable(-10, t)).toBe(0);
  });
  it("counts users strictly below in a sorted distribution", () => {
    const d = [1000, 1200, 1200, 1500, 2000];
    expect(percentileFromDistribution(1200, d)).toBeCloseTo(0.2);
    expect(percentileFromDistribution(1201, d)).toBeCloseTo(0.6);
    expect(percentileFromDistribution(9999, d)).toBe(1);
    expect(percentileFromDistribution(1, [])).toBe(0);
  });
});

describe("contestStrength", () => {
  it("renormalises over rated platforms — unrated is not zero", () => {
    const onlyCf = contestStrength({ codeforces: 0.99 });
    expect(onlyCf.points).toBeCloseTo(666.67, 1);
    const cfAndMissing = contestStrength({ codeforces: 0.99, leetcode: null, codechef: undefined });
    expect(cfAndMissing.points).toBeCloseTo(onlyCf.points, 6);
  });
  it("uses default platform weights 0.40/0.35/0.25", () => {
    const r = contestStrength({ codeforces: 0.9, leetcode: 0.99, codechef: 0.999 });
    const expected = (0.4 * 333.333 + 0.35 * 666.667 + 0.25 * 1000) / 1.0;
    expect(r.points).toBeCloseTo(expected, 1);
    expect(r.perPlatform.codechef).toBe(1000);
  });
  it("is 0 when unrated everywhere", () => {
    expect(contestStrength({}).points).toBe(0);
  });
});

describe("problem solving", () => {
  it("weights LeetCode difficulties 1/3/6", () => {
    expect(leetcodeWeighted({ easy: 10, medium: 10, hard: 10 })).toBe(100);
  });
  it("buckets Codeforces problem ratings", () => {
    expect(cfBucketKey(800)).toBe("<=1100");
    expect(cfBucketKey(1100)).toBe("<=1100");
    expect(cfBucketKey(1200)).toBe("1200-1500");
    expect(cfBucketKey(1900)).toBe("1600-1900");
    expect(cfBucketKey(2300)).toBe("2000-2300");
    expect(cfBucketKey(3500)).toBe(">=2400");
    expect(cfBucketKey(undefined)).toBe("unrated");
    expect([800, 1300, 1700, 2100, 2500, null].map((r) => cfProblemWeight(r))).toEqual([1, 2, 3, 5, 8, 1]);
    expect(codeforcesWeighted({ "<=1100": 2, ">=2400": 1, unrated: 3 })).toBe(2 + 8 + 3);
  });
  it("gives CodeChef 2 per solve", () => {
    expect(codechefWeighted(50)).toBe(100);
  });
  it("has diminishing returns and caps at 1000", () => {
    expect(problemPoints(0)).toBe(0);
    expect(problemPoints(1000)).toBeCloseTo(500);
    expect(problemPoints(4000)).toBe(1000);
    expect(problemPoints(40_000)).toBe(1000);
    // doubling W gives ~1.41× not 2×
    expect(problemPoints(800) / problemPoints(400)).toBeCloseTo(Math.SQRT2);
  });
});

describe("momentum", () => {
  it("adds 60/contest + 1/rating point + 4/weighted solve, capped at 1000", () => {
    expect(momentumPoints({ contests: 2, ratingGain: 30, weightedSolves: 10 })).toBe(120 + 30 + 40);
    expect(momentumPoints({ contests: 50, ratingGain: 0, weightedSolves: 0 })).toBe(1000);
  });
  it("ignores rating losses", () => {
    expect(positiveRatingGain([50, -80, null, 10])).toBe(60);
    expect(momentumPoints({ contests: 1, ratingGain: -100, weightedSolves: 0 })).toBe(60);
  });
});

describe("computePower", () => {
  it("combines 0.5A + 0.3B + 0.2C and stays in 0..1000", () => {
    const r = computePower({
      percentiles: { codeforces: 0.99 },
      weightedSolves: 4000,
      momentum: { contests: 100, ratingGain: 0, weightedSolves: 0 },
    });
    expect(r.components.contest).toBeCloseTo(666.7, 1);
    expect(r.components.problems).toBe(1000);
    expect(r.components.momentum).toBe(1000);
    expect(r.power).toBeCloseTo(0.5 * 666.67 + 300 + 200, 0);
    expect(r.formulaVersion).toBe(DEFAULT_CONFIG.version);

    const max = computePower({
      percentiles: { codeforces: 1, leetcode: 1, codechef: 1 },
      weightedSolves: 1e9,
      momentum: { contests: 1e9, ratingGain: 1e9, weightedSolves: 1e9 },
    });
    expect(max.power).toBe(1000);
    const min = computePower({ percentiles: {}, weightedSolves: 0, momentum: { contests: 0, ratingGain: 0, weightedSolves: 0 } });
    expect(min.power).toBe(0);
  });

  it("a single contest can't swing Power by more than ~one division band", () => {
    const base = { percentiles: { leetcode: 0.7 }, weightedSolves: 600, momentum: { contests: 0, ratingGain: 0, weightedSolves: 0 } };
    const after = { ...base, percentiles: { leetcode: 0.8 }, momentum: { contests: 1, ratingGain: 80, weightedSolves: 12 } };
    const delta = computePower(after).power - computePower(base).power;
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(100);
  });
});

describe("divisions and ranking", () => {
  it("maps Power to bands", () => {
    expect(divisionFor(0)).toBe("Bronze");
    expect(divisionFor(999)).toBe("Diamond");
    const names = DEFAULT_CONFIG.divisions.map((d) => divisionFor(d.min));
    expect(names).toEqual(DEFAULT_CONFIG.divisions.map((d) => d.name));
  });
  it("breaks ties by momentum, then earliest reachedAt", () => {
    const t = (s: string) => new Date(s);
    const ranked = rankEntries([
      { userId: "a", power: 500, momentum: 100, reachedAt: t("2026-01-02") },
      { userId: "b", power: 500, momentum: 200, reachedAt: t("2026-01-03") },
      { userId: "c", power: 500, momentum: 100, reachedAt: t("2026-01-01") },
      { userId: "d", power: 600, momentum: 0, reachedAt: t("2026-01-05") },
    ]);
    expect(ranked.map((r) => r.userId)).toEqual(["d", "b", "c", "a"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });
});

describe("estimateGains", () => {
  it("prices one contest at 0.2 × 60 when momentum isn't capped", () => {
    const e = estimateGains({ momentum: 0, weightedSolves: 100, momentumInput: { contests: 0, ratingGain: 0, weightedSolves: 0 } });
    expect(e[0].gain).toBe(12);
    expect(e[1].gain).toBe(18);
    expect(e[2].gain).toBeGreaterThan(12); // problems + momentum
  });
  it("is 0 for momentum-only actions when momentum is capped", () => {
    const e = estimateGains({ momentum: 1000, weightedSolves: 100, momentumInput: { contests: 30, ratingGain: 0, weightedSolves: 0 } });
    expect(e[0].gain).toBe(0);
  });
});

describe("tiers", () => {
  it("labels ratings", () => {
    expect(tierFor("codeforces", 1650)).toBe("Expert");
    expect(tierFor("codeforces", 3408)).toBe("Legendary Grandmaster");
    expect(tierFor("codechef", 1799)).toBe("3★");
    expect(tierFor("leetcode", 2204)).toBe("Guardian");
    expect(tierFor("leetcode", null)).toBeNull();
  });
});
