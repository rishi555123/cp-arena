# Power Score (v1)

One number from 0 to 1000 that ranks every member fairly across LeetCode, Codeforces and CodeChef.

```
Power = 0.5 × A (contest strength) + 0.3 × B (problem solving) + 0.2 × C (momentum)
```

Each component is 0–1000. Code: `packages/scoring/src/score.ts`. Defaults: `packages/scoring/src/config.ts` (`DEFAULT_CONFIG`). Tests: `packages/scoring/test/score.test.ts`.

## A — Contest strength (50%)

1. Convert each platform rating to a global percentile `p` (share of active rated users below the member):
   | Platform | Source of `p` |
   |---|---|
   | LeetCode | `1 − topPercentage / 100` from `userContestRanking` |
   | Codeforces | share of active rated users below the rating. **v1 uses an approximate rating→percentile table** (`cfPercentileTable`) until the weekly `user.ratedList?activeOnly=true` refresh lands; `percentileFromDistribution` is ready for it. |
   | CodeChef | `1 − globalRank / totalRated` when both are known. The profile page doesn't expose total rated, so **v1 uses `ccPercentileTable`**. |
2. Map `p` to points: `1000 × min(1, −log10(1 − p) / 3)`.
   | Beat | Top | Points |
   |---|---|---|
   | 50% | 50% | 100 |
   | 90% | 10% | 333 |
   | 99% | 1% | 667 |
   | 99.9% | 0.1% | 1000 |
3. Weighted average over platforms where the member is **rated**: CF 0.40, LC 0.35, CC 0.25, renormalised. Unrated ≠ zero.

## B — Problem solving (30%)

`W` = weighted count of unique accepted problems:

- LeetCode: Easy 1, Medium 3, Hard 6
- Codeforces by problem rating: ≤1100 → 1, 1200–1500 → 2, 1600–1900 → 3, 2000–2300 → 5, ≥2400 → 8, unrated → 1
- CodeChef: 2 per solve (no reliable difficulty data)

Points = `1000 × min(1, sqrt(W / 4000))`. Doubling W gives ~1.41× points, so farming easy problems can't dominate.

## C — Momentum (20%, rolling 28 days)

- 60 per contest entered (any platform, any result)
- +1 per rating point gained; **losses are ignored** so entering is always worth it
- +4 per weighted solve gained in the window (`W_now − W_baseline`, baseline = last snapshot before the window, or the account's first snapshot if it was linked inside the window — so linking an old account doesn't count as a month of work)
- Capped at 1000

## Ranking

- Only **active** members with at least one **verified** account are ranked.
- Order: Power ↓, then momentum ↓, then whoever reached the score first (`reached_at`), then user id (deterministic).
- Divisions are fixed Power bands (`config.divisions`):

  | Division | Power (defaults) |
  |---|---|
  | Diamond | ≥ 500 |
  | Platinum | 440–499.9 |
  | Gold | 390–439.9 |
  | Silver | 320–389.9 |
  | Bronze | < 320 |

  The spec asks for bands that hold ~15–30% of members **at launch**, then stay fixed. `proposeDivisions()` cuts the latest Power distribution into quintiles (rounded down to multiples of 5). The seed applies it automatically (current seed: 8/8/8/9/7 of 40 → 17–23% each). **At real launch** run `npm run calibrate` to preview and `npm run calibrate -- --apply` to save the bands as the active config and recompute today. After that, leave them fixed and announce any change.

## Snapshots and versioning

- `score_snapshots` has one row per member per UTC day: `power`, full `components` JSON, `overall_rank`, `division`, `division_rank`, `reached_at`, `formula_version`.
- The worker recomputes today's row after every batch of syncs, so "today" is live and earlier days are frozen history (rank deltas, charts).
- Formula changes: add a new `scoring_config` row with a new `version`, mark it `active`, announce it, then recompute history (`recomputeScores(db, days)` in `packages/db/src/scores.ts`). Every snapshot records the version that produced it.

## "Next target" estimates

`estimateGains()` prices common actions with the same formula, holding contest strength constant (rating changes are unpredictable), e.g. "Enter one contest ≈ +12" = `0.2 × 60` while momentum is under the cap. Shown as estimates in the UI.

## Sanity check on seed data

`npm run seed` prints the division spread and the largest single-day rank move. Current seed: largest move 9 of 40 places (23%), under the spec's "~30% of the board in a day" limit (earlier seed variants hit 30%). The biggest moves come from momentum: a contest entering *or leaving* the 28-day window moves Power by up to 0.2 × 60 = 12, and the seed board is tightly bunched. If real data shows the same, options are a smaller `perContest`, a longer window, or linear decay inside the window (needs a formula version bump).

Known v1 limitations:
- Momentum saturates at the cap for very active members (lots of contests). That's the spec default; watch the distribution after launch.
- LeetCode activity is *submissions*, not accepts (the public calendar exposes only that). It's used for the heatmap only, not for scoring.
- CodeChef per-contest solves aren't exposed on the profile page, so CodeChef contributes to momentum only via contests entered and rating gains.
