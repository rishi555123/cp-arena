/**
 * Sync worker: a long-running Node process with a tiny Postgres-backed job queue (sync_jobs).
 *
 *   npm run worker      — run forever (poll queue, schedule full syncs, contests, recompute)
 *   npm run sync:once   — sync every real account + contests, recompute today, exit
 *
 * TODO(next): swap the hand-rolled queue for pg-boss; incremental Codeforces user.status;
 * weekly CF user.ratedList refresh; post-contest backoff re-syncs; nightly snapshot at 00:05 IST.
 */
import { getAdapters, type PlatformAdapter, type Platform } from "@cp-arena/adapters";
import { closeDb, enqueueAccountSync, getDb, loadEnv, platformAccounts, recomputeScores, syncAccount, syncContests, syncJobs, toDay, type Db } from "@cp-arena/db";
import { and, eq, lt, sql } from "drizzle-orm";

loadEnv();
const POLL_MS = Number(process.env.WORKER_POLL_SECONDS ?? 5) * 1000;
const FULL_SYNC_MS = Number(process.env.WORKER_FULL_SYNC_HOURS ?? 6) * 3600_000;
const CONTESTS_MS = 3600_000;
const MAX_ATTEMPTS = 4;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** Enqueue every real (non-seed), non-paused account. */
async function enqueueFullSync(db: Db): Promise<number> {
  const rows = await db
    .select({ id: platformAccounts.id })
    .from(platformAccounts)
    .where(and(eq(platformAccounts.synthetic, false), sql`${platformAccounts.syncStatus} <> 'paused'`));
  for (const r of rows) await enqueueAccountSync(db, r.id);
  return rows.length;
}

/** Claim one due job atomically (SKIP LOCKED lets several workers share the queue). */
async function claimJob(db: Db) {
  const rows = await db.execute<{ id: number; kind: string; account_id: string | null; attempts: number }>(sql`
    update sync_jobs set status = 'running', started_at = now(), attempts = attempts + 1
    where id = (
      select id from sync_jobs where status = 'queued' and run_at <= now()
      order by priority desc, run_at asc limit 1 for update skip locked
    )
    returning id, kind, account_id, attempts`);
  return rows[0];
}

async function runJob(db: Db, job: { id: number; kind: string; account_id: string | null; attempts: number }, adapters: Record<Platform, PlatformAdapter>) {
  try {
    if (job.kind === "account" && job.account_id) await syncAccount(db, job.account_id, adapters);
    else if (job.kind === "contests") await syncContests(db, adapters);
    else if (job.kind === "recompute") await recomputeScores(db, [toDay(new Date())]);
    await db.update(syncJobs).set({ status: "done", finishedAt: new Date(), lastError: null }).where(eq(syncJobs.id, job.id));
    return true;
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    const kind = (err as { kind?: string }).kind;
    const retry = job.attempts < MAX_ATTEMPTS && kind !== "not_found" && kind !== "parse";
    // Jittered exponential backoff: ~1m, 4m, 16m…
    const delay = 60_000 * 4 ** (job.attempts - 1) * (0.5 + Math.random());
    await db
      .update(syncJobs)
      .set(retry ? { status: "queued", runAt: new Date(Date.now() + delay), lastError: msg } : { status: "failed", finishedAt: new Date(), lastError: msg })
      .where(eq(syncJobs.id, job.id));
    log(`job ${job.id} (${job.kind}) failed: ${msg}${retry ? " — will retry" : ""}`);
    return false;
  }
}

async function drain(db: Db, adapters: Record<Platform, PlatformAdapter>): Promise<number> {
  let n = 0;
  for (let job = await claimJob(db); job; job = await claimJob(db)) {
    await runJob(db, job, adapters);
    n++;
  }
  return n;
}

async function once() {
  const db = getDb();
  const adapters = getAdapters();
  log("contests:", await syncContests(db, adapters));
  log(`enqueued ${await enqueueFullSync(db)} accounts`);
  const n = await drain(db, adapters);
  const r = await recomputeScores(db, [toDay(new Date())]);
  log(`processed ${n} jobs; recomputed ${r.rows} scores`);
}

async function forever() {
  const db = getDb();
  const adapters = getAdapters();
  // Jobs stuck in "running" from a crashed worker go back to the queue.
  await db.update(syncJobs).set({ status: "queued" }).where(and(eq(syncJobs.status, "running"), lt(syncJobs.startedAt, new Date(Date.now() - 30 * 60_000))));

  let lastFull = 0;
  let lastContests = 0;
  let stopping = false;
  for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => ((stopping = true), log("stopping after current job…")));

  log(`worker up — poll ${POLL_MS / 1000}s, full sync every ${FULL_SYNC_MS / 3600_000}h`);
  while (!stopping) {
    const now = Date.now();
    if (now - lastContests > CONTESTS_MS) {
      lastContests = now;
      await db.insert(syncJobs).values({ kind: "contests" });
    }
    if (now - lastFull > FULL_SYNC_MS) {
      lastFull = now;
      log(`full sync: enqueued ${await enqueueFullSync(db)} accounts`);
    }
    const processed = await drain(db, adapters).catch((e) => (log("drain error", e), 0));
    // Recompute once the queue is drained so a batch of syncs costs one recompute.
    if (processed > 0) {
      const r = await recomputeScores(db, [toDay(new Date())]).catch((e) => (log("recompute error", e), null));
      if (r) log(`processed ${processed} jobs; recomputed ${r.rows} scores`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

const main = process.argv.includes("--once") ? once : forever;
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closeDb);
