import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// One .env at the repo root serves web, worker and db scripts.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadEnvConfig(root);

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@cp-arena/db", "@cp-arena/scoring", "@cp-arena/adapters"],
  serverExternalPackages: ["postgres"],
  outputFileTracingRoot: root,
  turbopack: { root },
};

export default nextConfig;
