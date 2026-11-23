You are a senior full-stack engineer and product designer. Build a production-ready web app: a competitive-programming leaderboard for a closed community. Members link their LeetCode, Codeforces and CodeChef profiles. The app pulls their public data, ranks everyone on one fair score, and is designed so members keep entering contests and solving problems to climb.

=== 0. CONFIG (if a value is blank, use the default and say so) ===
- Community name: [ ]  (default "CP Arena")
- Expected members: [ ]  (default 50–1,000)
- Who can join: [open / invite code / email domain]  (default invite code)
- Leaderboard visibility: [members only / public read-only]  (default members only)
- Platforms required: [all three / at least one]  (default all three)
- Season length: [monthly / 6 weeks / semester]  (default monthly)
- Display timezone: Asia/Kolkata (store everything in UTC)
- Hosting: [free tier / small paid]  (default free tier where possible)

=== 1. PRODUCT GOAL ===
North-star metric: weekly active members who enter at least one contest.
Secondary metrics: weighted problems solved per member per week, and 4-week retention.
Core principle: every member must always see a realistic next rank to chase. A single all-time board motivates only the top ~20%. So also build near-peer goals, weekly climbers, seasons and divisions.

=== 2. DATA SOURCES (verify live first; they change without notice) ===

CODEFORCES
Official API: https://codeforces.com/api/{method}. Hard limit is 1 request per 2 seconds, so use one global rate-limited queue.
- user.info: rating, maxRating, rank, avatar.
- user.rating: per-contest rank, oldRating, newRating.
- user.status: submissions with problem rating, tags, verdict and participantType. Paginate with from/count and sync incrementally.
- contest.list: upcoming contests.
- user.ratedList?activeOnly=true: large response. Refresh weekly to compute global percentiles. If it is restricted, fall back to a configurable rating→percentile table.
- Do NOT use contest.standings with handles/from/count. For regular contests it now only accepts an anonymous request with contestId alone.
- Build per-contest results from user.rating plus user.status. Count distinct accepted problems where participantType is CONTESTANT or OUT_OF_COMPETITION.
- The API can be slow or down around big rounds. Retry with backoff, and never block the other platforms.

LEETCODE
No official API. Use the public GraphQL endpoint: POST https://leetcode.com/graphql. Known queries (verify the field names):
- userContestRanking(username) { attendedContestsCount rating globalRanking totalParticipants topPercentage badge { name } }
- userContestRankingHistory(username) { attended problemsSolved totalProblems finishTimeInSeconds rating ranking contest { title startTime } }
- matchedUser(username) { submitStatsGlobal { acSubmissionNum { difficulty count } } profile { realName aboutMe ranking } userCalendar { submissionCalendar streak totalActiveDays } }
- recentAcSubmissionList(username, limit)
Cloudflare challenges and 403s are common from datacenter and CI IPs.
- Detect HTML or 403 responses, mark the source "degraded", and back off.
- Test from the real production host on day 0.
- If submission data comes back empty, tell the member to enable "Display my submission history" in LeetCode privacy settings.

CODECHEF
No official public API; the old one was deprecated. Write our own scraper for https://www.codechef.com/users/{handle}.
- Extract: rating, stars, highest rating, global and country rank, total solved, and rating history (embedded in a page script).
- Parse defensively, version the parser, and alert admins when parsing fails.

FALLBACK / AGGREGATOR
clist.by API v4 (free account plus API key, about 10 requests per minute).
- Primary source for the contest calendar.
- Fallback for ratings if a direct source is blocked.

SCRAPING ETHICS
- Public data only. Never ask for passwords or cookies.
- Send an honest User-Agent with a contact email.
- Cache aggressively and keep request rates minimal.
- No proxy rotation, fingerprint spoofing or CAPTCHA solving.
- Follow each site's terms.

=== 3. ONBOARDING & VERIFICATION ===
- Accept full URLs or raw handles. Parse these formats:
  - leetcode.com/u/{h}/ and leetcode.com/{h}/
  - codeforces.com/profile/{h}
  - codechef.com/users/{h}
- Reject leetcode.cn with a clear message.
- Check that the handle exists before saving.
- One handle per platform per member. A handle can't be claimed twice; admins resolve disputes.
- Ownership check (required to be ranked):
  - Issue a short token. The member pastes it into a public profile field:
    - Codeforces: First Name
    - CodeChef: Name
    - LeetCode: Summary/About Me or Name (whichever GraphQL returns)
  - The app verifies it, then tells the member they can remove it.
  - Alternative for Codeforces: submit a compilation error to a specified problem within 5 minutes, checked via user.status.
- Consent screen: what's collected, who sees it, and how to leave and delete data.
- The first sync runs immediately with a progress state. The member appears on the board within about 2 minutes.
- If a handle stops resolving (renamed or deleted), pause that account and ask the member to re-link.

=== 4. UNIFIED "POWER SCORE" (0–1000): configurable, versioned, transparent ===
Store the components in every snapshot. Show a "How your score is built" breakdown on every profile.

A) Contest strength: 50%
- Per platform, convert rating to a global percentile p:
  - LeetCode: p = 1 − topPercentage/100
  - Codeforces: share of active rated users below the member's rating, from the cached ratedList
  - CodeChef: 1 − globalRank/totalRated if obtainable; otherwise a configurable rating→percentile table
- Map p to points with a curve where gains near the top still matter.
  - Default: 1000 × min(1, −log10(1 − p) / 3)
  - That gives top 10% ≈ 333, top 1% ≈ 667, top 0.1% = 1000.
- Take a weighted average over the platforms where the member is rated.
  - Default weights: CF 0.40, LC 0.35, CC 0.25, renormalized.
  - Being unrated on a platform does not count as zero.

B) Problem solving: 30%
- Compute W, the weighted count of unique accepted problems:
  - LeetCode: Easy 1, Medium 3, Hard 6.
  - Codeforces, by problem rating: ≤1100 → 1, 1200–1500 → 2, 1600–1900 → 3, 2000–2300 → 5, ≥2400 → 8, unrated → 1.
  - CodeChef: 2 per solve (no reliable difficulty data).
- Points = 1000 × min(1, sqrt(W / 4000)). This gives diminishing returns, so farming easy problems can't dominate.

C) Momentum: 20%, over a rolling 28 days
- 60 per contest entered.
- Plus 1 per rating point gained (losses ignored).
- Plus 4 per weighted solve.
- Capped at 1000. This rewards current effort, so active members can always climb.

Power = 0.5A + 0.3B + 0.2C.
- Recompute after every sync.
- A nightly snapshot (score, components, rank) powers the history charts and rank deltas.
- Sanity-check on seed data: the order should match intuitive skill plus effort, and no single action should move someone more than ~30% of the board in a day.
- Document everything in docs/SCORING.md.

=== 5. LEADERBOARDS ===
Tabs: Overall | Season | Weekly climbers | LeetCode | Codeforces | CodeChef | Problems solved | Streaks.
Each row shows:
- rank
- change vs 7 days ago (▲/▼ icon plus a number, never color alone)
- avatar and name
- division badge
- Power
- per-platform rating with tier label
- last active
- 30-day sparkline
Other requirements:
- The viewer's own row is pinned on every tab, with a "jump to me" control.
- Search by name or handle. Filter by division, group tag (batch/branch) and platform.
- Divisions are fixed Power bands (e.g., Bronze/Silver/Gold/Platinum/Diamond). Set them so each holds about 15–30% of members at launch. Show rank within division next to overall rank.
- Document the tie-breakers: higher momentum first, then whoever reached the score first.

=== 6. MEMBER DASHBOARD / PROFILE ===
- Hero section: overall rank, 7-day and 30-day rank change, Power with component breakdown, division, season rank, streak.
- Next-target card: the member directly above, the point gap, and 2–3 estimated ways to close it. Compute these from the formula (e.g., "Enter Sunday's LeetCode Weekly ≈ +18") and label them as estimates.
- Last contest per platform: name, date, rank, problems solved (where available), and rating Δ or "rating pending".
- Charts (readable at 360px wide):
  1. Rating history per platform, with tier bands shaded
  2. Power Score and overall rank over time (rank axis inverted)
  3. Cumulative problems solved, stacked by platform
  4. Difficulty breakdown (LC Easy/Medium/Hard; CF rating buckets)
  5. Combined activity heatmap across platforms
  6. Topic strengths from CF and LC tags (v2)
- Contest history table across platforms, plus personal bests (max rating, best rank).
- "Refresh my data" button with a 15-minute cooldown. Always show "last synced X ago".
- Compare: overlay any two members' charts. Members can follow up to 3 rivals.

=== 7. CONTESTS HUB ===
- Upcoming contests on all three platforms, as a list and a calendar.
  - Countdowns in IST and direct links.
  - .ics download and a personal iCal feed.
- "I'm in" RSVP showing how many members are going.
- Opt-in reminders (e.g., 24 hours and 30 minutes before).
- Group results page for each finished contest:
  - members who took part, with official rank, problems solved and rating Δ (filled in when published)
  - rank within the group
  - top performer and biggest gain
  - a shareable result card (OG image)
- Re-sync the participants of a finished contest on a backoff schedule until ratings publish (up to 7 days).

=== 8. SEASONS, STREAKS, ACHIEVEMENTS ===
Season points reset each season; the all-time board persists. Members earn:
- +20 per contest entered.
- A group-rank bonus per contest: 50, 40, 32, and so on (×0.8 each step), minimum 5.
- Positive rating gains. Losses never subtract, so entering is always worth it.
- Weighted solves, max 30 per day.
At season end, show a recap for each member and a hall of fame.

Streaks: consecutive weeks with at least one contest on any platform. Members get 1 streak freeze per month.

Example achievements:
- first contest; 5/10/25/50 contests
- 4-week and 12-week streaks
- tier milestones: CF Pupil → Expert and beyond, LC Knight/Guardian, CC 3★/4★/5★
- first Hard; 100/250/500 solves
- rated on all three platforms
- comeback (+100 after a drop)
- weekly top climber

Admin challenges: time-boxed goals (e.g., "enter 4 contests this month") with progress bars.

=== 9. NOTIFICATIONS (opt-in, frequency-capped, quiet hours) ===
- Weekly digest, Monday 09:00 IST: rank and change, highlights, next target, upcoming contests.
- Contest reminders, and a "ratings published" notice for contests the member entered.
- Overtake alerts: off by default, max 1 per day.
- Channels: email and web push (PWA). A Discord or Telegram bot can come later.

=== 10. FAIRNESS, INTEGRITY, WELLBEING ===
- Only verified accounts are ranked.
- Flag anomalies for admin review (huge solve spikes, sudden rating jumps, handle swaps). Never auto-ban.
- Mirror platform penalties (e.g., removed rating changes) on the next sync.
- No shaming: show drops neutrally and never list "bottom" members.
- Privacy controls:
  - display name vs handle
  - hide from public view (members still see their own rank)
  - unlink a platform
  - delete account (hard delete)
- Version every score-formula change, announce it, and recompute.

=== 11. ADMIN CONSOLE ===
- Members: approve, remove, verify manually.
- Sync health per source: last success, error rate, parser failures, queue depth. Manual resync.
- Scoring-config editor with an impact preview.
- Seasons, challenges, announcement banner, invite codes.
- CSV export of members, snapshots and contest results.
- Audit log.

=== 12. ARCHITECTURE (defaults; justify any deviation) ===
- Frontend: Next.js (App Router, TypeScript), Tailwind, shadcn/ui, Recharts, TanStack Table.
- Database: PostgreSQL (Supabase or Neon) with Drizzle ORM and migrations.
- Auth: Auth.js with Google sign-in and email magic link. Roles: member and admin.
- Worker: a separate always-on Node process with a Postgres-backed job queue (pg-boss).
  - Per-source rate limits, jittered exponential backoff, a circuit breaker per source, idempotent upserts.
  - Schedule: full sync every 6 hours; post-contest re-syncs; weekly CF ratedList refresh; hourly contest calendar; nightly snapshots and ranks.
- Adapters: one per platform, all with the same interface: getProfile, getRatingHistory, getSolvedStats, getRecentActivity(since), getUpcomingContests, verifyToken.
- Save raw payloads with fetchedAt for debugging and re-parsing.
- Precompute leaderboards into tables or materialized views. Pages never call the platforms directly.
- Stale-but-available beats broken: always show the last-synced time.

=== 13. DATA MODEL (minimum) ===
- users
- platform_accounts: platform, handle, verified, token, last_synced_at, sync_status, last_error
- platform_snapshots: rating, max_rating, global_rank, percentile, solved breakdown, raw_json, captured_at
- contest_results: platform, contest_id, name, start_time, rank, solved, old_rating, new_rating, status (pending | final)
- daily_activity: user, date, platform, accepted
- contests
- contest_rsvps
- score_snapshots: user, date, power, components, overall_rank, division, season_points, formula_version
- seasons
- achievements and user_achievements
- challenges
- notifications and notification_prefs
- scoring_config
- audit_log

=== 14. UX / UI ===
- Mobile-first. Dark mode by default, with a light mode.
- The leaderboard loads in under 1 second for 1,000 members. Use skeleton loaders.
- WCAG AA contrast. Tier colors are always paired with text labels.
- Use platform names, not their logos.
- Brief, skippable celebrations for milestones.

=== 15. BUILD ORDER (show results at each checkpoint) ===
0. Data-source spike from the actual host. Fetch 3 real public handles per platform and report which fields work, latency, and any blocking. If a source fails, stop and report before building on it.
1. Schema, auth, onboarding (URL parsing, verification, consent).
2. Adapters, worker, sync-health page.
3. Power Score v1, overall and per-platform boards, profile with rating charts and last-contest cards, scoring explainer.
4. Contests hub: calendar, RSVP, reminders, group results.
5. Snapshots → rank history, weekly climbers, next-target card, compare.
6. Seasons, divisions, streaks, achievements, digest emails, share cards.
7. Admin polish, web push, topic radar.
Include a seed script with about 40 realistic fake members and 6 months of history, so every screen works without live data.

=== 16. QUALITY BAR ===
Tests:
- Unit tests for scoring math and URL parsing.
- Adapter tests on recorded JSON/HTML fixtures.
- One live smoke test per source, behind a flag.
Reliability:
- One source failing never breaks the others or the leaderboard.
- Rate limits hold with 1,000 linked accounts.
- Never fabricate data. Unavailable fields show "—" with a tooltip saying why.
Deliverables:
- repo
- README: local setup, env vars, deploy steps for web and worker
- .env.example, migrations, seed script
- docs/SCORING.md
- docs/DATA_SOURCES.md: each source, its known fragility, and its fallback
If you can't run code or reach the network, still produce the full codebase and mark exactly what must be verified live.

Ask me at most 5 questions, and only if something truly blocks you. Otherwise use the CONFIG defaults and list your assumptions at the top of your first reply.