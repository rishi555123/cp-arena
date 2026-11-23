import { DEFAULT_CONFIG, PLATFORMS, PLATFORM_LABEL, type Platform } from "@cp-arena/scoring";
import Link from "next/link";
import { Avatar, DivisionBadge, PlatformRating, RankChange, Sparkline } from "@/components/bits";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { getBoard, type BoardRow } from "@/lib/queries";
import { requireMember } from "@/lib/session";
import { cn, fmt, formatIST } from "@/lib/utils";

export const metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

type Tab = "overall" | "season" | "weekly" | Platform | "solved" | "streaks";
const TABS: { key: Tab; label: string; soon?: string }[] = [
  { key: "overall", label: "Overall" },
  { key: "season", label: "Season", soon: "Seasons arrive in checkpoint 6" },
  { key: "weekly", label: "Weekly climbers" },
  { key: "leetcode", label: "LeetCode" },
  { key: "codeforces", label: "Codeforces" },
  { key: "codechef", label: "CodeChef" },
  { key: "solved", label: "Problems solved" },
  { key: "streaks", label: "Streaks", soon: "Streaks arrive in checkpoint 6" },
];

interface Ranked extends BoardRow {
  pos: number;
  metric: string;
}

function rankFor(tab: Tab, rows: BoardRow[]): Ranked[] {
  let sorted: BoardRow[];
  let metric: (r: BoardRow) => string;
  switch (tab) {
    case "weekly":
      // Only members who were ranked a week ago can "climb"; ties → higher Power.
      sorted = rows.filter((r) => r.change7 != null).sort((a, b) => b.change7! - a.change7! || b.power - a.power);
      metric = (r) => `${r.change7! > 0 ? "+" : ""}${r.change7} places`;
      break;
    case "leetcode":
    case "codeforces":
    case "codechef":
      sorted = rows.filter((r) => r.platforms[tab]?.verified && r.platforms[tab]?.rating != null).sort((a, b) => b.platforms[tab]!.rating! - a.platforms[tab]!.rating!);
      metric = (r) => `${r.platforms[tab]!.rating} rating`;
      break;
    case "solved":
      sorted = [...rows].sort((a, b) => b.components.weightedSolves - a.components.weightedSolves);
      metric = (r) => `${fmt(r.components.weightedSolves)} weighted`;
      break;
    default:
      sorted = rows;
      metric = (r) => `${fmt(r.power, 1)} Power`;
  }
  return sorted.map((r, i) => ({ ...r, pos: i + 1, metric: metric(r) }));
}

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireMember();
  const sp = await searchParams;
  const tab = (TABS.find((t) => t.key === sp.tab && !t.soon)?.key ?? "overall") as Tab;
  const { day, rows } = await getBoard();

  const ranked = rankFor(tab, rows);
  const q = sp.q?.trim().toLowerCase();
  const filtered = ranked.filter(
    (r) =>
      (!q || r.name.toLowerCase().includes(q) || Object.values(r.platforms).some((c) => c?.handle.toLowerCase().includes(q))) &&
      (!sp.division || r.division === sp.division) &&
      (!sp.group || r.groupTag === sp.group) &&
      (!sp.platform || r.platforms[sp.platform as Platform]?.verified),
  );
  const mine = ranked.find((r) => r.userId === me.id);
  const groups = [...new Set(rows.map((r) => r.groupTag).filter(Boolean))].sort() as string[];
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/leaderboard?${p}`;
  };
  const filtering = Boolean(q || sp.division || sp.group || sp.platform);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Leaderboard</h1>
          <p className="text-xs text-muted-foreground">
            {day ? `Scores as of ${formatIST(new Date(`${day}T00:00:00Z`), { dateStyle: "medium" })} · ${rows.length} ranked members · ` : "No scores yet · "}
            <Link href="/scoring" className="underline">
              how Power works
            </Link>
          </p>
        </div>
      </div>

      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1" aria-label="Leaderboard tabs">
        {TABS.map((t) =>
          t.soon ? (
            <span key={t.key} title={t.soon} aria-disabled className="shrink-0 cursor-not-allowed rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground">
              {t.label}
            </span>
          ) : (
            <Link
              key={t.key}
              href={href({ tab: t.key === "overall" ? undefined : t.key })}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn("shrink-0 rounded-full border px-3 py-1 text-sm", tab === t.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
            >
              {t.label}
            </Link>
          ),
        )}
      </nav>

      {/* Viewer's own row, pinned on every tab */}
      {mine ? (
        <Card className="sticky top-12 z-10 flex items-center gap-3 border-primary/60 bg-card/95 p-3 backdrop-blur">
          <span className="w-10 text-center text-lg font-bold tabular-nums">#{mine.pos}</span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold">You · {mine.name}</span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {mine.metric} <DivisionBadge division={mine.division} rank={mine.divisionRank} /> <RankChange value={mine.change7} /> <span>vs 7 days ago</span>
            </span>
          </div>
          <Link href={`#row-${me.id}`} className="shrink-0 text-sm underline">
            Jump to me
          </Link>
        </Card>
      ) : (
        <Card className="p-3 text-sm text-muted-foreground">
          You&apos;re not on this board yet — {tab === "overall" ? "verify at least one account and wait for the first sync." : "link and verify this platform, or enter a rated contest."}{" "}
          <Link href="/onboarding" className="underline">
            Manage accounts
          </Link>
        </Card>
      )}

      <form className="flex flex-wrap gap-2" action="/leaderboard">
        {tab !== "overall" && <input type="hidden" name="tab" value={tab} />}
        <Input name="q" defaultValue={sp.q} placeholder="Search name or handle" className="w-full sm:w-56" aria-label="Search by name or handle" />
        <Select name="division" defaultValue={sp.division ?? ""} aria-label="Filter by division">
          <option value="">All divisions</option>
          {DEFAULT_CONFIG.divisions.map((d) => (
            <option key={d.name}>{d.name}</option>
          ))}
        </Select>
        <Select name="group" defaultValue={sp.group ?? ""} aria-label="Filter by group">
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </Select>
        <Select name="platform" defaultValue={sp.platform ?? ""} aria-label="Filter by platform">
          <option value="">Any platform</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              On {PLATFORM_LABEL[p]}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
        {filtering && (
          <Link href={href({ q: undefined, division: undefined, group: undefined, platform: undefined })} className="self-center text-sm underline">
            Clear
          </Link>
        )}
      </form>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Rank</th>
                <th className="px-2" title="Change in overall rank vs 7 days ago">
                  7d
                </th>
                <th className="px-2">Member</th>
                <th className="px-2">Division</th>
                <th className="px-2 text-right">Power</th>
                {PLATFORMS.map((p) => (
                  <th key={p} className="px-2">
                    {PLATFORM_LABEL[p]}
                  </th>
                ))}
                <th className="px-2">Last active</th>
                <th className="px-3">30 days</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isMe = r.userId === me.id;
                return (
                  <tr key={r.userId} id={`row-${r.userId}`} className={cn("scroll-mt-40 border-t", isMe && "bg-primary/10")}>
                    <td className="px-3 py-2 font-semibold tabular-nums">
                      #{r.pos}
                      {tab !== "overall" && <span className="block text-[11px] font-normal text-muted-foreground">#{r.rank} overall</span>}
                    </td>
                    <td className="px-2">
                      <RankChange value={r.change7} />
                    </td>
                    <td className="px-2">
                      <Link href={`/u/${r.userId}`} className="flex items-center gap-2 hover:underline">
                        <Avatar name={r.name} image={r.image} />
                        <span className="flex flex-col leading-tight">
                          <span className="font-medium">
                            {r.name}
                            {isMe && <Badge className="ml-1 border-primary/60 text-[10px]">you</Badge>}
                          </span>
                          {r.groupTag && <span className="text-[11px] text-muted-foreground">{r.groupTag}</span>}
                        </span>
                      </Link>
                    </td>
                    <td className="px-2">
                      <DivisionBadge division={r.division} rank={r.divisionRank} />
                    </td>
                    <td className="px-2 text-right font-semibold tabular-nums">
                      {fmt(r.power, 1)}
                      {tab !== "overall" && <span className="block text-[11px] font-normal text-muted-foreground">{r.metric}</span>}
                    </td>
                    {PLATFORMS.map((p) => (
                      <td key={p} className="px-2">
                        <PlatformRating platform={p} cell={r.platforms[p]} />
                      </td>
                    ))}
                    <td className="px-2 text-xs text-muted-foreground">{r.lastActive ? formatIST(new Date(`${r.lastActive}T12:00:00Z`), { day: "numeric", month: "short" }) : "—"}</td>
                    <td className="px-3">
                      <Sparkline values={r.spark} />
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">
                    {rows.length === 0 ? "No ranked members yet. Run `npm run seed` for demo data, or verify an account and start the worker." : "No members match these filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-muted-foreground">
        Ties: higher momentum first, then whoever reached the score first. Only verified accounts count. Drops are shown neutrally — there is no &ldquo;bottom&rdquo; list.
      </p>
    </div>
  );
}
