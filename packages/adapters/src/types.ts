import type { Platform } from "@cp-arena/scoring";

export type { Platform };

export interface ProfileData {
  platform: Platform;
  /** canonical handle as the platform spells it */
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  rating: number | null;
  maxRating: number | null;
  globalRank: number | null;
  totalRanked: number | null;
  /** Set only when the platform reports a percentile directly (LeetCode). Otherwise computed by the caller. */
  percentile: number | null;
  /** platform's own tier/badge label if it reports one */
  tier: string | null;
  contestsCount: number | null;
  raw: unknown;
  parserVersion: string;
}

export interface RatingEvent {
  contestId: string;
  contestName: string;
  startTime: Date;
  rank: number | null;
  /** problems solved in-contest when the platform exposes it, else null */
  solved: number | null;
  totalProblems: number | null;
  oldRating: number | null;
  newRating: number | null;
}

export type SolvedBreakdown =
  | { kind: "leetcode"; easy: number; medium: number; hard: number }
  | { kind: "codeforces"; buckets: Record<string, number> }
  | { kind: "codechef"; total: number };

export interface SolvedStats {
  total: number;
  breakdown: SolvedBreakdown;
}

export interface ActivityDay {
  /** YYYY-MM-DD in UTC */
  date: string;
  count: number;
}

export interface RecentActivity {
  days: ActivityDay[];
  /** what `count` means on this platform — LeetCode only exposes submissions, not accepts */
  measure: "accepted" | "submissions" | "unavailable";
}

export interface UpcomingContest {
  platform: Platform;
  externalId: string;
  name: string;
  url: string;
  startTime: Date;
  durationSeconds: number;
}

export interface VerifyResult {
  ok: boolean;
  /** profile field(s) we checked, for the UI message */
  checkedFields: string[];
}

/** Same interface for every platform. */
export interface PlatformAdapter {
  readonly platform: Platform;
  getProfile(handle: string): Promise<ProfileData>;
  getRatingHistory(handle: string): Promise<RatingEvent[]>;
  getSolvedStats(handle: string): Promise<SolvedStats>;
  getRecentActivity(handle: string, since: Date): Promise<RecentActivity>;
  getUpcomingContests(): Promise<UpcomingContest[]>;
  verifyToken(handle: string, token: string): Promise<VerifyResult>;
}

export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
