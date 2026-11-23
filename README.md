# CP Arena

A members-only competitive-programming leaderboard. Members link their **LeetCode**, **Codeforces** and **CodeChef** profiles; the worker pulls public data, and everyone is ranked on one transparent **Power Score** (0–1000) with divisions, weekly climbers and a "next target" to chase.

This is the **MVP**: build-order checkpoints 1–3 from [`docs/PROMPT.md`](docs/PROMPT.md) plus a seed script. What's skipped and where it plugs in: [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Quick start

Requires Node 20.11+ and Docker.

```bash
docker compose up -d && npm install && npm run db:migrate && npm run seed && npm run dev
```

Open http://localhost:3000 → **Dev login** → pick a seeded member (or "Arena Admin" for the sync-health page). To try onboarding, dev-login with any new email and use invite code `ARENA2026`.

No `.env` is needed for local dev — every setting has a default (see [Assumptions](#assumptions)). To customise, `cp .env.example .env` at the repo root.

To sync **real** accounts (anything you link through onboarding), run the worker in a second terminal:

```bash
npm run worker
```

## Layout

```
apps/web            Next.js App Router UI — leaderboard, profile/dashboard, onboarding, contests, scoring, admin sync health
apps/worker         Sync worker: Postgres job queue, 6h full sync, hourly contest calendar, score recompute; data-source spike script
packages/db         Drizzle schema, migrations (packages/db/drizzle), seed, recompute + sync jobs
packages/adapters   LeetCode / Codeforces / CodeChef adapters (one interface), URL parsing, rate limit / backoff / circuit breaker
packages/scoring    Power Score math, tiers, divisions — pure functions + unit tests
docs/               SCORING.md, DATA_SOURCES.md, ROADMAP.md, PROMPT.md (full spec)
```

## Scripts (repo root)

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server on :3000 |
| `npm run db:migrate` | Apply migrations in `packages/db/drizzle` |
| `npm run db:generate` | Generate a new migration after editing `packages/db/src/schema.ts` |
| `npm run db:reset` | Drop everything (dev only); then migrate + seed again |
| `npm run seed` | ~40 fake members, 6 months of history, daily Power snapshots; calibrates division bands (idempotent, deterministic per day) |
| `npm run calibrate` | Propose division bands (~20% each) from current Power; `-- --apply` saves them and recomputes |
| `npm run worker` | Long-running sync worker |
| `npm run sync:once` | One pass: contests + every real account + recompute, then exit (good for cron) |
| `npm run spike` | Checkpoint-0 probe: 3 real handles per platform, fields + latency |
| `npm test` | Unit tests (scoring math, URL parsing, adapters on recorded fixtures) |
| `npm run test:live` | Live smoke test per source (hits the real sites) |
| `npm run typecheck` | `tsc` across all workspaces |

## Environment variables

All live in one `.env` at the repo root (read by web, worker and db scripts). See [`.env.example`](.env.example).

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://cparena:cparena@localhost:5432/cparena` | matches `docker-compose.yml` |
| `AUTH_SECRET` | dev-only fallback | **required in production** (`npx auth secret`) |
| `AUTH_URL` | — | public URL in production |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | — | enables Google sign-in; callback `/api/auth/callback/google` |
| `AUTH_DEV_LOGIN` | `true` unless `NODE_ENV=production` | passwordless dev login — **never enable in production** |
| `CONTACT_EMAIL` | `admin@example.com` | put a real contact in the outbound User-Agent |
| `CLIST_API_KEY` | — | reserved for the clist.by fallback (not used yet) |
| `WORKER_FULL_SYNC_HOURS` | `6` | full sync interval |
| `WORKER_POLL_SECONDS` | `5` | queue poll interval |
| `DB_POOL_MAX` | `10` | Postgres pool size per process |

## Deploying

**Database:** any Postgres 14+ (Neon / Supabase free tiers work). Run `npm run db:migrate` against it once per release (from CI or your machine with `DATABASE_URL` set). Don't run the seed in production.

**Web (Vercel or any Node host):**
- Vercel: import the repo, set *Root Directory* to `apps/web`, keep the default build (`next build`). Set `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_GOOGLE_ID/SECRET`, `CONTACT_EMAIL`. Leave `AUTH_DEV_LOGIN` unset.
- Plain Node: `npm ci && npm run build && npm start` (port 3000).

**Worker (always-on Node process — Railway, Fly.io, Render, a small VM):**
- `npm ci && npm run worker` with the same `DATABASE_URL` and `CONTACT_EMAIL`.
- Run **one** instance: the per-source rate limit (Codeforces: 1 req / 2 s) is per process.
- Cheaper alternative on free tiers: a cron job running `npm run sync:once` every few hours (onboarding's "first sync" and "Refresh my data" then wait for the next run).
- Day 0: run `npm run spike` and `npm run test:live` **from the worker host** — LeetCode often blocks datacenter IPs (see [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md)).

## Assumptions

CONFIG defaults from the spec, plus decisions made without asking:

- **Community** "CP Arena", 50–1,000 members, **invite code** to join (seed creates `ARENA2026`), **members-only** leaderboard, **all three platforms required** to finish onboarding, monthly seasons (not built yet), display timezone **Asia/Kolkata**, everything stored in UTC, free-tier hosting.
- **Ranked = active member + at least one verified account.** All three must be *linked* to finish onboarding, but each counts only once *verified*.
- **Auth:** Google sign-in when configured; email magic link is deferred with emails (checkpoint 6). A passwordless **dev login** exists for local work and is off in production. Sessions are JWTs (no adapter tables); the user row is re-read on every request so role/status changes apply immediately.
- **Admin:** the seeded `admin@seed.cparena.local` is the only admin. Promote someone with `update users set role = 'admin' where email = '…';`.
- **Queue:** a small Postgres-backed queue (`sync_jobs`, `FOR UPDATE SKIP LOCKED`) instead of pg-boss for the MVP; same semantics (priority, retries with jittered backoff, crash recovery).
- **Snapshots:** one `platform_snapshots` row per account per UTC day (upserted each sync) and one `score_snapshots` row per member per day (today's row is recomputed after each sync batch).
- **Percentiles:** Codeforces and CodeChef use approximate rating→percentile tables until the ratedList refresh / a total-rated source exist (documented in SCORING.md).
- **Divisions** are fixed bands. The seed calibrates them to its population (17–23% each); at launch run `npm run calibrate -- --apply` on real members, then keep them fixed.
- **Seed data is fake and labelled.** Seeded platform accounts are flagged `synthetic`, never synced against the real sites, and the UI shows a "Demo data" banner while any exist. Re-running `npm run seed` only replaces seed rows; real members are untouched.
- **UI:** shadcn/ui-style components are copied in (`apps/web/src/components/ui.tsx`) rather than generated by the CLI; TanStack Table isn't used yet — the board is a server-rendered table with server-side search/filters, which is fast enough for 1,000 rows (5 queries per page load, SVG sparklines, no client JS per row).
- Dark mode is the default; the toggle stores the choice in a `theme` cookie so the server renders the right theme (no flash).
- One `.env` at the repo root: scripts and the worker load it via `@cp-arena/db/load-env`; the web app loads it in `apps/web/src/instrumentation.ts`.

## Verification status

Verified locally on 2026-11-23 (Windows, Node 25): migrations, seed, unit tests (54 passing), typecheck, and every page in the browser (desktop + 375 px). Without Docker on that machine, Postgres was an embedded PGlite server; with PGlite the pool had to be pinned to one connection (`DB_POOL_MAX=1`) — not needed with real Postgres. Live checks run from a residential IP: handle lookup + token verification (negative case) on Codeforces during onboarding, full worker syncs of real public accounts on all three platforms (Codeforces `tourist`, LeetCode `lee215`, CodeChef `gennady.korotkevich`), and the contest calendar from all three.

**Still to verify live:** Google OAuth with real credentials; a *successful* token verification on each platform with an account you own; everything from the production worker host (`npm run spike`, `npm run test:live`); `docker compose` itself (no Docker on the build machine).
