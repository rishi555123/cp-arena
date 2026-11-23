import { contests, getDb } from "@cp-arena/db";
import { PLATFORMS, PLATFORM_LABEL, type Platform } from "@cp-arena/scoring";
import { and, asc, gte, lte } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { requireMember } from "@/lib/session";
import { cn, formatIST, timeUntil } from "@/lib/utils";

export const metadata = { title: "Contests" };
export const dynamic = "force-dynamic";

export default async function ContestsPage({ searchParams }: { searchParams: Promise<{ platform?: string }> }) {
  await requireMember();
  const { platform } = await searchParams;
  const now = new Date();
  const rows = await getDb()
    .select()
    .from(contests)
    // include contests that started in the last 3 hours (likely still running)
    .where(and(gte(contests.startTime, new Date(now.getTime() - 3 * 3600_000)), lte(contests.startTime, new Date(now.getTime() + 30 * 86_400_000))))
    .orderBy(asc(contests.startTime));
  const list = rows.filter((c) => !platform || c.platform === platform);

  // Group by IST calendar day.
  const groups = new Map<string, typeof list>();
  for (const c of list) {
    const key = formatIST(c.startTime, { weekday: "long", day: "numeric", month: "long" });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">Upcoming contests</h1>
        <p className="text-xs text-muted-foreground">Next 30 days, times in IST. Refreshed hourly by the worker.</p>
      </div>
      <nav className="flex flex-wrap gap-1" aria-label="Filter by platform">
        {[undefined, ...PLATFORMS].map((p) => (
          <Link
            key={p ?? "all"}
            href={p ? `/contests?platform=${p}` : "/contests"}
            aria-current={platform === p ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1 text-sm", platform === p ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
          >
            {p ? PLATFORM_LABEL[p] : "All"}
          </Link>
        ))}
      </nav>

      {list.length === 0 && <Card className="p-6 text-center text-sm text-muted-foreground">No upcoming contests found. Is the worker running?</Card>}

      {[...groups].map(([day, cs]) => (
        <section key={day} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{day}</h2>
          {cs.map((c) => {
            const running = c.startTime <= now;
            return (
              <Card key={c.id} className="flex flex-wrap items-center gap-3 p-3">
                <Badge className="w-24 justify-center">{PLATFORM_LABEL[c.platform as Platform]}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatIST(c.startTime, { hour: "2-digit", minute: "2-digit" })} IST · {Math.round(c.durationSeconds / 60)} min
                    {c.source === "seed" && " · placeholder (demo)"}
                  </div>
                </div>
                <span className={cn("text-sm tabular-nums", running && "font-semibold text-up")}>{running ? "running now" : timeUntil(c.startTime, now.getTime())}</span>
                <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline">
                  Open <ExternalLink className="size-3" aria-hidden />
                </a>
              </Card>
            );
          })}
        </section>
      ))}
      <p className="text-xs text-muted-foreground">Coming next (checkpoint 4): calendar view, &ldquo;I&apos;m in&rdquo; RSVPs, reminders, .ics / iCal feed and group results.</p>
    </div>
  );
}
