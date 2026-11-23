import { loadActiveConfig, getDb } from "@cp-arena/db";
import { PLATFORM_LABEL, PLATFORMS, percentileToPoints } from "@cp-arena/scoring";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { requireMember } from "@/lib/session";

export const metadata = { title: "How scoring works" };

export default async function ScoringPage() {
  await requireMember();
  const c = await loadActiveConfig(getDb());
  const pctRows = [0.5, 0.75, 0.9, 0.95, 0.99, 0.999];

  return (
    <article className="flex max-w-3xl flex-col gap-5 text-sm leading-relaxed">
      <header>
        <h1 className="text-xl font-bold">How Power is calculated</h1>
        <p className="text-muted-foreground">
          Formula version <strong>{c.version}</strong>. Every change is versioned, announced and recomputed. Each daily snapshot stores its components, so your
          profile can always show the breakdown.
        </p>
      </header>

      <Card>
        <CardContent className="pt-4 text-center font-mono text-base">
          Power = {c.weights.contest} × A + {c.weights.problems} × B + {c.weights.momentum} × C <span className="text-muted-foreground">(0–1000)</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>A · Contest strength ({c.weights.contest * 100}%)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p>Each platform rating becomes a global percentile p — the share of active rated users below you:</p>
          <ul className="list-disc pl-5">
            <li>LeetCode: p = 1 − topPercentage / 100 (reported by LeetCode).</li>
            <li>Codeforces: share of active rated users below your rating. Until the weekly ratedList refresh ships, an approximate rating→percentile table is used.</li>
            <li>CodeChef: 1 − globalRank / totalRated when available, otherwise an approximate rating→percentile table.</li>
          </ul>
          <p>
            Points = 1000 × min(1, −log₁₀(1 − p) / {c.contestDecades}). Gains near the top still matter:
          </p>
          <table className="w-full max-w-sm text-left">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th>You beat</th>
                <th>Top</th>
                <th className="text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {pctRows.map((p) => (
                <tr key={p} className="border-t">
                  <td className="py-1">{(p * 100).toFixed(1)}%</td>
                  <td>{((1 - p) * 100).toFixed(1)}%</td>
                  <td className="text-right tabular-nums">{Math.round(percentileToPoints(p, c.contestDecades))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            A = weighted average over the platforms where you&apos;re rated ({PLATFORMS.map((p) => `${PLATFORM_LABEL[p]} ${c.platformWeights[p]}`).join(", ")}), renormalised.
            Being unrated somewhere does <strong>not</strong> count as zero.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>B · Problem solving ({c.weights.problems * 100}%)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p>W = weighted count of unique accepted problems:</p>
          <ul className="list-disc pl-5">
            <li>
              LeetCode: Easy {c.lcWeights.easy}, Medium {c.lcWeights.medium}, Hard {c.lcWeights.hard}.
            </li>
            <li>
              Codeforces by problem rating: {c.cfBuckets.map((b) => `${b.key} → ${b.weight}`).join(", ")}, unrated → {c.cfUnratedWeight}.
            </li>
            <li>CodeChef: {c.ccPerSolve} per solve (no reliable difficulty data).</li>
          </ul>
          <p>
            Points = 1000 × min(1, √(W / {c.problemsScale})). Diminishing returns: doubling W gives about 1.4× the points, so farming easy problems can&apos;t dominate.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>C · Momentum ({c.weights.momentum * 100}%, rolling {c.momentum.windowDays} days)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <ul className="list-disc pl-5">
            <li>{c.momentum.perContest} per contest entered, any platform, any result.</li>
            <li>{c.momentum.perRatingPoint} per rating point gained (losses ignored — entering is always worth it).</li>
            <li>{c.momentum.perWeightedSolve} per weighted solve.</li>
          </ul>
          <p>Capped at {c.momentum.cap}. This rewards current effort, so active members can always climb.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Divisions, ranks and ties</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p>Divisions are fixed Power bands, set so each holds roughly 15–30% of members at launch:</p>
          <ul className="list-disc pl-5">
            {c.divisions.map((d, i) => (
              <li key={d.name}>
                {d.name}: {d.min}
                {i === 0 ? "+" : `–${c.divisions[i - 1].min - 0.1}`}
              </li>
            ))}
          </ul>
          <p>Tie-breakers: higher momentum first, then whoever reached the score first.</p>
          <p>Only verified accounts are ranked. Power is recomputed after every sync; a daily snapshot powers the history charts and rank changes.</p>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Full reference: docs/SCORING.md in the repository.</p>
    </article>
  );
}
