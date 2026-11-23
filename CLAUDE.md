# CP Arena
Full spec is in docs/PROMPT.md. Use CONFIG defaults, don't ask questions.

TONIGHT'S SCOPE (MVP only):
- Checkpoints 1–3 from the build order + seed script (~40 fake members, 6 months history)
- Skip: push notifications, emails, seasons, achievements, admin console, Discord bot
- Leave TODOs + docs for skipped parts

Stack: Next.js App Router + TS, Tailwind, shadcn/ui, Recharts, Drizzle + Postgres (docker-compose for local), Auth.js.
Must run with: docker compose up -d && npm install && npm run db:migrate && npm run seed && npm run dev
Commit after each working checkpoint.