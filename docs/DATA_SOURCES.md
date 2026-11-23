# Data sources

All adapters implement the same interface (`packages/adapters/src/types.ts`):
`getProfile`, `getRatingHistory`, `getSolvedStats`, `getRecentActivity(since)`, `getUpcomingContests`, `verifyToken`.

Shared plumbing (`packages/adapters/src/http.ts`): one `SourceClient` per source per process with a serialised rate-limited queue, jittered exponential backoff on 5xx/429/network errors, and a circuit breaker. One source failing never blocks the others — the worker syncs accounts independently and the leaderboard always reads the last good snapshot from Postgres. Pages never call the platforms, except onboarding (handle existence check and token verification).

Every outbound request sends an honest User-Agent: `CPArena/0.1 (community leaderboard; +mailto:$CONTACT_EMAIL)`. Public data only; no passwords, cookies, proxy rotation, fingerprint spoofing or CAPTCHA solving.

## Checkpoint 0 spike results (2026-11-23, from a residential Windows dev machine)

| Source | Request | Status | Latency | Notes |
|---|---|---|---|---|
| Codeforces | `user.info?handles=tourist;Benq;jiangly` | 200 | ~1.0 s | all fields present |
| Codeforces | `user.rating`, `user.status`, `contest.list` | 200 | <1 s each | `problem.rating` present on most problems |
| LeetCode | GraphQL `userContestRanking` + `matchedUser` (`lee215`) | 200 | ~0.5 s | `topPercentage`, `badge`, `aboutMe`, `acSubmissionNum` all work |
| LeetCode | `userContestRankingHistory`, `userCalendar`, `recentAcSubmissionList`, `topTwoContests` | 200 | <1 s | field names as in the spec |
| CodeChef | `/users/gennady.korotkevich` (HTML) | 200 | ~0.8 s | rating, stars, highest rating, total solved, `var all_rating = [...]` embedded |
| CodeChef | `/api/list/contests/all` | 200 | <1 s | `future_contests` with ISO dates |
| CodeChef | unknown handle | 302 → `/` | | treated as `not_found` |

A full live sync of `tourist` (311 rated contests, ~3,000 solves, paginated `user.status`) took ~7 s including the 2 s Codeforces spacing.

**⚠ Must re-run from the production host on day 0:** `npm run spike` and `npm run test:live`. LeetCode in particular often serves Cloudflare challenges to datacenter/CI IPs. This spike was run from a residential IP and proves nothing about the server.

## Codeforces — official API

- Base `https://codeforces.com/api/{method}`. Hard limit 1 request / 2 s → `minIntervalMs: 2000`, single queue per process. **Run one worker process** (or move to pg-boss with a global limiter) to keep the limit global.
- `user.info` → rating, maxRating, rank, avatar, first/last name (token verification uses First name).
- `user.rating` → per-contest rank and old/new rating.
- `user.status` → submissions; paginated 5000 at a time. Unique accepted problems keyed by `contestId-index`, bucketed by `problem.rating`. Per-contest solves = distinct accepted problems with `participantType` CONTESTANT or OUT_OF_COMPETITION.
- `contest.list?gym=false` → upcoming (`phase = BEFORE`).
- We do **not** use `contest.standings` with handles.
- Fragility: slow/unavailable around big rounds → retries + breaker; results stay "pending" until `user.rating` shows the change.
- TODO: incremental `user.status` (stop paging at last seen submission id); weekly `user.ratedList?activeOnly=true` for true percentiles (fallback table is in `DEFAULT_CONFIG.cfPercentileTable`).

## LeetCode — unofficial GraphQL

- `POST https://leetcode.com/graphql` with `Referer: https://leetcode.com`.
- Queries in `packages/adapters/src/leetcode.ts`: `matchedUser.profile` (realName, aboutMe — token verification), `userContestRanking`, `userContestRankingHistory`, `submitStatsGlobal.acSubmissionNum`, `userCalendar.submissionCalendar`, `topTwoContests`.
- Old rating for a contest = rating after the previous history row (start 1500).
- `submissionCalendar` counts **submissions**, not accepts.
- Fragility: no official API, field names can change; Cloudflare 403/HTML → `blocked` error, source marked `down`, breaker opens for 30 min. Empty calendar → member probably has "Display my submission history" off (onboarding tells them).
- Fallback: clist.by (TODO) for ratings if LeetCode blocks the production IP.

## CodeChef — HTML scraper (versioned)

- `GET https://www.codechef.com/users/{handle}` with `redirect: manual`; a 3xx means the handle doesn't exist.
- Parser `parseCodechefProfile` (`CC_PARSER_VERSION = "cc-html-v1"`): `<h1 class="h2-style">` (name, token verification), first `.rating-header` block (rating, stars, highest rating), `.rating-ranks` (global/country rank; "Inactive" → null), `Total Problems Solved: N`, and `var all_rating = [...]` (history, `end_date` in IST).
- When the markers are missing the parser throws `parse` → `source_health.parser_failures` increments and the account keeps its last good snapshot. Recorded fixture: `packages/adapters/test/fixtures/cc_profile.html`.
- Not available: per-contest solves, total rated users (→ percentile table), daily activity (heatmap is loaded by a separate XHR — TODO).
- Upcoming contests: `/api/list/contests/all` → `future_contests`.

## clist.by (fallback / calendar) — TODO

Planned as the primary contest calendar and as a ratings fallback when a direct source is blocked. Needs a free account and `CLIST_API_KEY` (~10 req/min). Not implemented in the MVP; the calendar uses each platform's own endpoint.

## Raw payloads

`platform_snapshots.raw_json` stores the parsed profile payload with `parser_version` (CodeChef stores parsed fields only — full HTML is ~180 KB). Use it to debug and to re-parse after a parser fix.
