import { auditLog, enqueueAccountSync, getDb, platformAccounts, sourceHealth, syncJobs, users } from "@cp-arena/db";
import { PLATFORMS, PLATFORM_LABEL } from "@cp-arena/scoring";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { requireAdmin } from "@/lib/session";
import { formatIST, timeAgo } from "@/lib/utils";

export const metadata = { title: "Sync health" };
export const dynamic = "force-dynamic";

async function resyncAll() {
  "use server";
  const admin = await requireAdmin();
  const db = getDb();
  const rows = await db.select({ id: platformAccounts.id }).from(platformAccounts).where(and(eq(platformAccounts.synthetic, false), eq(platformAccounts.verified, true)));
  for (const r of rows) await enqueueAccountSync(db, r.id, 1);
  await db.insert(syncJobs).values({ kind: "contests", priority: 1 });
  await db.insert(auditLog).values({ actorId: admin.id, action: "admin.resync_all", meta: { accounts: rows.length } });
  revalidatePath("/admin/sync-health");
}

async function resyncOne(formData: FormData) {
  "use server";
  const admin = await requireAdmin();
  const id = String(formData.get("accountId"));
  await enqueueAccountSync(getDb(), id, 5);
  await getDb().insert(auditLog).values({ actorId: admin.id, action: "admin.resync_account", target: id });
  revalidatePath("/admin/sync-health");
}

const STATE_STYLE = { ok: "border-up/60 text-up", degraded: "border-primary/60 text-primary", down: "border-down/60 text-down" } as const;

export default async function SyncHealthPage() {
  await requireAdmin();
  const db = getDb();
  const [health, queue, problemAccounts, failedJobs, accountCounts] = await Promise.all([
    db.select().from(sourceHealth),
    db.select({ status: syncJobs.status, n: sql<number>`count(*)::int` }).from(syncJobs).groupBy(syncJobs.status),
    db
      .select({ id: platformAccounts.id, platform: platformAccounts.platform, handle: platformAccounts.handle, status: platformAccounts.syncStatus, error: platformAccounts.lastError, lastSyncedAt: platformAccounts.lastSyncedAt, name: users.name })
      .from(platformAccounts)
      .innerJoin(users, eq(users.id, platformAccounts.userId))
      .where(inArray(platformAccounts.syncStatus, ["error", "paused"]))
      .limit(100),
    db.select().from(syncJobs).where(eq(syncJobs.status, "failed")).orderBy(desc(syncJobs.finishedAt)).limit(15),
    db
      .select({ platform: platformAccounts.platform, synthetic: platformAccounts.synthetic, n: sql<number>`count(*)::int`, stale: sql<number>`count(*) filter (where ${platformAccounts.lastSyncedAt} < now() - interval '12 hours' or ${platformAccounts.lastSyncedAt} is null)::int` })
      .from(platformAccounts)
      .where(eq(platformAccounts.verified, true))
      .groupBy(platformAccounts.platform, platformAccounts.synthetic),
  ]);
  const q = Object.fromEntries(queue.map((r) => [r.status, r.n])) as Record<string, number>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Sync health</h1>
          <p className="text-sm text-muted-foreground">Per-source status from the worker. Stale-but-available beats broken: the board keeps the last good data.</p>
        </div>
        <form action={resyncAll}>
          <Button type="submit" variant="outline">
            Resync all real accounts
          </Button>
        </form>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {PLATFORMS.map((p) => {
          const h = health.find((x) => x.source === p);
          const real = accountCounts.find((a) => a.platform === p && !a.synthetic);
          const total = (h?.successCount ?? 0) + (h?.errorCount ?? 0);
          return (
            <Card key={p}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>{PLATFORM_LABEL[p]}</CardTitle>
                {h ? <Badge className={STATE_STYLE[h.state]}>{h.state}</Badge> : <Badge>no data yet</Badge>}
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <Row k="Last success" v={h?.lastSuccessAt ? `${timeAgo(h.lastSuccessAt)} (${formatIST(h.lastSuccessAt)})` : "—"} />
                <Row k="Error rate" v={total ? `${Math.round((100 * (h?.errorCount ?? 0)) / total)}% of ${total} calls` : "—"} />
                <Row k="Parser failures" v={String(h?.parserFailures ?? 0)} />
                <Row k="Circuit" v={h?.circuitOpenUntil && h.circuitOpenUntil > new Date() ? `open until ${formatIST(h.circuitOpenUntil)}` : "closed"} />
                <Row k="Verified real accounts" v={`${real?.n ?? 0} (${real?.stale ?? 0} stale >12h)`} />
                {h?.lastError && (
                  <p className="pt-1 text-xs text-down" title={h.lastError}>
                    Last error {timeAgo(h.lastErrorAt)}: {h.lastError.slice(0, 140)}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Queue</CardTitle>
          <CardDescription>Postgres-backed job queue (sync_jobs). Run the worker with `npm run worker`.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 text-sm">
          {(["queued", "running", "done", "failed"] as const).map((s) => (
            <span key={s}>
              {s}: <strong>{q[s] ?? 0}</strong>
            </span>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts needing attention</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {problemAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Member</th>
                  <th>Platform</th>
                  <th>Status</th>
                  <th>Error</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {problemAccounts.map((a) => (
                  <tr key={a.id} className="border-t">
                    <td className="py-1.5">
                      {a.name} <span className="text-muted-foreground">({a.handle})</span>
                    </td>
                    <td>{PLATFORM_LABEL[a.platform]}</td>
                    <td>{a.status}</td>
                    <td className="max-w-xs truncate text-xs text-muted-foreground" title={a.error ?? ""}>
                      {a.error}
                    </td>
                    <td>
                      <form action={resyncOne}>
                        <input type="hidden" name="accountId" value={a.id} />
                        <Button size="sm" variant="ghost">
                          Resync
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent failed jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs">
          {failedJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            failedJobs.map((j) => (
              <p key={j.id}>
                #{j.id} {j.kind} · {j.attempts} attempts · {timeAgo(j.finishedAt)} · <span className="text-muted-foreground">{j.lastError}</span>
              </p>
            ))
          )}
        </CardContent>
      </Card>
      {/* TODO(checkpoint 7): error-rate charts, alerting admins on parser failures, per-source manual pause. */}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}
