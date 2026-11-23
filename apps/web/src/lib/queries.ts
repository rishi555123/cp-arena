import "server-only";
import { addDays, contestResults, dailyActivity, getDb, platformAccounts, platformSnapshots, scoreSnapshots, users } from "@cp-arena/db";
import type { Platform, PowerComponents } from "@cp-arena/scoring";
import { and, asc, desc, eq, gt, gte, inArray, max, sql } from "drizzle-orm";
import { cache } from "react";

export interface PlatformCell {
  handle: string;
  rating: number | null;
  maxRating: number | null;
  tier: string | null;
  solvedTotal: number | null;
  weightedSolved: number | null;
  percentile: number | null;
  verified: boolean;
  synthetic: boolean;
  lastSyncedAt: Date | null;
  syncStatus: string;
}

export interface BoardRow {
  userId: string;
  name: string;
  image: string | null;
  groupTag: string | null;
  rank: number;
  /** positive = climbed since 7 days ago; null = wasn't ranked then */
  change7: number | null;
  division: string;
  divisionRank: number;
  power: number;
  components: PowerComponents;
  platforms: Partial<Record<Platform, PlatformCell>>;
  lastActive: string | null;
  spark: number[];
}

export async function latestScoreDay(): Promise<string | null> {
  const [r] = await getDb().select({ d: max(scoreSnapshots.day) }).from(scoreSnapshots);
  return r?.d ?? null;
}

/** Latest snapshot per account (verified or not) for the given users. */
export async function latestPlatformCells(userIds?: string[]): Promise<Map<string, Partial<Record<Platform, PlatformCell>>>> {
  const db = getDb();
  const rows = await db
    .selectDistinctOn([platformAccounts.id], {
      userId: platformAccounts.userId,
      platform: platformAccounts.platform,
      handle: platformAccounts.handle,
      verified: platformAccounts.verified,
      synthetic: platformAccounts.synthetic,
      lastSyncedAt: platformAccounts.lastSyncedAt,
      syncStatus: platformAccounts.syncStatus,
      rating: platformSnapshots.rating,
      maxRating: platformSnapshots.maxRating,
      tier: platformSnapshots.tier,
      solvedTotal: platformSnapshots.solvedTotal,
      weightedSolved: platformSnapshots.weightedSolved,
      percentile: platformSnapshots.percentile,
    })
    .from(platformAccounts)
    .leftJoin(platformSnapshots, eq(platformSnapshots.accountId, platformAccounts.id))
    .where(userIds ? inArray(platformAccounts.userId, userIds) : undefined)
    .orderBy(platformAccounts.id, desc(platformSnapshots.day));
  const out = new Map<string, Partial<Record<Platform, PlatformCell>>>();
  for (const r of rows) {
    if (!out.has(r.userId)) out.set(r.userId, {});
    out.get(r.userId)![r.platform] = r;
  }
  return out;
}

export const displayNameOf = (u: { name: string | null; displayName: string | null; showHandleOnly: boolean; email: string }, handle?: string) =>
  (u.showHandleOnly && handle) || u.displayName || u.name || u.email.split("@")[0];

/** Everything the leaderboard needs, in five queries regardless of member count. */
export async function getBoard(): Promise<{ day: string | null; rows: BoardRow[] }> {
  const day = await latestScoreDay();
  if (!day) return { day: null, rows: [] };
  const db = getDb();
  const [today, weekAgo, spark, cells, active] = await Promise.all([
    db
      .select({ s: scoreSnapshots, u: { id: users.id, name: users.name, displayName: users.displayName, showHandleOnly: users.showHandleOnly, email: users.email, image: users.image, groupTag: users.groupTag } })
      .from(scoreSnapshots)
      .innerJoin(users, eq(users.id, scoreSnapshots.userId))
      .where(and(eq(scoreSnapshots.day, day), eq(users.status, "active")))
      .orderBy(asc(scoreSnapshots.overallRank)),
    db.select({ userId: scoreSnapshots.userId, rank: scoreSnapshots.overallRank }).from(scoreSnapshots).where(eq(scoreSnapshots.day, addDays(day, -7))),
    db
      .select({ userId: scoreSnapshots.userId, power: scoreSnapshots.power })
      .from(scoreSnapshots)
      .where(gt(scoreSnapshots.day, addDays(day, -30)))
      .orderBy(asc(scoreSnapshots.day)),
    latestPlatformCells(),
    db.select({ userId: dailyActivity.userId, last: max(dailyActivity.day) }).from(dailyActivity).groupBy(dailyActivity.userId),
  ]);
  const rank7 = new Map(weekAgo.map((r) => [r.userId, r.rank]));
  const sparkBy = new Map<string, number[]>();
  for (const p of spark) {
    if (!sparkBy.has(p.userId)) sparkBy.set(p.userId, []);
    sparkBy.get(p.userId)!.push(p.power);
  }
  const lastActive = new Map(active.map((a) => [a.userId, a.last]));

  const rows: BoardRow[] = today.map(({ s, u }) => {
    const platforms = cells.get(u.id) ?? {};
    const before = rank7.get(u.id);
    return {
      userId: u.id,
      name: displayNameOf(u, Object.values(platforms)[0]?.handle),
      image: u.image,
      groupTag: u.groupTag,
      rank: s.overallRank,
      change7: before == null ? null : before - s.overallRank,
      division: s.division,
      divisionRank: s.divisionRank,
      power: s.power,
      components: s.components as PowerComponents,
      platforms,
      lastActive: lastActive.get(u.id) ?? null,
      spark: sparkBy.get(u.id) ?? [],
    };
  });
  return { day, rows };
}

/** Cached per request: used by both generateMetadata and the page. */
export const getProfile = cache(async (userId: string) => {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || user.status === "removed") return null;
  const day = await latestScoreDay();
  const [history, accounts, results, snaps, activity, cellsMap] = await Promise.all([
    db.select().from(scoreSnapshots).where(eq(scoreSnapshots.userId, userId)).orderBy(asc(scoreSnapshots.day)),
    db.select().from(platformAccounts).where(eq(platformAccounts.userId, userId)),
    db
      .select({ r: contestResults })
      .from(contestResults)
      .innerJoin(platformAccounts, eq(platformAccounts.id, contestResults.accountId))
      .where(eq(platformAccounts.userId, userId))
      .orderBy(desc(contestResults.startTime)),
    db
      .select({ platform: platformAccounts.platform, day: platformSnapshots.day, solvedTotal: platformSnapshots.solvedTotal, solved: platformSnapshots.solved })
      .from(platformSnapshots)
      .innerJoin(platformAccounts, eq(platformAccounts.id, platformSnapshots.accountId))
      .where(eq(platformAccounts.userId, userId))
      .orderBy(asc(platformSnapshots.day)),
    db
      .select({ day: dailyActivity.day, n: sql<number>`sum(${dailyActivity.accepted})::int` })
      .from(dailyActivity)
      .where(and(eq(dailyActivity.userId, userId), gte(dailyActivity.day, addDays(day ?? new Date().toISOString().slice(0, 10), -182))))
      .groupBy(dailyActivity.day),
    latestPlatformCells([userId]),
  ]);

  // Who is directly above on the latest day (next target).
  const latest = history.at(-1) && history.at(-1)!.day === day ? history.at(-1)! : null;
  let above: { userId: string; name: string; power: number; rank: number } | null = null;
  let total = 0;
  if (latest && day) {
    const [a] = await db
      .select({ userId: users.id, name: users.name, displayName: users.displayName, showHandleOnly: users.showHandleOnly, email: users.email, power: scoreSnapshots.power, rank: scoreSnapshots.overallRank })
      .from(scoreSnapshots)
      .innerJoin(users, eq(users.id, scoreSnapshots.userId))
      .where(and(eq(scoreSnapshots.day, day), eq(scoreSnapshots.overallRank, latest.overallRank - 1)));
    if (a) above = { userId: a.userId, name: displayNameOf(a), power: a.power, rank: a.rank };
    const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(scoreSnapshots).where(eq(scoreSnapshots.day, day));
    total = c?.n ?? 0;
  }

  return { user, day, latest, history, accounts, results: results.map((r) => r.r), snaps, activity, cells: cellsMap.get(userId) ?? {}, above, total };
});

export type ProfileData = NonNullable<Awaited<ReturnType<typeof getProfile>>>;
