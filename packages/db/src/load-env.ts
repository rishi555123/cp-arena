// Separate entry point (not re-exported from index) so the Next.js bundle never sees this
// filesystem walk — Turbopack would otherwise trace the whole repo into the server output.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { config } from "dotenv";

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

loadEnv();
