import { REFRESH_COOLDOWN_MS, addDays } from "@cp-arena/db";
import { DEFAULT_CONFIG, PLATFORMS, PLATFORM_LABEL, TIER_BANDS, estimateGains, type Platform, type PowerComponents } from "@cp-arena/scoring";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, DivisionBadge, PlatformRating, RankChange } from "@/components/bits";
import { DifficultyChart, PLATFORM_COLOR, PowerRankChart, RatingChart, SolvedStackChart } from "@/components/charts";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Unavailable } from "@/components/ui";
import { displayNameOf, getProfile, type ProfileData } from "@/lib/queries";
import { requireMember } from "@/lib/session";
import { fmt, formatIST, timeAgo } from "@/lib/utils";
import { RefreshButton } from "./refresh-button";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = /^[0-9a-f-]{36}$/i.test(id) ? await getProfile(id) : null;
  return { title: p ? displayNameOf(p.user, p.accounts[0]?.handle) : "Member" };
}

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMember();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const p = await getProfile(id);
  if (!p) notFound();
  const isMe = me.id === id;
  const name = displayNameOf(p.user, p.accounts[0]?.handle);
  const latest = p.latest;
  const comp = latest?.components as PowerComponents | undefined;
  const rankAt = (days: number) => (p.day ? p.history.find((h) => h.day === addDays(p.day!, -days))?.overallRank : undefined);
  const ch7 = latest && rankAt(7) != null ? rankAt(7)! - latest.overallRank : null;
  const ch30 = latest && rankAt(30) != null ? rankAt(30)! - latest.overallRank : null;

  const real = p.accounts.filter((a) => a.verified && !a.synthetic);
  const lastSynced = real.length ? real.map((a) => a.lastSyncedAt).reduce((a, b) => (a && b ? (a < b ? a : b) : a ?? b), null as Date | null) : null;
  const cooldownMs = (me.lastRefreshRequestedAt?.getTime() ?? 0) + REFRESH_COOLDOWN_MS - Date.now();

  return (
    <div className="flex flex-col gap-5">
      {/* Hero */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <Avatar name={name} image={p.user.image} size={52} />
          <div>
            <h1 className="text-xl font-bold">
              {name} {isMe && <span className="text-sm font-normal text-muted-foreground">(you)</span>}
            </h1>
            <p className="text-xs text-muted-foreground">
              {p.user.groupTag && <>{p.user.groupTag} · </>}
              {real.length ? <>Last synced {timeAgo(lastSynced)}</> : p.accounts.some((a) => a.synthetic) ? "Demo member · not synced" : "No verified accounts yet"}
            </p>
          </div>
        </div>
        {isMe && <RefreshButton cooldownMin={cooldownMs > 0 ? Math.ceil(cooldownMs / 60_000) : 0} />}
      </section>

      {!latest || !comp ? (
        <Card className="p-4 text-sm text-muted-foreground">
          Not ranked yet. {isMe ? <Link href="/onboarding" className="underline">Verify an account</Link> : "This member has no verified, synced accounts yet."}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Overall rank" value={`#${latest.overallRank}`} sub={`of ${p.total}`} />
            <Stat label="7-day change" value={<RankChange value={ch7} className="text-base" />} sub="places" />
            <Stat label="30-day change" value={<RankChange value={ch30} className="text-base" />} sub="places" />
            <Stat label="Power" value={fmt(latest.power, 1)} sub={<DivisionBadge division={latest.division} rank={latest.divisionRank} />} />
            <Stat label="Season rank" value={<Unavailable why="Seasons arrive in checkpoint 6" />} sub="this season" />
            <Stat label="Streak" value={<Unavailable why="Streaks arrive in checkpoint 6" />} sub="weeks" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ScoreBreakdown comp={comp} power={latest.power} />
            <NextTarget p={p} comp={comp} isMe={isMe} />
          </div>
        </>
      )}

      {/* Accounts + last contest per platform */}
      <section className="grid gap-3 md:grid-cols-3">
        {PLATFORMS.map((pl) => (
          <LastContestCard key={pl} platform={pl} p={p} />
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {latest && (
          <Card>
            <CardHeader>
              <CardTitle>Power and overall rank</CardTitle>
              <CardDescription>Daily snapshots. Rank axis is inverted (#1 at the top).</CardDescription>
            </CardHeader>
            <CardContent>
              <PowerRankChart points={p.history.map((h) => ({ t: Date.parse(`${h.day}T00:00:00Z`), power: h.power, rank: h.overallRank }))} />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Problems solved over time</CardTitle>
            <CardDescription>Cumulative unique solves, stacked by platform.</CardDescription>
          </CardHeader>
          <CardContent>
            <SolvedChart p={p} />
          </CardContent>
        </Card>
      </div>

      <section className="grid gap-4 lg:grid-cols-3">
        {PLATFORMS.map((pl) => (
          <RatingCard key={pl} platform={pl} p={p} />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <DifficultyCards p={p} />
      </section>

      <Heatmap p={p} />
      <ContestHistory p={p} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

function ScoreBreakdown({ comp, power }: { comp: PowerComponents; power: number }) {
  const w = DEFAULT_CONFIG.weights;
  const rows = [
    { k: "Contest strength", v: comp.contest, w: w.contest, note: Object.entries(comp.perPlatformContest).map(([pl, pts]) => `${PLATFORM_LABEL[pl as Platform]} ${fmt(pts)}`).join(" · ") || "unrated everywhere" },
    { k: "Problem solving", v: comp.problems, w: w.problems, note: `${fmt(comp.weightedSolves)} weighted solves` },
    {
      k: "Momentum (28 days)",
      v: comp.momentum,
      w: w.momentum,
      note: `${comp.momentumInput.contests} contests · +${fmt(comp.momentumInput.ratingGain)} rating · +${fmt(comp.momentumInput.weightedSolves)} weighted solves`,
    },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>How your score is built</CardTitle>
        <CardDescription>
          Power = 0.5 × A + 0.3 × B + 0.2 × C, each component 0–1000.{" "}
          <Link href="/scoring" className="underline">
            Full formula
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.map((r) => (
          <div key={r.k}>
            <div className="flex justify-between text-sm">
              <span>{r.k}</span>
              <span className="tabular-nums">
                {fmt(r.v)} × {r.w} = <strong>{fmt(r.v * r.w, 1)}</strong>
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(r.v)} aria-valuemin={0} aria-valuemax={1000} aria-label={r.k}>
              <div className="h-2 rounded-full bg-primary" style={{ width: `${r.v / 10}%` }} />
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{r.note}</div>
          </div>
        ))}
        <div className="flex justify-between border-t pt-2 text-sm font-semibold">
          <span>Power</span>
          <span className="tabular-nums">{fmt(power, 1)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function NextTarget({ p, comp, isMe }: { p: ProfileData; comp: PowerComponents; isMe: boolean }) {
  if (!p.above)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Next target</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">#1 overall. Defend it — momentum decays after 28 days.</CardContent>
      </Card>
    );
  const gap = Math.max(0.1, p.above.power - p.latest!.power);
  const ideas = estimateGains(comp)
    .filter((e) => e.gain > 0)
    .slice(0, 3);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Next target</CardTitle>
        <CardDescription>The member directly above {isMe ? "you" : "them"}, and formula-based ways to close the gap.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div>
          <Link href={`/u/${p.above.userId}`} className="font-semibold underline">
            #{p.above.rank} {p.above.name}
          </Link>{" "}
          is <strong>{fmt(gap, 1)}</strong> Power ahead.
        </div>
        {ideas.length ? (
          <ul className="flex flex-col gap-1.5">
            {ideas.map((e) => (
              <li key={e.label} className="flex justify-between gap-2">
                <span>{e.label}</span>
                <Badge className={e.gain >= gap ? "border-up/60 text-up" : ""}>≈ +{fmt(e.gain, 1)}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">Momentum is capped — rating gains are the way up now.</p>
        )}
        <p className="text-xs text-muted-foreground">Estimates assume nothing else changes; rating moves can add more. Labelled as estimates by design.</p>
      </CardContent>
    </Card>
  );
}

function LastContestCard({ platform, p }: { platform: Platform; p: ProfileData }) {
  const acc = p.accounts.find((a) => a.platform === platform);
  const last = p.results.find((r) => r.platform === platform);
  const cell = p.cells[platform];
  const best = p.results.filter((r) => r.platform === platform && r.rank != null).reduce((b, r) => (b == null || r.rank! < b ? r.rank! : b), null as number | null);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{PLATFORM_LABEL[platform]}</CardTitle>
        {acc ? <span className="text-xs text-muted-foreground">@{acc.handle}</span> : <Badge>not linked</Badge>}
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex items-end justify-between">
          <PlatformRating platform={platform} cell={cell} />
          <div className="text-right text-xs text-muted-foreground">
            Max {cell?.maxRating ?? "—"} · Best rank {best != null ? `#${fmt(best)}` : "—"}
          </div>
        </div>
        {last ? (
          <div className="rounded-md bg-muted/50 p-2 text-xs">
            <div className="font-medium">{last.name}</div>
            <div className="text-muted-foreground">{formatIST(last.startTime, { dateStyle: "medium" })}</div>
            <div className="mt-1 flex flex-wrap gap-x-3">
              <span>Rank {last.rank != null ? `#${fmt(last.rank)}` : "—"}</span>
              <span>
                Solved{" "}
                {last.solved != null ? (
                  <>
                    {last.solved}
                    {last.totalProblems ? `/${last.totalProblems}` : ""}
                  </>
                ) : (
                  <Unavailable why={`${PLATFORM_LABEL[platform]} doesn't expose per-contest solves`} />
                )}
              </span>
              <span>
                {last.status === "pending" || last.newRating == null || last.oldRating == null ? (
                  <span className="text-muted-foreground">rating pending</span>
                ) : (
                  <>
                    Δ <RankChange value={last.newRating - last.oldRating} unit="rating" /> → {last.newRating}
                  </>
                )}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No contests yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function RatingCard({ platform, p }: { platform: Platform; p: ProfileData }) {
  const points = p.results
    .filter((r) => r.platform === platform && r.newRating != null && r.status === "final")
    .map((r) => ({ t: r.startTime.getTime(), rating: r.newRating!, contest: r.name }))
    .sort((a, b) => a.t - b.t);
  const bands = TIER_BANDS[platform].map((b, i, all) => ({ label: b.label, min: b.min, max: all[i + 1]?.min ?? 4500, color: b.color }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{PLATFORM_LABEL[platform]} rating</CardTitle>
        <CardDescription>Tier bands shaded{platform === "leetcode" ? " (approximate rating cut-offs)" : ""}.</CardDescription>
      </CardHeader>
      <CardContent>
        {points.length >= 2 ? (
          <RatingChart points={points} bands={bands} color={PLATFORM_COLOR[platform]} label={`${PLATFORM_LABEL[platform]} rating`} />
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">Not enough rated contests to chart.</p>
        )}
      </CardContent>
    </Card>
  );
}

function SolvedChart({ p }: { p: ProfileData }) {
  const byDay = new Map<string, Partial<Record<Platform, number>>>();
  for (const s of p.snaps) {
    if (!byDay.has(s.day)) byDay.set(s.day, {});
    byDay.get(s.day)![s.platform] = s.solvedTotal ?? 0;
  }
  const days = [...byDay.keys()].sort();
  const carry: Record<Platform, number> = { leetcode: 0, codeforces: 0, codechef: 0 };
  const series = days.map((d) => {
    Object.assign(carry, byDay.get(d));
    return { t: Date.parse(`${d}T00:00:00Z`), ...carry };
  });
  // Weekly samples keep the chart light; always include the latest point.
  const sampled = series.filter((_, i) => i % 7 === 0 || i === series.length - 1);
  if (sampled.length < 2) return <p className="py-10 text-center text-sm text-muted-foreground">Not enough history yet.</p>;
  return <SolvedStackChart points={sampled} />;
}

function DifficultyCards({ p }: { p: ProfileData }) {
  const latestSolved = (pl: Platform) => [...p.snaps].reverse().find((s) => s.platform === pl)?.solved as Record<string, unknown> | undefined;
  const lc = latestSolved("leetcode") as { easy: number; medium: number; hard: number } | undefined;
  const cf = latestSolved("codeforces") as { buckets: Record<string, number> } | undefined;
  const cfOrder = [...DEFAULT_CONFIG.cfBuckets.map((b) => b.key), "unrated"];
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>LeetCode by difficulty</CardTitle>
          <CardDescription>Weights: Easy 1 · Medium 3 · Hard 6</CardDescription>
        </CardHeader>
        <CardContent>
          {lc ? (
            <DifficultyChart
              color={PLATFORM_COLOR.leetcode}
              data={[
                { label: "Easy", count: lc.easy },
                { label: "Medium", count: lc.medium },
                { label: "Hard", count: lc.hard },
              ]}
            />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No LeetCode data.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Codeforces by problem rating</CardTitle>
          <CardDescription>Weights: 1 · 2 · 3 · 5 · 8 (unrated 1)</CardDescription>
        </CardHeader>
        <CardContent>
          {cf?.buckets ? (
            <DifficultyChart color={PLATFORM_COLOR.codeforces} data={cfOrder.map((k) => ({ label: k, count: cf.buckets[k] ?? 0 }))} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No Codeforces data.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** Combined activity heatmap (last 26 weeks), server-rendered. */
function Heatmap({ p }: { p: ProfileData }) {
  if (!p.day) return null;
  const counts = new Map(p.activity.map((a) => [a.day, a.n]));
  const end = new Date(`${p.day}T00:00:00Z`);
  const start = new Date(end.getTime() - (26 * 7 - 1 + end.getUTCDay()) * 86_400_000); // align to Sunday
  const cells: { day: string; n: number }[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    cells.push({ day, n: counts.get(day) ?? 0 });
  }
  const level = (n: number) => (n === 0 ? 0 : n <= 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);
  const opacity = [0, 0.3, 0.5, 0.75, 1];
  const activeDays = cells.filter((c) => c.n > 0).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>
          {activeDays} active days in the last 26 weeks, all platforms. Codeforces counts accepted problems; LeetCode only exposes submissions; CodeChef activity isn&apos;t
          available yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <div className="grid w-max grid-flow-col grid-rows-7 gap-[3px]" role="img" aria-label={`Activity heatmap: ${activeDays} active days`}>
          {cells.map((c) => (
            <div
              key={c.day}
              title={`${c.day}: ${c.n}`}
              className="size-[11px] rounded-[2px] border border-border/40"
              style={{ background: c.n ? `color-mix(in oklab, var(--up) ${opacity[level(c.n)] * 100}%, transparent)` : "var(--muted)" }}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ContestHistory({ p }: { p: ProfileData }) {
  const rows = p.results.slice(0, 50);
  const bests = PLATFORMS.map((pl) => {
    const rs = p.results.filter((r) => r.platform === pl);
    return {
      pl,
      maxRating: p.cells[pl]?.maxRating ?? (rs.length ? Math.max(...rs.map((r) => r.newRating ?? 0)) : null),
      bestRank: rs.reduce((b, r) => (r.rank != null && (b == null || r.rank < b) ? r.rank : b), null as number | null),
      count: rs.length,
    };
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contest history</CardTitle>
        <CardDescription className="flex flex-wrap gap-x-4">
          {bests.map((b) => (
            <span key={b.pl}>
              {PLATFORM_LABEL[b.pl]}: {b.count} contests · max {b.maxRating ?? "—"} · best #{b.bestRank != null ? fmt(b.bestRank) : "—"}
            </span>
          ))}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No contests yet.</p>
        ) : (
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">Date (IST)</th>
                <th>Platform</th>
                <th>Contest</th>
                <th className="text-right">Rank</th>
                <th className="text-right">Solved</th>
                <th className="text-right">Rating</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-1.5 text-xs">{formatIST(r.startTime, { dateStyle: "medium" })}</td>
                  <td className="text-xs">{PLATFORM_LABEL[r.platform]}</td>
                  <td>{r.name}</td>
                  <td className="text-right tabular-nums">{r.rank != null ? fmt(r.rank) : "—"}</td>
                  <td className="text-right tabular-nums">{r.solved != null ? r.solved : <Unavailable why="Not exposed by this platform" />}</td>
                  <td className="text-right tabular-nums">
                    {r.newRating != null && r.oldRating != null ? (
                      <span className="inline-flex items-center gap-1">
                        {r.newRating} <RankChange value={r.newRating - r.oldRating} unit="rating" />
                      </span>
                    ) : r.newRating != null ? (
                      r.newRating
                    ) : (
                      <span className="text-xs text-muted-foreground">pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
