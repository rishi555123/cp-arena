import { DEFAULT_CONFIG } from "@cp-arena/scoring";
import { describe, expect, it } from "vitest";
import { addDays, powerForDay } from "../src/scores";

const snap = (day: string, weightedSolved: number, rating: number | null = 1500, percentile: number | null = 0.5) => ({ day, rating, percentile, weightedSolved });

describe("powerForDay", () => {
  it("returns null before any account has synced", () => {
    expect(powerForDay({ accounts: [{ platform: "leetcode", snaps: [snap("2026-06-10", 10)], results: [] }] }, "2026-06-01", DEFAULT_CONFIG)).toBeNull();
  });

  it("counts weighted solves gained inside the 28-day window only", () => {
    const m = { accounts: [{ platform: "leetcode" as const, snaps: [snap("2026-05-01", 100), snap("2026-06-01", 100), snap("2026-06-20", 130)], results: [] }] };
    const r = powerForDay(m, "2026-06-25", DEFAULT_CONFIG)!;
    expect(r.components.momentumInput.weightedSolves).toBe(30);
    expect(r.components.weightedSolves).toBe(130);
  });

  it("doesn't treat a newly linked account's whole history as momentum", () => {
    const m = { accounts: [{ platform: "codeforces" as const, snaps: [snap("2026-06-20", 900), snap("2026-06-24", 912)], results: [] }] };
    expect(powerForDay(m, "2026-06-25", DEFAULT_CONFIG)!.components.momentumInput.weightedSolves).toBe(12);
  });

  it("counts contests in the window and ignores rating losses", () => {
    const at = (d: string) => new Date(`${d}T14:30:00Z`);
    const m = {
      accounts: [
        {
          platform: "codechef" as const,
          snaps: [snap("2026-05-01", 0)],
          results: [
            { startTime: at("2026-05-10"), oldRating: 1500, newRating: 1600 }, // outside window
            { startTime: at("2026-06-10"), oldRating: 1600, newRating: 1650 },
            { startTime: at("2026-06-17"), oldRating: 1650, newRating: 1600 },
            { startTime: at("2026-06-24"), oldRating: null, newRating: null }, // pending
          ],
        },
      ],
    };
    const r = powerForDay(m, "2026-06-25", DEFAULT_CONFIG)!;
    expect(r.components.momentumInput.contests).toBe(3);
    expect(r.components.momentumInput.ratingGain).toBe(50);
  });

  it("treats an unrated platform as missing, not zero", () => {
    const rated = { accounts: [{ platform: "leetcode" as const, snaps: [snap("2026-06-01", 0, 1800, 0.9)], results: [] }] };
    const plusUnrated = { accounts: [...rated.accounts, { platform: "codechef" as const, snaps: [snap("2026-06-01", 0, null, null)], results: [] }] };
    expect(powerForDay(plusUnrated, "2026-06-02", DEFAULT_CONFIG)!.components.contest).toBe(powerForDay(rated, "2026-06-02", DEFAULT_CONFIG)!.components.contest);
  });

  it("addDays crosses month boundaries in UTC", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
