import { AdapterError, getAdapters, type Platform, type PlatformAdapter } from "@cp-arena/adapters";
import { platformPercentile, weightedFromBreakdown } from "@cp-arena/scoring";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import { contestResults, contests, dailyActivity, platformAccounts, platformSnapshots, sourceHealth, syncJobs } from "./schema";
import { loadActiveConfig, toDay } from "./scores";

/** Members may request a refresh at most this often. */
export const REFRESH_COOLDOWN_MS = 15 * 60_000;
/** Ratings usually publish within a day or two; keep re-syncing "pending" results this long. */
const PENDING_WINDOW_MS = 7 * 86_400_000;

export async function enqueueAccountSync(db: Db, accountId: string, priority = 0): Promise<void> {
  // Idempotent: don't stack duplicate queued jobs for the same account.
  const existing = await db
    .select({ id: syncJobs.id })
    .from(syncJobs)
    .where(and(eq(syncJobs.kind, "account"), eq(syncJobs.accountId, accountId), inArray(syncJobs.status, ["queued", "running"])))
    .limit(1);
  if (existing.length) {
    if (priority > 0) await db.update(syncJobs).set({ priority, runAt: new Date() }).where(eq(syncJobs.id, existing[0].id));
    return;
  }
  await db.insert(syncJobs).values({ kind: "account", accountId, priority });
  await db.update(platformAccounts).set({ syncStatus: "pending" }).where(and(eq(platformAccounts.id, accountId), sql`${platformAccounts.syncStatus} <> 'syncing'`));
}

export async function recordSourceResult(db: Db, source: string, err?: unknown): Promise<void> {
  const now = new Date();
  if (!err) {
    await db
      .insert(sourceHealth)
      .values({ source, state: "ok", lastSuccessAt: now, successCount: 1, updatedAt: now })
      .onConflictDoUpdate({
        target: sourceHealth.source,
        set: { state: "ok", lastSuccessAt: now, successCount: sql`${sourceHealth.successCount} + 1`, circuitOpenUntil: null, updatedAt: now },
      });
    return;
  }
  const e = err instanceof AdapterError ? err : null;
  if (e?.kind === "not_found") return; // a bad handle isn't a source problem
  const state = e?.kind === "blocked" || e?.kind === "circuit_open" ? "down" : "degraded";
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  const parser = e?.kind === "parse" ? 1 : 0;
  await db
    .insert(sourceHealth)
    .values({ source, state, lastErrorAt: now, lastError: message, errorCount: 1, parserFailures: parser, updatedAt: now })
    .onConflictDoUpdate({
      target: sourceHealth.source,
      set: {
        state,
        lastErrorAt: now,
        lastError: message,
        errorCount: sql`${sourceHealth.errorCount} + 1`,
        parserFailures: sql`${sourceHealth.parserFailures} + ${parser}`,
        updatedAt: now,
      },
    });
}

/**
 * Pull everything for one account and upsert snapshot, contest results and daily activity.
 * Idempotent: safe to re-run. Raw payloads are stored on the snapshot for re-parsing.
 */
export async function syncAccount(db: Db, accountId: string, adapters: Record<Platform, PlatformAdapter> = getAdapters()): Promise<void> {
  const [acc] = await db.select().from(platformAccounts).where(eq(platformAccounts.id, accountId));
  if (!acc) return;
  const adapter = adapters[acc.platform];
  const config = await loadActiveConfig(db);
  await db.update(platformAccounts).set({ syncStatus: "syncing" }).where(eq(platformAccounts.id, acc.id));

  try {
    const profile = await adapter.getProfile(acc.handle);
    const history = await adapter.getRatingHistory(acc.handle);
    const solved = await adapter.getSolvedStats(acc.handle);
    const since = acc.lastSyncedAt ? new Date(acc.lastSyncedAt.getTime() - 3 * 86_400_000) : new Date(Date.now() - 365 * 86_400_000);
    const activity = await adapter.getRecentActivity(acc.handle, since);

    const maxRating = profile.maxRating ?? (history.length ? Math.max(...history.map((h) => h.newRating ?? 0)) : null);
    const percentile = platformPercentile(acc.platform, profile, config);
    const now = new Date();
    const day = toDay(now);
    const snap = {
      accountId: acc.id,
      day,
      capturedAt: now,
      rating: profile.rating,
      maxRating,
      globalRank: profile.globalRank,
      totalRanked: profile.totalRanked,
      percentile,
      tier: profile.tier,
      contestsCount: profile.contestsCount ?? history.length,
      solvedTotal: solved.total,
      solved: solved.breakdown,
      weightedSolved: weightedFromBreakdown(solved.breakdown, config),
      rawJson: profile.raw as object,
      parserVersion: profile.parserVersion,
    };
    await db
      .insert(platformSnapshots)
      .values(snap)
      .onConflictDoUpdate({ target: [platformSnapshots.accountId, platformSnapshots.day], set: { ...snap, accountId: undefined, day: undefined } });

    // Contest results: a result is "pending" until its rating change is published.
    const cutoff = Date.now() - PENDING_WINDOW_MS;
    for (let i = 0; i < history.length; i += 200) {
      const rows = history.slice(i, i + 200).map((h) => ({
        accountId: acc.id,
        platform: acc.platform,
        contestId: h.contestId,
        name: h.contestName,
        startTime: h.startTime,
        rank: h.rank,
        solved: h.solved,
        totalProblems: h.totalProblems,
        oldRating: h.oldRating,
        newRating: h.newRating,
        status: (h.newRating == null && h.startTime.getTime() > cutoff ? "pending" : "final") as "pending" | "final",
        updatedAt: now,
      }));
      await db
        .insert(contestResults)
        .values(rows)
        .onConflictDoUpdate({
          target: [contestResults.accountId, contestResults.contestId],
          set: {
            name: sql`excluded.name`,
            rank: sql`excluded.rank`,
            solved: sql`excluded.solved`,
            oldRating: sql`excluded.old_rating`,
            newRating: sql`excluded.new_rating`,
            status: sql`excluded.status`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
    // Mirror platform penalties: a contest the platform no longer lists (e.g. removed rating change) is dropped.
    if (history.length) {
      const ids = history.map((h) => h.contestId);
      await db.delete(contestResults).where(and(eq(contestResults.accountId, acc.id), notInArray(contestResults.contestId, ids)));
    }

    if (activity.days.length) {
      await db
        .insert(dailyActivity)
        .values(activity.days.map((d) => ({ userId: acc.userId, day: d.date, platform: acc.platform, accepted: d.count })))
        .onConflictDoUpdate({ target: [dailyActivity.userId, dailyActivity.day, dailyActivity.platform], set: { accepted: sql`excluded.accepted` } });
    }

    await db.update(platformAccounts).set({ syncStatus: "ok", lastSyncedAt: now, lastError: null }).where(eq(platformAccounts.id, acc.id));
    await recordSourceResult(db, acc.platform);
  } catch (err) {
    const e = err instanceof AdapterError ? err : null;
    // Renamed/deleted handle → pause and ask the member to re-link.
    const syncStatus = e?.kind === "not_found" ? "paused" : "error";
    let message = err instanceof Error ? err.message : String(err);
    if (e?.kind === "not_found") message = "Handle no longer resolves — it may have been renamed or deleted. Please re-link this account.";
    await db.update(platformAccounts).set({ syncStatus, lastError: message.slice(0, 500) }).where(eq(platformAccounts.id, acc.id));
    await recordSourceResult(db, acc.platform, err);
    throw err;
  }
}

/** Refresh the upcoming-contest calendar from each platform; one failing source doesn't stop the others. */
export async function syncContests(db: Db, adapters: Record<Platform, PlatformAdapter> = getAdapters()): Promise<Record<Platform, number | string>> {
  const out = {} as Record<Platform, number | string>;
  await Promise.all(
    (Object.keys(adapters) as Platform[]).map(async (p) => {
      try {
        const list = await adapters[p].getUpcomingContests();
        for (const c of list) {
          const row = { platform: c.platform, externalId: c.externalId, name: c.name, url: c.url, startTime: c.startTime, durationSeconds: c.durationSeconds, source: "direct", updatedAt: new Date() };
          await db
            .insert(contests)
            .values(row)
            .onConflictDoUpdate({ target: [contests.platform, contests.externalId], set: { name: row.name, url: row.url, startTime: row.startTime, durationSeconds: row.durationSeconds, updatedAt: row.updatedAt } });
        }
        out[p] = list.length;
        await recordSourceResult(db, p);
      } catch (err) {
        out[p] = err instanceof Error ? err.message : String(err);
        await recordSourceResult(db, p, err);
      }
    }),
  );
  return out;
}
