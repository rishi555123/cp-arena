/**
 * Propose division bands from the latest Power distribution (~20% per band).
 *   npm run calibrate            — print the proposal
 *   npm run calibrate -- --apply — save as the active config and recompute today
 * Announce band changes to members; consider bumping the formula version for big changes.
 */
import "../src/load-env";
import { closeDb, getDb } from "../src/client";
import { loadActiveConfig, proposeDivisions, recomputeScores, saveActiveConfig, toDay } from "../src/scores";

async function main() {
  const db = getDb();
  const current = await loadActiveConfig(db);
  const bands = await proposeDivisions(db, current);
  if (!bands) return console.log("Not enough ranked members to calibrate (need at least 15).");
  console.log("Current :", current.divisions.map((d) => `${d.name} ≥${d.min}`).join(", "));
  console.log("Proposed:", bands.map((d) => `${d.name} ≥${d.min}`).join(", "));
  if (!process.argv.includes("--apply")) return console.log("\nRe-run with --apply to save.");
  await saveActiveConfig(db, { ...current, divisions: bands }, `divisions recalibrated ${toDay(new Date())}`);
  await recomputeScores(db, [toDay(new Date())]);
  console.log("Saved and recomputed today's ranks.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closeDb);
