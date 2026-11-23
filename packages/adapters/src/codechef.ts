import { AdapterError, SourceClient, TtlCache } from "./http";
import type { PlatformAdapter, ProfileData, RatingEvent, RecentActivity, SolvedStats, UpcomingContest, VerifyResult } from "./types";

const BASE = "https://www.codechef.com";
/** Bump when the HTML parser changes so stored snapshots can be re-parsed. */
export const CC_PARSER_VERSION = "cc-html-v1";

export interface CodechefPage {
  name: string | null;
  rating: number | null;
  highestRating: number | null;
  stars: number | null;
  globalRank: number | null;
  countryRank: number | null;
  totalSolved: number | null;
  history: { code: string; name: string; rating: number; rank: number | null; endDate: Date }[];
}

const num = (s: string | undefined | null) => {
  if (!s) return null;
  const n = Number(s.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

/** Pure parser over the profile HTML — unit-tested against a recorded fixture. */
export function parseCodechefProfile(html: string): CodechefPage {
  const name = html.match(/<h1 class="h2-style">\s*([^<]*?)\s*<\/h1>/)?.[1] ?? null;
  // The first rating-header block is the main contest rating; later ones are e.g. "DSA Rating".
  const header = html.match(/<div class="rating-header[^"]*">([\s\S]*?)<\/small>/)?.[1] ?? "";
  const rating = num(header.match(/<div class="rating-number">\s*([0-9,]+)/)?.[1]);
  const highestRating = num(header.match(/Highest Rating\s+([0-9,]+)/)?.[1]);
  const starBlock = header.match(/<div class="rating-star">([\s\S]*?)<\/div>/)?.[1] ?? "";
  const stars = (starBlock.match(/&#9733;|★/g) ?? []).length || null;
  const ranksBlock = html.match(/<div class="rating-ranks">([\s\S]*?)<\/ul>/)?.[1] ?? "";
  const ranks = [...ranksBlock.matchAll(/<strong>\s*([^<]*?)\s*<\/strong>/g)].map((m) => num(m[1])); // "Inactive" → null
  const totalSolved = num(html.match(/Total Problems Solved:\s*([0-9,]+)/)?.[1]);

  let history: CodechefPage["history"] = [];
  const hist = html.match(/var all_rating = (\[[\s\S]*?\]);/)?.[1];
  if (hist) {
    try {
      const rows = JSON.parse(hist) as { code: string; name: string; rating: string; rank: string; end_date: string }[];
      history = rows.map((r) => ({
        code: r.code,
        name: r.name,
        rating: Number(r.rating),
        rank: num(r.rank),
        // end_date is IST wall-clock ("2010-01-15 15:00:00").
        endDate: new Date(`${r.end_date.replace(" ", "T")}+05:30`),
      }));
    } catch {
      throw new AdapterError("codechef", "parse", "all_rating is not valid JSON");
    }
  }

  if (name == null && rating == null && !header) throw new AdapterError("codechef", "parse", "profile markers not found — page layout may have changed");
  return { name, rating, highestRating, stars, globalRank: ranks[0] ?? null, countryRank: ranks[1] ?? null, totalSolved, history };
}

export class CodechefAdapter implements PlatformAdapter {
  readonly platform = "codechef" as const;
  private pages = new TtlCache<{ html: string; page: CodechefPage }>(60_000);

  constructor(private client = new SourceClient("codechef")) {}

  private load(handle: string) {
    return this.pages.get(handle.toLowerCase(), async () => {
      const res = await this.client.request(`${BASE}/users/${encodeURIComponent(handle)}`, { redirect: "manual" }, (r) => {
        // Unknown users get a 302 to the home page.
        if (r.status >= 300 && r.status < 400) throw new AdapterError("codechef", "not_found", handle);
        if (r.status === 404) throw new AdapterError("codechef", "not_found", handle);
        if (r.status === 403) throw new AdapterError("codechef", "blocked", "HTTP 403");
      });
      const html = await res.text();
      return { html, page: parseCodechefProfile(html) };
    });
  }

  async getProfile(handle: string): Promise<ProfileData> {
    const { page } = await this.load(handle);
    return {
      platform: "codechef",
      handle,
      displayName: page.name,
      avatarUrl: null,
      rating: page.history.length ? page.rating : null,
      maxRating: page.highestRating || null,
      globalRank: page.globalRank,
      totalRanked: null, // not on the profile page → percentile falls back to the rating table
      percentile: null,
      tier: page.stars ? `${page.stars}★` : null,
      contestsCount: page.history.length,
      raw: page, // parsed fields only; the full HTML is too large to keep per snapshot
      parserVersion: CC_PARSER_VERSION,
    };
  }

  async getRatingHistory(handle: string): Promise<RatingEvent[]> {
    const { page } = await this.load(handle);
    return page.history.map((h, i) => ({
      contestId: h.code,
      contestName: h.name,
      startTime: h.endDate, // CodeChef only exposes the end date here
      rank: h.rank,
      solved: null,
      totalProblems: null,
      oldRating: i > 0 ? page.history[i - 1].rating : null,
      newRating: h.rating,
    }));
  }

  async getSolvedStats(handle: string): Promise<SolvedStats> {
    const { page } = await this.load(handle);
    const total = page.totalSolved ?? 0;
    return { total, breakdown: { kind: "codechef", total } };
  }

  /** The heatmap loads via a separate XHR we don't call yet (TODO); report as unavailable. */
  async getRecentActivity(): Promise<RecentActivity> {
    return { measure: "unavailable", days: [] };
  }

  async getUpcomingContests(): Promise<UpcomingContest[]> {
    const res = await this.client.request(`${BASE}/api/list/contests/all?sort_by=START&sorting_order=asc&offset=0&mode=all`);
    let body: { future_contests?: { contest_code: string; contest_name: string; contest_start_date_iso: string; contest_duration: string }[] };
    try {
      body = JSON.parse(await res.text());
    } catch {
      throw new AdapterError("codechef", "parse", "contest list is not JSON");
    }
    return (body.future_contests ?? []).map((c) => ({
      platform: "codechef" as const,
      externalId: c.contest_code,
      name: c.contest_name,
      url: `${BASE}/${c.contest_code}`,
      startTime: new Date(c.contest_start_date_iso),
      durationSeconds: Number(c.contest_duration) * 60,
    }));
  }

  /** Token goes in the CodeChef "Name" field. Bypasses the cache so a fresh edit is seen. */
  async verifyToken(handle: string, token: string): Promise<VerifyResult> {
    const res = await this.client.request(`${BASE}/users/${encodeURIComponent(handle)}`, { redirect: "manual" });
    if (res.status >= 300) throw new AdapterError("codechef", "not_found", handle);
    const page = parseCodechefProfile(await res.text());
    return { ok: (page.name ?? "").toUpperCase().includes(token.toUpperCase()), checkedFields: ["Name"] };
  }
}
