/**
 * Checkpoint 0 data-source spike: fetch 3 real public handles per platform from THIS host and
 * report which fields work, latency, and any blocking. Run on the production host on day 0.
 *   npm run spike
 */
import { CodechefAdapter, CodeforcesAdapter, LeetcodeAdapter, type PlatformAdapter } from "@cp-arena/adapters";
import { loadEnv } from "@cp-arena/db";

loadEnv();

const HANDLES: [PlatformAdapter, string[]][] = [
  [new CodeforcesAdapter(), ["tourist", "Benq", "jiangly"]],
  [new LeetcodeAdapter(), ["lee215", "votrubac", "uwi"]],
  [new CodechefAdapter(), ["gennady.korotkevich", "jiangly", "um_nik"]],
];

async function timed<T>(fn: () => Promise<T>): Promise<[T | Error, number]> {
  const t = Date.now();
  try {
    return [await fn(), Date.now() - t];
  } catch (e) {
    return [e as Error, Date.now() - t];
  }
}

const since = new Date(Date.now() - 90 * 86_400_000);
for (const [adapter, handles] of HANDLES) {
  console.log(`\n=== ${adapter.platform} ===`);
  for (const h of handles) {
    const [profile, t1] = await timed(() => adapter.getProfile(h));
    const [history, t2] = await timed(() => adapter.getRatingHistory(h));
    const [solved, t3] = await timed(() => adapter.getSolvedStats(h));
    const [act, t4] = await timed(() => adapter.getRecentActivity(h, since));
    const fmt = (v: unknown) => (v instanceof Error ? `ERROR ${v.message}` : v);
    console.log(
      h.padEnd(22),
      `profile ${t1}ms:`,
      fmt(profile instanceof Error ? profile : { rating: profile.rating, max: profile.maxRating, pct: profile.percentile, tier: profile.tier, name: profile.displayName }),
    );
    console.log("".padEnd(22), `history ${t2}ms:`, fmt(history instanceof Error ? history : `${history.length} contests, last=${history.at(-1)?.contestName ?? "—"}`));
    console.log("".padEnd(22), `solved ${t3}ms:`, fmt(solved instanceof Error ? solved : JSON.stringify(solved.breakdown)));
    console.log("".padEnd(22), `activity ${t4}ms:`, fmt(act instanceof Error ? act : `${act.measure}, ${act.days.length} days`));
  }
  const [up, t] = await timed(() => adapter.getUpcomingContests());
  console.log(`upcoming ${t}ms:`, up instanceof Error ? `ERROR ${up.message}` : up.map((c) => c.name).slice(0, 3));
}
