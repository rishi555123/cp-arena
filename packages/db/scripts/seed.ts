/**
 * Seeds ~40 fake members with 6 months of history so every screen works without live data.
 * All seeded platform accounts are `synthetic` and are never synced against the real sites.
 * Deterministic (fixed PRNG seed) and idempotent: re-running wipes previous seed data first.
 */
import "../src/load-env";
import { DEFAULT_CONFIG, cfBucketKey, percentileFromTable, platformPercentile, tierFor, weightedFromBreakdown, type Platform } from "@cp-arena/scoring";
import { eq, like, sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/client";
import { addDays, proposeDivisions, recomputeScores, saveActiveConfig, toDay } from "../src/scores";
import { contestResults, contests, dailyActivity, inviteCodes, platformAccounts, platformSnapshots, scoreSnapshots, users } from "../src/schema";

const SEED_DOMAIN = "seed.cparena.local";
const HISTORY_DAYS = 182;
const DAY_MS = 86_400_000;

// ---------- deterministic randomness ----------
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const normal = (mu = 0, sd = 1) => mu + sd * Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const poisson = (lambda: number) => {
  let k = 0;
  let p = Math.exp(-lambda);
  let s = p;
  const u = rand();
  while (u > s && k < 50) {
    k++;
    p *= lambda / k;
    s += p;
  }
  return k;
};

// LeetCode reports topPercentage directly; for fake members derive it from rating with this rough table.
const LC_TABLE: [number, number][] = [
  [1200, 0.05], [1400, 0.25], [1500, 0.45], [1600, 0.62], [1700, 0.74], [1800, 0.83], [1900, 0.89],
  [2000, 0.93], [2200, 0.975], [2400, 0.99], [2700, 0.998], [3000, 0.9995],
];

const FIRST = ["Aarav", "Diya", "Vihaan", "Ananya", "Arjun", "Ishita", "Kabir", "Meera", "Rohan", "Saanvi", "Aditya", "Kavya", "Reyansh", "Tanvi", "Nikhil", "Pooja", "Siddharth", "Riya", "Varun", "Neha", "Karthik", "Sneha", "Harsh", "Aditi", "Pranav", "Shreya", "Yash", "Nandini", "Manav", "Lakshmi", "Dev", "Priya", "Om", "Tara", "Rahul", "Zoya", "Aryan", "Fatima", "Kunal", "Sana"];
const LAST = ["Sharma", "Iyer", "Reddy", "Nair", "Gupta", "Menon", "Patel", "Rao", "Singh", "Kulkarni", "Das", "Joshi", "Bose", "Pillai", "Verma", "Khan", "Mehta", "Chatterjee", "Agarwal", "Krishnan"];
const GROUPS = ["CSE-2025", "CSE-2026", "ECE-2026", "IT-2027"];

interface FakeContest {
  platform: Platform;
  id: string;
  name: string;
  start: Date;
  participants: number;
  problems: number;
}

/** Plausible global calendars for the history window (IDs/names are synthetic). */
function contestCalendar(start: Date, end: Date): FakeContest[] {
  const out: FakeContest[] = [];
  const weeks = Math.ceil((end.getTime() - start.getTime()) / (7 * DAY_MS)) + 1;
  // align to the Sunday on/after start
  const firstSunday = new Date(start);
  firstSunday.setUTCHours(0, 0, 0, 0);
  firstSunday.setUTCDate(firstSunday.getUTCDate() + ((7 - firstSunday.getUTCDay()) % 7));
  for (let w = 0; w < weeks; w++) {
    const sun = new Date(firstSunday.getTime() + w * 7 * DAY_MS);
    const at = (dayOffset: number, h: number, m: number) => new Date(sun.getTime() + dayOffset * DAY_MS + (h * 60 + m) * 60_000);
    out.push({ platform: "leetcode", id: `weekly-contest-${505 + w}`, name: `Weekly Contest ${505 + w}`, start: at(0, 2, 30), participants: 28000, problems: 4 });
    if (w % 2 === 0) out.push({ platform: "leetcode", id: `biweekly-contest-${185 + w / 2}`, name: `Biweekly Contest ${185 + w / 2}`, start: at(-1, 14, 30), participants: 24000, problems: 4 });
    out.push({ platform: "codeforces", id: String(2180 + w * 2), name: `Codeforces Round ${1060 + w * 2} (Div. 2)`, start: at(2, 14, 35), participants: 22000, problems: 6 });
    out.push({ platform: "codeforces", id: String(2181 + w * 2), name: w % 3 === 0 ? `Educational Codeforces Round ${180 + w}` : `Codeforces Round ${1061 + w * 2} (Div. 3)`, start: at(6, 14, 35), participants: 26000, problems: 7 });
    out.push({ platform: "codechef", id: `START${240 + w}`, name: `Starters ${240 + w}`, start: at(3, 14, 30), participants: 18000, problems: 7 });
  }
  return out.filter((c) => c.start >= start && c.start <= end).sort((a, b) => a.start.getTime() - b.start.getTime());
}

const PERF_TABLE: Record<Platform, [number, number][]> = {
  leetcode: LC_TABLE,
  codeforces: DEFAULT_CONFIG.cfPercentileTable,
  codechef: DEFAULT_CONFIG.ccPercentileTable,
};

async function main() {
  const db = getDb();
  // History is anchored to 00:00 UTC today so re-runs on the same day are identical.
  const today = toDay(new Date());
  const now = new Date(`${today}T00:00:00Z`);
  const startDay = addDays(today, -HISTORY_DAYS);
  const start = new Date(`${startDay}T00:00:00Z`);

  console.log("Clearing previous seed data…");
  await db.delete(users).where(like(users.email, `%@${SEED_DOMAIN}`));
  await db.delete(contests).where(eq(contests.source, "seed"));

  await db.insert(inviteCodes).values({ code: "ARENA2026", maxUses: 1000 }).onConflictDoNothing();

  const calendar = contestCalendar(start, now);
  const usedNames = new Set<string>();

  // Snapshot/result/activity rows are accumulated then bulk-inserted.
  const snapRows: (typeof platformSnapshots.$inferInsert)[] = [];
  const resultRows: (typeof contestResults.$inferInsert)[] = [];
  const activity = new Map<string, typeof dailyActivity.$inferInsert>();
  const bumpActivity = (userId: string, day: string, platform: Platform, n: number) => {
    const k = `${userId}|${day}|${platform}`;
    const row = activity.get(k) ?? { userId, day, platform, accepted: 0 };
    row.accepted = (row.accepted ?? 0) + n;
    activity.set(k, row);
  };

  const MEMBERS = 40;
  for (let i = 0; i < MEMBERS; i++) {
    let name: string;
    do name = `${pick(FIRST)} ${pick(LAST)}`;
    while (usedNames.has(name));
    usedNames.add(name);
    const slug = name.toLowerCase().replace(/\s+/g, "_");
    const isAdmin = i === 0;
    const skill = normal(0, 1);
    const activityLevel = clamp(0.15 + rand() * 0.85, 0.1, 1);
    // ~3 members joined in the last month; their history is short.
    const joinOffset = i >= MEMBERS - 3 ? HISTORY_DAYS - 15 - Math.floor(rand() * 15) : Math.floor(rand() * 10);
    const joinDay = addDays(startDay, joinOffset);
    const joinDate = new Date(`${joinDay}T06:00:00Z`);

    const [user] = await db
      .insert(users)
      .values({
        email: isAdmin ? `admin@${SEED_DOMAIN}` : `${slug}@${SEED_DOMAIN}`,
        name,
        role: isAdmin ? "admin" : "member",
        status: "active",
        groupTag: pick(GROUPS),
        inviteCode: "ARENA2026",
        consentAt: joinDate,
        createdAt: joinDate,
      })
      .returning();

    const platforms: Platform[] = ["leetcode", "codeforces", "codechef"];
    for (const platform of platforms) {
      const pSkill = skill + normal(0, 0.45);
      // ~15% of members never rated on CodeChef; one has an unverified CodeChef link (not ranked on it).
      const rated = !(platform === "codechef" && rand() < 0.15);
      const verified = !(platform === "codechef" && i === 7);
      const participation = activityLevel * { leetcode: 0.75, codeforces: 0.45, codechef: 0.35 }[platform] * (rated ? 1 : 0);
      const handle = `${slug.replace(/_/g, "")}${platform === "codeforces" ? "" : platform === "leetcode" ? "_lc" : "_cc"}${i}`;
      const [acc] = await db
        .insert(platformAccounts)
        .values({
          userId: user.id,
          platform,
          handle,
          verified,
          verifiedAt: verified ? joinDate : null,
          verifyToken: verified ? null : "CPA-SEED00",
          tokenIssuedAt: joinDate,
          syncStatus: "ok",
          lastSyncedAt: new Date(Date.now() - Math.floor(rand() * 6 * 3600_000)),
          synthetic: true,
          createdAt: joinDate,
        })
        .returning();

      // Starting state (members had history before the window).
      let rating: number | null = rated
        ? Math.round(
            platform === "codeforces" ? clamp(1250 + 380 * pSkill, 700, 2900) : platform === "leetcode" ? clamp(1620 + 260 * pSkill, 1300, 2900) : clamp(1520 + 330 * pSkill, 1000, 2900),
          )
        : null;
      let maxRating = rating;
      const growth = normal(60, 90) * activityLevel * (platform === "codeforces" ? 1.3 : 1);
      const startRating = rating;
      let contestsCount = rated ? Math.floor(rand() * 40 * activityLevel) + 3 : 0;
      const base = Math.exp(normal(4.6 + 0.55 * pSkill, 0.45));
      const lc = { easy: Math.round(base * 0.42), medium: Math.round(base * 0.45), hard: Math.round(base * clamp(0.08 + 0.06 * pSkill, 0.02, 0.3)) };
      const cf: Record<string, number> = {};
      const addCf = (r: number | null, n = 1) => {
        const k = cfBucketKey(r);
        cf[k] = (cf[k] ?? 0) + n;
      };
      if (platform === "codeforces") for (let k = 0; k < base * 0.8; k++) addCf(Math.round(clamp(normal((rating ?? 1100) - 150, 300), 800, 3500) / 100) * 100);
      let ccTotal = Math.round(base * 0.5);
      const memberContests = calendar.filter((c) => c.platform === platform && c.start >= joinDate);

      let ci = 0;
      for (let d = joinOffset; d <= HISTORY_DAYS; d++) {
        const day = addDays(startDay, d);
        const dayEnd = new Date(`${addDays(day, 1)}T00:00:00Z`);
        // contests that happened on this day
        while (ci < memberContests.length && memberContests[ci].start < dayEnd) {
          const c = memberContests[ci++];
          if (rating == null || rand() > participation) continue;
          const progress = (c.start.getTime() - start.getTime()) / (now.getTime() - start.getTime());
          const target = (startRating ?? 1500) + growth * progress;
          const perf = rating + 1.6 * (target - rating) + normal(0, platform === "codeforces" ? 170 : 130);
          const pctl = percentileFromTable(perf, PERF_TABLE[platform]);
          const rank = Math.max(1, Math.round(c.participants * (1 - pctl) * (0.85 + rand() * 0.3)));
          const delta = Math.round(clamp((perf - rating) * 0.22, -150, 180));
          const solved = clamp(Math.round(c.problems * clamp(0.25 + 0.6 * (pctl - 0.3), 0.05, 1) + normal(0, 0.6)), 0, c.problems);
          // A few very recent contests have ratings not yet published.
          const pending = now.getTime() - c.start.getTime() < 20 * 3600_000 && platform !== "leetcode";
          resultRows.push({
            accountId: acc.id,
            platform,
            contestId: c.id,
            name: c.name,
            startTime: c.start,
            rank,
            solved: platform === "codechef" ? null : solved,
            totalProblems: platform === "leetcode" ? c.problems : null,
            oldRating: pending ? null : rating,
            newRating: pending ? null : rating + delta,
            status: pending ? "pending" : "final",
          });
          contestsCount++;
          if (!pending) {
            rating += delta;
            maxRating = Math.max(maxRating ?? rating, rating);
          }
          bumpActivity(user.id, day, platform, Math.max(1, solved));
          if (platform === "leetcode") lc.easy += Math.min(1, solved), lc.medium += Math.max(0, Math.min(2, solved - 1)), lc.hard += solved >= 4 ? 1 : 0;
          if (platform === "codeforces") for (let k = 0; k < solved; k++) addCf(Math.round(clamp(800 + k * 250 + normal(0, 150), 800, 3500) / 100) * 100);
          if (platform === "codechef") ccTotal += solved;
        }
        // practice
        const share = { leetcode: 0.55, codeforces: 0.3, codechef: 0.15 }[platform];
        if (rand() < (0.05 + 0.3 * activityLevel) * share * 2) {
          const n = 1 + poisson(0.7 * activityLevel);
          for (let k = 0; k < n; k++) {
            if (platform === "leetcode") {
              const r = rand() - 0.15 * pSkill;
              if (r < 0.35) lc.easy++;
              else if (r < 0.85) lc.medium++;
              else lc.hard++;
            } else if (platform === "codeforces") addCf(Math.round(clamp(normal((rating ?? 1200) - 100, 250), 800, 3500) / 100) * 100);
            else ccTotal++;
          }
          bumpActivity(user.id, day, platform, platform === "leetcode" ? Math.round(n * 1.6) : n);
        }

        const breakdown =
          platform === "leetcode"
            ? ({ kind: "leetcode", ...lc } as const)
            : platform === "codeforces"
              ? ({ kind: "codeforces", buckets: { ...cf } } as const)
              : ({ kind: "codechef", total: ccTotal } as const);
        const solvedTotal = platform === "leetcode" ? lc.easy + lc.medium + lc.hard : platform === "codeforces" ? Object.values(cf).reduce((a, b) => a + b, 0) : ccTotal;
        const percentile = platformPercentile(platform, { rating, percentile: rating == null ? null : percentileFromTable(rating, LC_TABLE) });
        snapRows.push({
          accountId: acc.id,
          day,
          capturedAt: new Date(`${day}T20:00:00Z`),
          rating,
          maxRating,
          globalRank: null,
          totalRanked: null,
          percentile,
          tier: platform === "leetcode" ? (rating != null && percentile != null && percentile >= 0.95 ? "Guardian" : rating != null && percentile != null && percentile >= 0.75 ? "Knight" : null) : tierFor(platform, rating),
          contestsCount,
          solvedTotal,
          solved: breakdown,
          weightedSolved: weightedFromBreakdown(breakdown),
          rawJson: { seed: true },
          parserVersion: "seed",
        });
      }
    }
  }

  console.log(`Inserting ${snapRows.length} platform snapshots, ${resultRows.length} contest results, ${activity.size} activity rows…`);
  const chunked = async <T>(rows: T[], fn: (c: T[]) => Promise<unknown>, size = 1000) => {
    for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
  };
  await chunked(snapRows, (c) => db.insert(platformSnapshots).values(c));
  await chunked(resultRows, (c) => db.insert(contestResults).values(c));
  await chunked([...activity.values()], (c) => db.insert(dailyActivity).values(c));

  // Upcoming contests for the next two weeks (the worker replaces these with live data).
  const upcoming = contestCalendar(now, new Date(now.getTime() + 14 * DAY_MS)).map((c) => ({
    platform: c.platform,
    externalId: `seed-${c.id}`,
    name: c.name,
    url: c.platform === "leetcode" ? `https://leetcode.com/contest/` : c.platform === "codeforces" ? `https://codeforces.com/contests` : `https://www.codechef.com/contests`,
    startTime: c.start,
    durationSeconds: c.platform === "codeforces" ? 7200 : c.platform === "leetcode" ? 5400 : 7200,
    source: "seed",
  }));
  if (upcoming.length) await db.insert(contests).values(upcoming).onConflictDoNothing();

  console.log("Computing daily Power snapshots…");
  const days = Array.from({ length: HISTORY_DAYS + 1 }, (_, d) => addDays(startDay, d));
  await db.delete(scoreSnapshots).where(sql`${scoreSnapshots.day} >= ${startDay}`);
  let config = DEFAULT_CONFIG;
  await recomputeScores(db, days, config);
  // "Set bands so each holds ~15–30% at launch": calibrate on the seeded population, then recompute.
  const bands = await proposeDivisions(db, config);
  if (bands) config = { ...config, divisions: bands };
  await saveActiveConfig(db, config, "Initial formula (docs/SCORING.md); divisions calibrated on seed data");
  const res = await recomputeScores(db, days, config);
  console.log(`  ${res.rows} score snapshots over ${res.days} days.`);
  console.log(`  Division bands: ${config.divisions.map((d) => `${d.name} ≥${d.min}`).join(", ")}`);

  // Sanity report: division spread today + biggest one-day rank move.
  const dist = await db.execute<{ division: string; n: number }>(sql`select division, count(*)::int as n from score_snapshots where day = ${today} group by division order by min(power) desc`);
  const jump = await db.execute<{ max_jump: number; members: number }>(sql`
    select max(abs(a.overall_rank - b.overall_rank))::int as max_jump, (select count(*)::int from score_snapshots where day = ${today}) as members
    from score_snapshots a join score_snapshots b on a.user_id = b.user_id and b.day = a.day - 1`);
  console.log("Division spread today:", dist.map((r) => `${r.division} ${r.n}`).join(", "));
  const j = jump[0];
  if (j) console.log(`Largest single-day rank move: ${j.max_jump} places of ${j.members} (${Math.round((100 * j.max_jump) / Math.max(1, j.members))}%)`);
  console.log(`\nDone. Sign in with dev login as admin@${SEED_DOMAIN} (admin) or any member. Invite code: ARENA2026`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closeDb);
