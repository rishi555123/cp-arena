import "../src/load-env";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { closeDb, getDb } from "../src/client";
import { databaseUrl } from "../src/env";

const folder = fileURLToPath(new URL("../drizzle", import.meta.url));

async function main() {
  console.log(`Migrating ${databaseUrl().replace(/:[^:@/]+@/, ":***@")}`);
  await migrate(getDb(), { migrationsFolder: folder });
  console.log("Migrations applied.");
}

main()
  .catch((e) => {
    console.error(e);
    if (String(e?.message ?? e).includes("ECONNREFUSED")) console.error("\nIs Postgres running? Try: docker compose up -d");
    process.exitCode = 1;
  })
  .finally(closeDb);
