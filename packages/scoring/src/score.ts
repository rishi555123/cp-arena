import { DEFAULT_CONFIG, PLATFORMS, type Platform, type PercentileTable, type ScoringConfig } from "./config";

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

// ---------- A) Contest strength ----------

/** 1000 × min(1, −log10(1 − p) / decades). p=0.9 → 333, p=0.99 → 667, p=0.999 → 1000. */
export function percentileToPoints(p: number, decades = DEFAULT_CONFIG.contestDecades): number {
  if (!Number.isFinite(p) || p <= 0) return 0;
  if (p >= 1) return 1000;
  return 1000 * Math.min(1, -Math.log10(1 - p) / decades);
}

/** LeetCode reports topPercentage (e.g. 0.9 means top 0.9%). */
export function leetcodePercentile(topPercentage: number): number {
  return clamp(1 - topPercentage / 100, 0, 1);
}

/** CodeChef when global rank and total rated are both known. */
export function rankPercentile(globalRank: number, totalRanked: number): number {
  if (totalRanked <= 0) return 0;
  return clamp(1 - globalRank / totalRanked, 0, 1);
}

/** Linear interpolation over a [rating, percentile] table. */
export function percentileFromTable(rating: number, table: PercentileTable): number {
  if (table.length === 0) return 0;
  if (rating <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [r1, p1] = table[i];
    if (rating <= r1) {
      const [r0, p0] = table[i - 1];
      return p0 + ((rating - r0) / (r1 - r0)) * (p1 - p0);
    }
  }
  return table[table.length - 1][1];
}

/** Share of active rated users strictly below `rating`. `sortedRatings` must be ascending. */
export function percentileFromDistribution(rating: number, sortedRatings: number[]): number {
  if (sortedRatings.length === 0) return 0;
  let lo = 0;
  let hi = sortedRatings.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedRatings[mid] < rating) lo = mid + 1;
    else hi = mid;
  }
  return lo / sortedRatings.length;
}

export interface ContestStrength {
  points: number;
  /** per-platform points for platforms where the member is rated */
  perPlatform: Partial<Record<Platform, number>>;
}

/** Weighted average over rated platforms only; unrated platforms are dropped and weights renormalised. */
export function contestStrength(
  percentiles: Partial<Record<Platform, number | null>>,
  config: ScoringConfig = DEFAULT_CONFIG,
): ContestStrength {
  const perPlatform: Partial<Record<Platform, number>> = {};
  let num = 0;
  let den = 0;
  for (const platform of PLATFORMS) {
    const p = percentiles[platform];
    if (p == null) continue;
    const pts = percentileToPoints(p, config.contestDecades);
    perPlatform[platform] = round1(pts);
    num += pts * config.platformWeights[platform];
    den += config.platformWeights[platform];
  }
  return { points: den > 0 ? num / den : 0, perPlatform };
}

// ---------- B) Problem solving ----------

export interface LeetcodeSolved {
  easy: number;
  medium: number;
  hard: number;
}

/** Codeforces solved counts keyed by bucket key from config.cfBuckets, plus `unrated`. */
export type CodeforcesSolved = Record<string, number>;

export function cfProblemWeight(problemRating: number | null | undefined, config: ScoringConfig = DEFAULT_CONFIG): number {
  return config.cfBuckets.find((b) => b.key === cfBucketKey(problemRating, config))?.weight ?? config.cfUnratedWeight;
}

/** CF ratings move in steps of 100, so "≤1100" and "1200–1500" are contiguous. */
export function cfBucketKey(problemRating: number | null | undefined, config: ScoringConfig = DEFAULT_CONFIG): string {
  if (problemRating == null) return "unrated";
  for (const b of config.cfBuckets) if (b.max == null || problemRating <= b.max) return b.key;
  return config.cfBuckets[config.cfBuckets.length - 1].key;
}

export function leetcodeWeighted(s: LeetcodeSolved, config: ScoringConfig = DEFAULT_CONFIG): number {
  return s.easy * config.lcWeights.easy + s.medium * config.lcWeights.medium + s.hard * config.lcWeights.hard;
}

export function codeforcesWeighted(s: CodeforcesSolved, config: ScoringConfig = DEFAULT_CONFIG): number {
  let w = 0;
  for (const [key, count] of Object.entries(s)) {
    if (key === "unrated") w += count * config.cfUnratedWeight;
    else w += count * (config.cfBuckets.find((b) => b.key === key)?.weight ?? config.cfUnratedWeight);
  }
  return w;
}

export function codechefWeighted(total: number, config: ScoringConfig = DEFAULT_CONFIG): number {
  return total * config.ccPerSolve;
}

/** 1000 × min(1, sqrt(W / scale)) — diminishing returns so easy-problem farming can't dominate. */
export function problemPoints(weightedSolves: number, config: ScoringConfig = DEFAULT_CONFIG): number {
  if (weightedSolves <= 0) return 0;
  return 1000 * Math.min(1, Math.sqrt(weightedSolves / config.problemsScale));
}

// ---------- C) Momentum ----------

export interface MomentumInput {
  /** contests entered in the window, all platforms */
  contests: number;
  /** sum of positive rating deltas in the window (losses ignored by caller or here) */
  ratingGain: number;
  /** weighted solves gained in the window */
  weightedSolves: number;
}

export function momentumPoints(m: MomentumInput, config: ScoringConfig = DEFAULT_CONFIG): number {
  const c = config.momentum;
  const raw =
    Math.max(0, m.contests) * c.perContest +
    Math.max(0, m.ratingGain) * c.perRatingPoint +
    Math.max(0, m.weightedSolves) * c.perWeightedSolve;
  return Math.min(c.cap, raw);
}

/** Sum of positive deltas only: losses never subtract. */
export function positiveRatingGain(deltas: (number | null | undefined)[]): number {
  return deltas.reduce<number>((s, d) => s + (d != null && d > 0 ? d : 0), 0);
}

// ---------- Power ----------

export interface PowerInput {
  percentiles: Partial<Record<Platform, number | null>>;
  weightedSolves: number;
  momentum: MomentumInput;
}

export interface PowerComponents {
  contest: number;
  problems: number;
  momentum: number;
  perPlatformContest: Partial<Record<Platform, number>>;
  weightedSolves: number;
  momentumInput: MomentumInput;
}

export interface PowerResult {
  power: number;
  components: PowerComponents;
  formulaVersion: string;
}

export function computePower(input: PowerInput, config: ScoringConfig = DEFAULT_CONFIG): PowerResult {
  const cs = contestStrength(input.percentiles, config);
  const pp = problemPoints(input.weightedSolves, config);
  const mp = momentumPoints(input.momentum, config);
  const w = config.weights;
  const power = w.contest * cs.points + w.problems * pp + w.momentum * mp;
  return {
    power: round1(power),
    components: {
      contest: round1(cs.points),
      problems: round1(pp),
      momentum: round1(mp),
      perPlatformContest: cs.perPlatform,
      weightedSolves: round1(input.weightedSolves),
      momentumInput: input.momentum,
    },
    formulaVersion: config.version,
  };
}

// ---------- Glue used by the worker and the seed ----------

export type SolvedBreakdownLike =
  | { kind: "leetcode"; easy: number; medium: number; hard: number }
  | { kind: "codeforces"; buckets: Record<string, number> }
  | { kind: "codechef"; total: number };

export function weightedFromBreakdown(b: SolvedBreakdownLike, config: ScoringConfig = DEFAULT_CONFIG): number {
  switch (b.kind) {
    case "leetcode":
      return leetcodeWeighted(b, config);
    case "codeforces":
      return codeforcesWeighted(b.buckets, config);
    case "codechef":
      return codechefWeighted(b.total, config);
  }
}

export interface PercentileInput {
  rating: number | null;
  /** platform-reported percentile (LeetCode) */
  percentile?: number | null;
  globalRank?: number | null;
  totalRanked?: number | null;
}

/**
 * Global percentile for one platform, or null when the member is unrated there.
 * CF: live ratedList distribution if supplied, else the fallback table.
 * CC: rank/total if both known, else the fallback table.
 */
export function platformPercentile(
  platform: Platform,
  input: PercentileInput,
  config: ScoringConfig = DEFAULT_CONFIG,
  cfDistribution?: number[],
): number | null {
  if (input.rating == null) return null;
  switch (platform) {
    case "leetcode":
      return input.percentile ?? null;
    case "codeforces":
      return cfDistribution?.length ? percentileFromDistribution(input.rating, cfDistribution) : percentileFromTable(input.rating, config.cfPercentileTable);
    case "codechef":
      return input.globalRank && input.totalRanked ? rankPercentile(input.globalRank, input.totalRanked) : percentileFromTable(input.rating, config.ccPercentileTable);
  }
}

// ---------- Divisions & ranking ----------

export function divisionFor(power: number, config: ScoringConfig = DEFAULT_CONFIG): string {
  for (const d of config.divisions) if (power >= d.min) return d.name;
  return config.divisions[config.divisions.length - 1].name;
}

export interface RankEntry {
  userId: string;
  power: number;
  momentum: number;
  /** when the member first reached their current Power (earlier wins ties) */
  reachedAt: Date;
}

/**
 * Tie-breakers: higher Power, then higher momentum, then whoever reached the score first,
 * then userId for determinism. Returns entries with 1-based unique ranks.
 */
export function rankEntries<T extends RankEntry>(entries: T[]): (T & { rank: number })[] {
  return [...entries]
    .sort(
      (a, b) =>
        b.power - a.power ||
        b.momentum - a.momentum ||
        a.reachedAt.getTime() - b.reachedAt.getTime() ||
        a.userId.localeCompare(b.userId),
    )
    .map((e, i) => ({ ...e, rank: i + 1 }));
}
