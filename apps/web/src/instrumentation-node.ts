// One .env at the repo root serves web, worker and db scripts; Next itself only reads apps/web/.env*.
import { loadEnvConfig } from "@next/env";
import path from "node:path";

loadEnvConfig(path.resolve(process.cwd(), "../.."), process.env.NODE_ENV !== "production");
