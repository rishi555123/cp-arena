import { AdapterError, SourceClient } from "./http";
import { utcDay, type PlatformAdapter, type ProfileData, type RatingEvent, type RecentActivity, type SolvedStats, type UpcomingContest, type VerifyResult } from "./types";

const GQL = "https://leetcode.com/graphql";
export const LC_PARSER_VERSION = "lc-gql-v1";
/** LeetCode contest rating starts at 1500 for new participants. */
const LC_START_RATING = 1500;

const PROFILE_Q = `query profile($u: String!) {
  matchedUser(username: $u) { username profile { realName aboutMe userAvatar ranking } }
  userContestRanking(username: $u) { attendedContestsCount rating globalRanking totalParticipants topPercentage badge { name } }
}`;
const HISTORY_Q = `query history($u: String!) {
  userContestRankingHistory(username: $u) { attended problemsSolved totalProblems finishTimeInSeconds rating ranking contest { title startTime } }
}`;
const SOLVED_Q = `query solved($u: String!) {
  matchedUser(username: $u) { submitStatsGlobal { acSubmissionNum { difficulty count } } }
}`;
const CALENDAR_Q = `query cal($u: String!) {
  matchedUser(username: $u) { userCalendar { submissionCalendar streak totalActiveDays } }
}`;
const UPCOMING_Q = `{ topTwoContests { title titleSlug startTime duration } }`;

interface LcProfile {
  matchedUser: { username: string; profile: { realName: string | null; aboutMe: string | null; userAvatar: string | null; ranking: number | null } } | null;
  userContestRanking: {
    attendedContestsCount: number;
    rating: number;
    globalRanking: number;
    totalParticipants: number;
    topPercentage: number;
    badge: { name: string } | null;
  } | null;
}
interface LcHistoryRow {
  attended: boolean;
  problemsSolved: number;
  totalProblems: number;
  rating: number;
  ranking: number;
  contest: { title: string; startTime: number };
}

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export class LeetcodeAdapter implements PlatformAdapter {
  readonly platform = "leetcode" as const;
  constructor(private client = new SourceClient("leetcode")) {}

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await this.client.request(
      GQL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Referer: "https://leetcode.com" },
        body: JSON.stringify({ query, variables }),
      },
      (r) => {
        // Cloudflare challenges come back as 403 + HTML.
        const ct = r.headers.get("content-type") ?? "";
        if (r.status === 403 || !ct.includes("json")) throw new AdapterError("leetcode", "blocked", `HTTP ${r.status}, content-type ${ct || "none"}`);
      },
    );
    let body: { data?: T; errors?: { message: string }[] };
    try {
      body = JSON.parse(await res.text());
    } catch {
      throw new AdapterError("leetcode", "parse", "invalid JSON");
    }
    if (body.errors?.length) {
      const msg = body.errors.map((e) => e.message).join("; ");
      if (/does not exist|not found/i.test(msg)) throw new AdapterError("leetcode", "not_found", msg);
      if (!body.data) throw new AdapterError("leetcode", "unavailable", msg);
    }
    if (!body.data) throw new AdapterError("leetcode", "parse", "missing data");
    return body.data;
  }

  async getProfile(handle: string): Promise<ProfileData> {
    const d = await this.gql<LcProfile>(PROFILE_Q, { u: handle });
    if (!d.matchedUser) throw new AdapterError("leetcode", "not_found", handle);
    const r = d.userContestRanking;
    return {
      platform: "leetcode",
      handle: d.matchedUser.username,
      displayName: d.matchedUser.profile.realName || null,
      avatarUrl: d.matchedUser.profile.userAvatar || null,
      rating: r ? Math.round(r.rating) : null,
      maxRating: null, // computed from history by the caller
      globalRank: r?.globalRanking ?? null,
      totalRanked: r?.totalParticipants ?? null,
      // Unrated members (0 contests) have no percentile — not the same as 0.
      percentile: r && r.attendedContestsCount > 0 ? Math.max(0, 1 - r.topPercentage / 100) : null,
      tier: r?.badge?.name ?? null,
      contestsCount: r?.attendedContestsCount ?? 0,
      raw: d,
      parserVersion: LC_PARSER_VERSION,
    };
  }

  async getRatingHistory(handle: string): Promise<RatingEvent[]> {
    const d = await this.gql<{ userContestRankingHistory: LcHistoryRow[] | null }>(HISTORY_Q, { u: handle });
    const rows = d.userContestRankingHistory ?? [];
    const out: RatingEvent[] = [];
    let prev = LC_START_RATING;
    for (const row of rows) {
      if (row.attended) {
        out.push({
          contestId: slugify(row.contest.title),
          contestName: row.contest.title,
          startTime: new Date(row.contest.startTime * 1000),
          rank: row.ranking || null,
          solved: row.problemsSolved,
          totalProblems: row.totalProblems,
          oldRating: Math.round(prev),
          newRating: Math.round(row.rating),
        });
      }
      prev = row.rating;
    }
    return out;
  }

  async getSolvedStats(handle: string): Promise<SolvedStats> {
    const d = await this.gql<{ matchedUser: { submitStatsGlobal: { acSubmissionNum: { difficulty: string; count: number }[] } } | null }>(SOLVED_Q, { u: handle });
    if (!d.matchedUser) throw new AdapterError("leetcode", "not_found", handle);
    const get = (k: string) => d.matchedUser!.submitStatsGlobal.acSubmissionNum.find((x) => x.difficulty === k)?.count ?? 0;
    const easy = get("Easy");
    const medium = get("Medium");
    const hard = get("Hard");
    return { total: easy + medium + hard, breakdown: { kind: "leetcode", easy, medium, hard } };
  }

  /** LeetCode's public calendar counts submissions, not accepts. Empty → member may have hidden it. */
  async getRecentActivity(handle: string, since: Date): Promise<RecentActivity> {
    const d = await this.gql<{ matchedUser: { userCalendar: { submissionCalendar: string } | null } | null }>(CALENDAR_Q, { u: handle });
    const cal = d.matchedUser?.userCalendar?.submissionCalendar;
    if (!cal) return { measure: "unavailable", days: [] };
    let parsed: Record<string, number>;
    try {
      parsed = JSON.parse(cal);
    } catch {
      throw new AdapterError("leetcode", "parse", "submissionCalendar is not JSON");
    }
    const cutoff = since.getTime() / 1000;
    const days = Object.entries(parsed)
      .filter(([ts]) => Number(ts) >= cutoff)
      .map(([ts, count]) => ({ date: utcDay(new Date(Number(ts) * 1000)), count }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { measure: "submissions", days };
  }

  async getUpcomingContests(): Promise<UpcomingContest[]> {
    const d = await this.gql<{ topTwoContests: { title: string; titleSlug: string; startTime: number; duration: number }[] }>(UPCOMING_Q);
    return d.topTwoContests.map((c) => ({
      platform: "leetcode" as const,
      externalId: c.titleSlug,
      name: c.title,
      url: `https://leetcode.com/contest/${c.titleSlug}`,
      startTime: new Date(c.startTime * 1000),
      durationSeconds: c.duration,
    }));
  }

  /** Token goes in LeetCode "Summary" (About me) or Name — whichever GraphQL returns. */
  async verifyToken(handle: string, token: string): Promise<VerifyResult> {
    const d = await this.gql<LcProfile>(PROFILE_Q, { u: handle });
    if (!d.matchedUser) throw new AdapterError("leetcode", "not_found", handle);
    const hay = `${d.matchedUser.profile.realName ?? ""} ${d.matchedUser.profile.aboutMe ?? ""}`.toUpperCase();
    return { ok: hay.includes(token.toUpperCase()), checkedFields: ["Name", "Summary"] };
  }
}
