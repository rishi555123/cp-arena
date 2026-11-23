import { getDb, platformAccounts } from "@cp-arena/db";
import { PLATFORMS, PLATFORM_LABEL, type Platform } from "@cp-arena/scoring";
import { eq } from "drizzle-orm";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { timeAgo } from "@/lib/utils";
import { acceptConsent, deleteMyAccount, finishOnboarding, linkAccount, unlinkAccount, verifyAccount } from "./actions";

export const metadata = { title: "Accounts" };

const WHERE_TO_PASTE: Record<Platform, { field: string; url: string }> = {
  codeforces: { field: "First name (Settings → Social)", url: "https://codeforces.com/settings/social" },
  codechef: { field: "Name (Edit profile)", url: "https://www.codechef.com/" },
  leetcode: { field: "Summary / About me, or Name (Edit profile)", url: "https://leetcode.com/profile/" },
};
const PLACEHOLDER: Record<Platform, string> = {
  leetcode: "leetcode.com/u/handle or handle",
  codeforces: "codeforces.com/profile/handle or handle",
  codechef: "codechef.com/users/handle or handle",
};

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const accounts = await getDb().select().from(platformAccounts).where(eq(platformAccounts.userId, me.id));
  const byPlatform = new Map(accounts.map((a) => [a.platform, a]));
  const syncing = accounts.some((a) => a.verified && (a.syncStatus === "pending" || a.syncStatus === "syncing"));
  const allLinked = PLATFORMS.every((p) => byPlatform.has(p));
  const active = me.status === "active";

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8">
      <AutoRefresh active={syncing} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{active ? "Linked accounts" : "Join CP Arena"}</h1>
        {active && (
          <Link href="/leaderboard" className="text-sm text-muted-foreground hover:underline">
            ← Back to leaderboard
          </Link>
        )}
      </div>

      {sp.err && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-down/50 bg-down/10 p-3 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {sp.err}
        </p>
      )}
      {sp.msg && (
        <p role="status" className="flex items-start gap-2 rounded-md border border-up/50 bg-up/10 p-3 text-sm">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> {sp.msg}
        </p>
      )}

      {!me.consentAt ? (
        <Card>
          <CardHeader>
            <CardTitle>Step 1 · What we collect and who sees it</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>
                <strong className="text-foreground">What:</strong> only public data from the profiles you link — ratings, contest results, solved counts and
                public activity calendars. We never ask for passwords or cookies.
              </li>
              <li>
                <strong className="text-foreground">Who sees it:</strong> signed-in community members only. You can show your handle instead of your name.
              </li>
              <li>
                <strong className="text-foreground">Leaving:</strong> unlink any platform at any time, or delete your account — that hard-deletes everything we
                stored about you.
              </li>
            </ul>
            <form action={acceptConsent} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                Name shown to members
                <Input name="name" required defaultValue={me.name ?? ""} maxLength={60} />
              </label>
              <label className="flex flex-col gap-1">
                Batch / branch (optional, used for filters)
                <Input name="group" placeholder="e.g. CSE-2026" maxLength={30} />
              </label>
              <label className="flex flex-col gap-1">
                Invite code
                <Input name="invite" required placeholder="ARENA2026" autoCapitalize="characters" />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="consent" required className="size-4" /> I understand and agree.
              </label>
              <Button type="submit">Continue</Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {active ? "Manage your linked profiles." : "Step 2 · Link all three profiles, then prove each one is yours."} Only verified accounts count towards your rank.
          </p>
          {PLATFORMS.map((p) => {
            const acc = byPlatform.get(p);
            return (
              <Card key={p} id={p} className={sp.p === p ? "ring-2 ring-ring" : ""}>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>{PLATFORM_LABEL[p]}</CardTitle>
                  {acc && (acc.verified ? <Badge className="border-up/60 text-up">✓ Verified</Badge> : <Badge>Not verified</Badge>)}
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  {acc && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Handle: <strong>{acc.handle}</strong>
                      </span>
                      {acc.verified && <SyncState status={acc.syncStatus} lastSyncedAt={acc.lastSyncedAt} error={acc.lastError} synthetic={acc.synthetic} />}
                    </div>
                  )}
                  {acc && !acc.verified && acc.verifyToken && (
                    <div className="rounded-md border border-dashed p-3">
                      <p>
                        Paste <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-base font-bold">{acc.verifyToken}</code> into your{" "}
                        <a className="underline" href={WHERE_TO_PASTE[p].url} target="_blank" rel="noreferrer">
                          {PLATFORM_LABEL[p]} {WHERE_TO_PASTE[p].field}
                        </a>
                        , save, then press Verify. You can remove it afterwards.
                      </p>
                      {p === "leetcode" && (
                        <p className="mt-2 text-xs text-muted-foreground">Tip: if your submissions don&apos;t show up later, enable &ldquo;Display my submission history&rdquo; in LeetCode privacy settings.</p>
                      )}
                      <form action={verifyAccount} className="mt-3">
                        <input type="hidden" name="accountId" value={acc.id} />
                        <Button type="submit" size="sm">
                          Verify
                        </Button>
                      </form>
                    </div>
                  )}
                  <form action={linkAccount} className="flex gap-2">
                    <input type="hidden" name="platform" value={p} />
                    <Input name="handle" placeholder={PLACEHOLDER[p]} aria-label={`${PLATFORM_LABEL[p]} handle or profile URL`} required />
                    <Button type="submit" variant={acc ? "outline" : "default"} size="default">
                      {acc ? "Change" : "Link"}
                    </Button>
                  </form>
                  {acc && (
                    <form action={unlinkAccount}>
                      <input type="hidden" name="accountId" value={acc.id} />
                      <button className="text-xs text-muted-foreground underline">Unlink {PLATFORM_LABEL[p]} and delete its data</button>
                    </form>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {!active && (
            <form action={finishOnboarding}>
              <Button type="submit" size="lg" className="w-full" disabled={!allLinked}>
                {allLinked ? "Finish and see my dashboard" : "Link all three platforms to finish"}
              </Button>
            </form>
          )}
          <Card className="border-down/30">
            <CardHeader>
              <CardTitle>Delete my account</CardTitle>
              <CardDescription>Hard delete: removes your profile, linked accounts, history and scores. This can&apos;t be undone.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={deleteMyAccount} className="flex gap-2">
                <Input name="confirm" placeholder="Type DELETE" aria-label="Type DELETE to confirm" />
                <Button type="submit" variant="outline">
                  Delete
                </Button>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}

function SyncState({ status, lastSyncedAt, error, synthetic }: { status: string; lastSyncedAt: Date | null; error: string | null; synthetic: boolean }) {
  if (synthetic) return <span className="text-xs text-muted-foreground">Demo account · not synced</span>;
  if (status === "pending" || status === "syncing")
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
        <Loader2 className="size-3 animate-spin" aria-hidden /> {status === "pending" ? "Queued for sync…" : "Syncing…"} (needs the worker running)
      </span>
    );
  if (status === "error" || status === "paused")
    return (
      <span className="text-xs text-down" title={error ?? ""}>
        {status === "paused" ? "Paused — please re-link" : "Last sync failed"} · {error?.slice(0, 80)}
      </span>
    );
  return <span className="text-xs text-muted-foreground">Last synced {timeAgo(lastSyncedAt)}</span>;
}
