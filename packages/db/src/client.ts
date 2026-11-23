import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseUrl } from "./env";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

const g = globalThis as unknown as { __cpArenaDb?: { db: Db; sql: postgres.Sql } };

/** Process-wide pool (survives Next.js hot reloads). */
export function getDb(): Db {
  if (!g.__cpArenaDb) {
    const sql = postgres(databaseUrl(), { max: Number(process.env.DB_POOL_MAX ?? 10), onnotice: () => {} });
    g.__cpArenaDb = { sql, db: drizzle(sql, { schema }) };
  }
  return g.__cpArenaDb.db;
}

export async function closeDb(): Promise<void> {
  if (g.__cpArenaDb) {
    await g.__cpArenaDb.sql.end({ timeout: 5 });
    g.__cpArenaDb = undefined;
  }
}
