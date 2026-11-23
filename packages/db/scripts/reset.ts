/** Drops everything in the public schema (local dev only), then re-run db:migrate + seed. */
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/client";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("refusing to reset in production");
  const db = getDb();
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  console.log("Database reset. Now run: npm run db:migrate && npm run seed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closeDb);
