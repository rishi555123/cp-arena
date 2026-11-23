# Roadmap — what the MVP skipped

The MVP covers build-order checkpoints 1–3 from `docs/PROMPT.md` (plus the seed script, the checkpoint-0 spike script, and a few cheap pieces of later checkpoints: weekly-climbers tab, next-target card, activity heatmap, upcoming contests list). Everything below is intentionally not built yet. Search the code for `TODO(checkpoint N)` to find the hooks.

## Checkpoint 4 — Contests hub
- Calendar view, `.ics` download and a personal iCal feed (`/api/ical/[token].ics`).
- "I'm in" RSVP (`contest_rsvps` table exists) with going-count.
- Opt-in reminders (24 h / 30 min) — depends on notifications.
- Group results page per finished contest: participants, official rank, solves, rating Δ, rank within group, top performer, biggest gain, OG share card.
- Post-contest re-sync of participants on a backoff schedule until ratings publish (≤ 7 days). Today results stay `pending` and are picked up by the 6-hourly full sync.

## Checkpoint 5 — History features
- Compare page: overlay any two members' charts; follow up to 3 rivals.
- Nightly snapshot pinned to 00:05 IST (today the worker upserts "today" after each sync batch, which also produces one row per day).

## Checkpoint 6 — Seasons, streaks, achievements, email
- Seasons (`seasons` table): season points (+20/contest, group-rank bonus 50/40/32… ×0.8 min 5, positive rating gains, weighted solves capped 30/day), recap and hall of fame. The Season tab and profile "season rank" show "—" for now.
- Streaks: consecutive weeks with ≥1 contest, 1 freeze per month. Streaks tab disabled for now.
- Achievements engine (`achievements`, `user_achievements` tables exist).
- Admin challenges with progress bars (`challenges` table exists).
- Email: magic-link sign-in (Auth.js Nodemailer/Resend provider), weekly digest Monday 09:00 IST, "ratings published" notices.

## Checkpoint 7 — Admin & polish
- Admin console: approve/remove/verify members manually, invite-code management, scoring-config editor with impact preview, announcement banner, CSV export, audit-log viewer (`audit_log` is already written for consent, linking, verifying, unlinking, deletion and admin resyncs).
- Web push (PWA), overtake alerts (off by default, max 1/day), quiet hours (`notification_prefs` exists).
- Topic strengths radar from CF/LC tags.
- Discord/Telegram bot.

## Data-source work
- Codeforces: incremental `user.status`; weekly `user.ratedList` → true percentiles.
- CodeChef: daily activity (heatmap XHR); total rated count for rank-based percentile.
- clist.by: calendar source + ratings fallback when a platform blocks the server IP.
- Replace the hand-rolled `sync_jobs` queue with pg-boss and a cross-process rate limiter if more than one worker is needed.
- Anomaly flags for admin review (solve spikes, rating jumps, handle swaps) — never auto-ban.
- Codeforces alternative verification (compile error on a given problem within 5 minutes).

## Privacy controls not yet in the UI
- Display name vs handle (`users.show_handle_only` column exists) and hide-from-public (`users.hidden`; the board is members-only so it has no effect until a public board exists). Unlink and hard delete **are** implemented (Accounts page).
