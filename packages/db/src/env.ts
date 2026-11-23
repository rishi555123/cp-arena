export const DEFAULT_DATABASE_URL = "postgres://cparena:cparena@localhost:5432/cparena";

/** Reads process.env only. Scripts/worker call `loadEnv()` (./load-env) first; Next loads .env itself. */
export function databaseUrl(): string {
  return process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
}
