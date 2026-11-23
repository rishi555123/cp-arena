import { DEFAULT_CONFIG, cfBucketKey } from "@cp-arena/scoring";
import { AdapterError, SourceClient, TtlCache } from "./http";
import { utcDay, type PlatformAdapter, type ProfileData, type RatingEvent, type RecentActivity, type SolvedStats, type UpcomingContest, type VerifyResult } from "./types";

const API = "https://codeforces.com/api";
export const CF_PARSER_VERSION = "cf-api-v1";

interface CfUser {
  handle: string;
  firstName?: string;
  lastName?: string;
  rating?: number;
  maxRating?: number;
  rank?: string;
  titlePhoto?: string;
  avatar?: string;
}
interface CfRatingChange {
  contestId: number;
  contestName: string;
  rank: number;
  ratingUpdateTimeSeconds: number;
  oldRating: number;
  newRating: number;
}
interface CfSubmission {
  id: number;
  contestId?: number;
  creationTimeSeconds: number;
  problem: { contestId?: number; problemsetName?: string; index: string; name: string; rating?: number; tags?: string[] };
  author: { participantType: string; startTimeSeconds?: number };
  verdict?: string;
}
interface CfContest {
  id: number;
  name: string;
  phase: string;
  durationSeconds: number;
  startTimeSeconds?: number;
}

const IN_CONTEST = new Set(["CONTESTANT", "OUT_OF_COMPETITION"]);
const problemKey = (s: CfSubmission) => `${s.problem.contestId ?? s.problem.problemsetName ?? "?"}-${s.problem.index}`;

export class CodeforcesAdapter implements PlatformAdapter {
  readonly platform = "codeforces" as const;
  private statusCache = new TtlCache<CfSubmission[]>(60_000);

  constructor(private client = new SourceClient("codeforces")) {}

  private async api<T>(method: string, params: Record<string, string | number>): Promise<T> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const res = await this.client.request(`${API}/${method}?${qs}`, {}, (r) => {
      const ct = r.headers.get("content-type") ?? "";
      if (!ct.includes("json") && r.status !== 400) throw new AdapterError("codeforces", "blocked", `non-JSON response (${r.status})`);
    });
    let body: { status: string; comment?: string; result?: T };
    try {
      body = JSON.parse(await res.text());
    } catch {
      throw new AdapterError("codeforces", "parse", `invalid JSON from ${method}`);
    }
    if (body.status !== "OK") {
      const c = body.comment ?? "unknown error";
      if (/not found/i.test(c)) throw new AdapterError("codeforces", "not_found", c);
      throw new AdapterError("codeforces", "unavailable", c);
    }
    return body.result as T;
  }

  /** All submissions, paginated. TODO: incremental sync from the last seen submission id. */
  private submissions(handle: string): Promise<CfSubmission[]> {
    return this.statusCache.get(handle.toLowerCase(), async () => {
      const all: CfSubmission[] = [];
      const page = 5000;
      for (let from = 1; ; from += page) {
        const chunk = await this.api<CfSubmission[]>("user.status", { handle, from, count: page });
        all.push(...chunk);
        if (chunk.length < page) break;
      }
      return all;
    });
  }

  async getProfile(handle: string): Promise<ProfileData> {
    const [u] = await this.api<CfUser[]>("user.info", { handles: handle });
    if (!u) throw new AdapterError("codeforces", "not_found", handle);
    const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || null;
    return {
      platform: "codeforces",
      handle: u.handle,
      displayName: name,
      avatarUrl: u.titlePhoto ?? u.avatar ?? null,
      rating: u.rating ?? null,
      maxRating: u.maxRating ?? null,
      globalRank: null,
      totalRanked: null,
      percentile: null, // computed from the ratedList distribution / fallback table
      tier: u.rank ? u.rank.replace(/\b\w/g, (c) => c.toUpperCase()) : null,
      contestsCount: null,
      raw: u,
      parserVersion: CF_PARSER_VERSION,
    };
  }

  async getRatingHistory(handle: string): Promise<RatingEvent[]> {
    const [changes, subs] = await Promise.all([this.api<CfRatingChange[]>("user.rating", { handle }), this.submissions(handle)]);
    // Distinct accepted problems per contest, in-contest only.
    const solvedByContest = new Map<number, Set<string>>();
    const startByContest = new Map<number, number>();
    for (const s of subs) {
      if (s.contestId == null || !IN_CONTEST.has(s.author.participantType)) continue;
      if (s.author.startTimeSeconds) startByContest.set(s.contestId, s.author.startTimeSeconds);
      if (s.verdict !== "OK") continue;
      if (!solvedByContest.has(s.contestId)) solvedByContest.set(s.contestId, new Set());
      solvedByContest.get(s.contestId)!.add(s.problem.index);
    }
    return changes.map((c) => ({
      contestId: String(c.contestId),
      contestName: c.contestName,
      startTime: new Date((startByContest.get(c.contestId) ?? c.ratingUpdateTimeSeconds) * 1000),
      rank: c.rank,
      solved: solvedByContest.get(c.contestId)?.size ?? 0,
      totalProblems: null,
      oldRating: c.oldRating,
      newRating: c.newRating,
    }));
  }

  async getSolvedStats(handle: string): Promise<SolvedStats> {
    const subs = await this.submissions(handle);
    const seen = new Map<string, number | undefined>();
    for (const s of subs) if (s.verdict === "OK") seen.set(problemKey(s), s.problem.rating);
    const buckets: Record<string, number> = {};
    for (const rating of seen.values()) {
      const k = cfBucketKey(rating, DEFAULT_CONFIG);
      buckets[k] = (buckets[k] ?? 0) + 1;
    }
    return { total: seen.size, breakdown: { kind: "codeforces", buckets } };
  }

  async getRecentActivity(handle: string, since: Date): Promise<RecentActivity> {
    const subs = await this.submissions(handle);
    const cutoff = since.getTime() / 1000;
    const perDay = new Map<string, Set<string>>();
    for (const s of subs) {
      if (s.verdict !== "OK" || s.creationTimeSeconds < cutoff) continue;
      const day = utcDay(new Date(s.creationTimeSeconds * 1000));
      if (!perDay.has(day)) perDay.set(day, new Set());
      perDay.get(day)!.add(problemKey(s));
    }
    return { measure: "accepted", days: [...perDay].map(([date, set]) => ({ date, count: set.size })).sort((a, b) => a.date.localeCompare(b.date)) };
  }

  async getUpcomingContests(): Promise<UpcomingContest[]> {
    const list = await this.api<CfContest[]>("contest.list", { gym: "false" });
    return list
      .filter((c) => c.phase === "BEFORE" && c.startTimeSeconds)
      .map((c) => ({
        platform: "codeforces" as const,
        externalId: String(c.id),
        name: c.name,
        url: `https://codeforces.com/contests/${c.id}`,
        startTime: new Date(c.startTimeSeconds! * 1000),
        durationSeconds: c.durationSeconds,
      }));
  }

  /** Token goes in the Codeforces "First name" field (Settings → Social). */
  async verifyToken(handle: string, token: string): Promise<VerifyResult> {
    const [u] = await this.api<CfUser[]>("user.info", { handles: handle, checkHistoricHandles: "false" });
    const fields = [u?.firstName, u?.lastName].filter(Boolean).join(" ");
    return { ok: fields.toUpperCase().includes(token.toUpperCase()), checkedFields: ["First name", "Last name"] };
  }
}
