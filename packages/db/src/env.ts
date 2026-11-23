import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { config } from "dotenv";

export const DEFAULT_DATABASE_URL = "postgres://cparena:cparena@localhost:5432/cparena";

let loaded = false;

/** Load the repo-root .env (walking up from cwd) once. Missing file is fine — defaults apply. */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  let dir = resolve(process.cwd());
  for (let i = 0; i < 5; i++) {
    const f = join(dir, ".env");
    if (existsSync(f)) {
      config({ path: f, quiet: true });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

export function databaseUrl(): string {
  loadEnv();
  return process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
}
