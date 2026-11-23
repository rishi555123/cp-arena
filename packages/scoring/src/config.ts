export type Platform = "codeforces" | "leetcode" | "codechef";
export const PLATFORMS: Platform[] = ["codeforces", "leetcode", "codechef"];

/** [rating, percentile] pairs, ascending by rating. Percentile = share of active rated users below. */
export type PercentileTable = [number, number][];

export interface DivisionBand {
  name: string;
  /** inclusive lower bound on Power */
  min: number;
}

export interface ScoringConfig {
  version: string;
  weights: { contest: number; problems: number; momentum: number };
  platformWeights: Record<Platform, number>;
  /** p → points curve: 1000 × min(1, −log10(1 − p) / decades) */
  contestDecades: number;
  lcWeights: { easy: number; medium: number; hard: number };
  /** Codeforces problem-rating buckets. `max: null` = open-ended. */
  cfBuckets: { key: string; max: number | null; weight: number }[];
  cfUnratedWeight: number;
  ccPerSolve: number;
  /** Problem points = 1000 × min(1, sqrt(W / problemsScale)) */
  problemsScale: number;
  momentum: {
    windowDays: number;
    perContest: number;
    perRatingPoint: number;
    perWeightedSolve: number;
    cap: number;
  };
  /** Ordered high → low. */
  divisions: DivisionBand[];
  /** Fallback when user.ratedList is unavailable. Approximate, see docs/SCORING.md. */
  cfPercentileTable: PercentileTable;
  /** CodeChef publishes no reliable total-rated count on the profile page. Approximate. */
  ccPercentileTable: PercentileTable;
}

export const DEFAULT_CONFIG: ScoringConfig = {
  version: "v1",
  weights: { contest: 0.5, problems: 0.3, momentum: 0.2 },
  platformWeights: { codeforces: 0.4, leetcode: 0.35, codechef: 0.25 },
  contestDecades: 3,
  lcWeights: { easy: 1, medium: 3, hard: 6 },
  cfBuckets: [
    { key: "<=1100", max: 1100, weight: 1 },
    { key: "1200-1500", max: 1500, weight: 2 },
    { key: "1600-1900", max: 1900, weight: 3 },
    { key: "2000-2300", max: 2300, weight: 5 },
    { key: ">=2400", max: null, weight: 8 },
  ],
  cfUnratedWeight: 1,
  ccPerSolve: 2,
  problemsScale: 4000,
  momentum: { windowDays: 28, perContest: 60, perRatingPoint: 1, perWeightedSolve: 4, cap: 1000 },
  // Calibrated against the seed population so each band holds ~15–30% at launch.
  // Re-check against real members before announcing (docs/SCORING.md#divisions).
  divisions: [
    { name: "Diamond", min: 470 },
    { name: "Platinum", min: 420 },
    { name: "Gold", min: 365 },
    { name: "Silver", min: 320 },
    { name: "Bronze", min: 0 },
  ],
  // Rough shape of the active-rated CF population (2024–2026). Replace with the
  // live user.ratedList distribution when the weekly refresh job lands.
  cfPercentileTable: [
    [0, 0],
    [800, 0.12],
    [1000, 0.28],
    [1200, 0.5],
    [1400, 0.72],
    [1600, 0.86],
    [1900, 0.95],
    [2100, 0.98],
    [2300, 0.992],
    [2400, 0.995],
    [2600, 0.998],
    [3000, 0.9995],
    [3500, 0.99995],
  ],
  ccPercentileTable: [
    [0, 0],
    [1000, 0.15],
    [1400, 0.55],
    [1600, 0.78],
    [1800, 0.9],
    [2000, 0.96],
    [2200, 0.985],
    [2500, 0.997],
    [2800, 0.9995],
    [3300, 0.99995],
  ],
};
