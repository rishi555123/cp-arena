import { DEFAULT_CONFIG, computePower, divisionFor, positiveRatingGain, rankEntries, type DivisionBand, type Platform, type PowerResult, type ScoringConfig } from "@cp-arena/scoring";
import { and, desc, eq, gte, inArray, lt, notInArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import { contestResults, platformAccounts, platformSnapshots, scoreSnapshots, scoringConfig, users } from "./schema";

const DAY_MS = 86_400_000;
export const toDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => toDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS));
const endOfDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS);

/**
 * Propose division bands from the latest day's Power distribution so each of the five bands holds
 * ~20% of ranked members (cut points rounded down to a multiple of 5). Used by the seed and by
 * `npm run calibrate` at launch. Returns null when there are too few members to calibrate.
 */
export async function proposeDivisions(db: Db, base: ScoringConfig = DEFAULT_CONFIG): Promise<DivisionBand[] | null> {
  const rows = await db.execute<{ power: number }>(sql`select power from score_snapshots where day = (select max(day) from score_snapshots) order by power desc`);
  const powers = rows.map((r) => Number(r.power));
  const k = base.divisions.length;
  if (powers.length < k * 3) return null;
  const bands: DivisionBand[] = base.divisions.map((d, i) => {
    if (i === k - 1) return { name: d.name, min: 0 };
    const idx = Math.round((powers.length * (i + 1)) / k) - 1;
    return { name: d.name, min: Math.floor(powers[idx] / 5) * 5 };
  });
  for (let i = 1; i < k - 1; i++) bands[i].min = Math.min(bands[i].min, bands[i - 1].min - 5);
  return bands;
}

/** Make `config` the active scoring config (upserted by version). */
export async function saveActiveConfig(db: Db, config: ScoringConfig, notes?: string): Promise<void> {
  await db.update(scoringConfig).set({ active: false }).where(eq(scoringConfig.active, true));
  await db
    .insert(scoringConfig)
    .values({ version: config.version, config, active: true, notes })
    .onConflictDoUpdate({ target: scoringConfig.version, set: { config, active: true, notes } });
}

export async function loadActiveConfig(db: Db): Promise<ScoringConfig> {
  const [row] = await db.select().from(scoringConfig).where(eq(scoringConfig.active, true)).limit(1);
  return row ? { ...DEFAULT_CONFIG, ...(row.config as Partial<ScoringConfig>) } : DEFAULT_CONFIG;
}

interface Snap {
  day: string;
  rating: number | null;
  percentile: number | null;
  weightedSolved: number | null;
}
interface Result {
  startTime: Date;
  oldRating: number | null;
  newRating: number | null;
}
interface MemberData {
  accounts: { platform: Platform; snaps: Snap[]; results: Result[] }[];
}

function lastAtOrBefore(snaps: Snap[], day: string): Snap | undefined {
  let best: Snap | undefined;
  for (const s of snaps) if (s.day <= day) best = s;
  return best;
}

/** Pure: the Power inputs for one member on `day`. Returns null when nothing has synced yet. */
export function powerForDay(member: MemberData, day: string, config: ScoringConfig): PowerResult | null {
  const windowStart = addDays(day, -config.momentum.windowDays);
  const windowStartTs = endOfDay(windowStart);
  const dayEnd = endOfDay(day);
  const percentiles: Partial<Record<Platform, number | null>> = {};
  let weighted = 0;
  let weighted28 = 0;
  let contests = 0;
  const deltas: (number | null)[] = [];
  let any = false;

  for (const acc of member.accounts) {
    const now = lastAtOrBefore(acc.snaps, day);
    if (!now) continue;
    any = true;
    percentiles[acc.platform] = now.rating == null ? null : now.percentile;
    weighted += now.weightedSolved ?? 0;
    // Baseline = last snapshot before the window; if the account is newer than the window,
    // its first snapshot (so linking an old account doesn't count as a month of solving).
    const base = lastAtOrBefore(acc.snaps, windowStart) ?? acc.snaps.find((s) => s.day > windowStart && s.day <= day);
    weighted28 += Math.max(0, (now.weightedSolved ?? 0) - (base?.weightedSolved ?? 0));
    for (const r of acc.results) {
      if (r.startTime >= windowStartTs && r.startTime < dayEnd) {
        contests++;
        deltas.push(r.oldRating != null && r.newRating != null ? r.newRating - r.oldRating : null);
      }
    }
  }
  if (!any) return null;
  return computePower({ percentiles, weightedSolves: weighted, momentum: { contests, ratingGain: positiveRatingGain(deltas), weightedSolves: weighted28 } }, config);
}

/**
 * Recompute and upsert score_snapshots for each day in `days` (ascending, YYYY-MM-DD).
 * Ranks only active members with at least one verified account.
 */
export async function recomputeScores(db: Db, days: string[], config?: ScoringConfig): Promise<{ days: number; rows: number }> {
  if (days.length === 0) return { days: 0, rows: 0 };
  const cfg = config ?? (await loadActiveConfig(db));
  days = [...days].sort();
  const cutoff = addDays(days[0], -(cfg.momentum.windowDays + 7));

  const accounts = await db
    .select({ id: platformAccounts.id, userId: platformAccounts.userId, platform: platformAccounts.platform })
    .from(platformAccounts)
    .innerJoin(users, eq(users.id, platformAccounts.userId))
    .where(and(eq(platformAccounts.verified, true), eq(users.status, "active")));
  if (accounts.length === 0) return { days: days.length, rows: 0 };
  const ids = accounts.map((a) => a.id);

  const snapCols = {
    accountId: platformSnapshots.accountId,
    day: platformSnapshots.day,
    rating: platformSnapshots.rating,
    percentile: platformSnapshots.percentile,
    weightedSolved: platformSnapshots.weightedSolved,
  };
  const recent = await db.select(snapCols).from(platformSnapshots).where(and(inArray(platformSnapshots.accountId, ids), gte(platformSnapshots.day, cutoff)));
  // Latest snapshot before the cutoff per account, so long-idle accounts still count.
  const older = await db
    .selectDistinctOn([platformSnapshots.accountId], snapCols)
    .from(platformSnapshots)
    .where(and(inArray(platformSnapshots.accountId, ids), lt(platformSnapshots.day, cutoff)))
    .orderBy(platformSnapshots.accountId, desc(platformSnapshots.day));
  const results = await db
    .select({ accountId: contestResults.accountId, startTime: contestResults.startTime, oldRating: contestResults.oldRating, newRating: contestResults.newRating })
    .from(contestResults)
    .where(and(inArray(contestResults.accountId, ids), gte(contestResults.startTime, new Date(`${cutoff}T00:00:00Z`))));

  const members = new Map<string, MemberData>();
  const byAccount = new Map<string, MemberData["accounts"][number]>();
  for (const a of accounts) {
    const entry = { platform: a.platform, snaps: [] as Snap[], results: [] as Result[] };
    byAccount.set(a.id, entry);
    if (!members.has(a.userId)) members.set(a.userId, { accounts: [] });
    members.get(a.userId)!.accounts.push(entry);
  }
  for (const s of [...older, ...recent]) byAccount.get(s.accountId)?.snaps.push(s);
  for (const e of byAccount.values()) e.snaps.sort((a, b) => a.day.localeCompare(b.day));
  for (const r of results) byAccount.get(r.accountId)?.results.push(r);

  // Carry "reached at" forward from the last stored snapshot before the first day.
  const prevRows = await db
    .selectDistinctOn([scoreSnapshots.userId], { userId: scoreSnapshots.userId, power: scoreSnapshots.power, reachedAt: scoreSnapshots.reachedAt })
    .from(scoreSnapshots)
    .where(lt(scoreSnapshots.day, days[0]))
    .orderBy(scoreSnapshots.userId, desc(scoreSnapshots.day));
  const prev = new Map(prevRows.map((r) => [r.userId, { power: r.power, reachedAt: r.reachedAt }]));

  let rows = 0;
  for (const day of days) {
    const computed: { userId: string; power: number; momentum: number; reachedAt: Date; result: PowerResult }[] = [];
    for (const [userId, m] of members) {
      const result = powerForDay(m, day, cfg);
      if (!result) continue;
      const p = prev.get(userId);
      const reachedAt = p && p.power === result.power ? p.reachedAt : new Date(`${day}T00:00:00Z`);
      computed.push({ userId, power: result.power, momentum: result.components.momentum, reachedAt, result });
    }
    const ranked = rankEntries(computed);
    const divCounters = new Map<string, number>();
    const values = ranked.map((r) => {
      const division = divisionFor(r.power, cfg);
      const divisionRank = (divCounters.get(division) ?? 0) + 1;
      divCounters.set(division, divisionRank);
      prev.set(r.userId, { power: r.power, reachedAt: r.reachedAt });
      return {
        userId: r.userId,
        day,
        power: r.power,
        components: r.result.components,
        overallRank: r.rank,
        division,
        divisionRank,
        reachedAt: r.reachedAt,
        formulaVersion: r.result.formulaVersion,
        computedAt: new Date(),
      };
    });
    for (let i = 0; i < values.length; i += 500) {
      const chunk = values.slice(i, i + 500);
      await db
        .insert(scoreSnapshots)
        .values(chunk)
        .onConflictDoUpdate({
          target: [scoreSnapshots.userId, scoreSnapshots.day],
          set: {
            power: sql`excluded.power`,
            components: sql`excluded.components`,
            overallRank: sql`excluded.overall_rank`,
            division: sql`excluded.division`,
            divisionRank: sql`excluded.division_rank`,
            reachedAt: sql`excluded.reached_at`,
            formulaVersion: sql`excluded.formula_version`,
            computedAt: sql`excluded.computed_at`,
          },
        });
    }
    // Members who dropped out (unverified/removed) shouldn't keep a stale row for this day.
    const keep = values.map((v) => v.userId);
    await db.delete(scoreSnapshots).where(and(eq(scoreSnapshots.day, day), keep.length ? notInArray(scoreSnapshots.userId, keep) : undefined));
    rows += values.length;
  }
  return { days: days.length, rows };
}
