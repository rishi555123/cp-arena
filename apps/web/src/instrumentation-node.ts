// One .env at the repo root serves web, worker and db scripts; Next itself only reads apps/web/.env*.
import { loadEnvConfig } from "@next/env";
import path from "node:path";

loadEnvConfig(path.resolve(process.cwd(), "../.."), process.env.NODE_ENV !== "production");

// Refuse to start in production without a real secret — never fall back to the dev one.
// Runs at server start (not during `next build`), after .env has been loaded.
if (process.env.NODE_ENV === "production" && !process.env.AUTH_SECRET?.trim()) {
  console.error("FATAL: AUTH_SECRET is empty or missing. Set it before starting in production (generate with: npx auth secret).");
  process.exit(1);
}
