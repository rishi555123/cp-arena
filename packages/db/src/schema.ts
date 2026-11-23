import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const platformEnum = pgEnum("platform", ["codeforces", "leetcode", "codechef"]);
export const roleEnum = pgEnum("role", ["member", "admin"]);
export const userStatusEnum = pgEnum("user_status", ["onboarding", "active", "removed"]);
export const syncStatusEnum = pgEnum("sync_status", ["pending", "syncing", "ok", "error", "paused"]);
export const resultStatusEnum = pgEnum("result_status", ["pending", "final"]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "done", "failed"]);
export const sourceStateEnum = pgEnum("source_state", ["ok", "degraded", "down"]);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();

// ---------- people ----------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  /** shown instead of name when set */
  displayName: text("display_name"),
  image: text("image"),
  role: roleEnum("role").notNull().default("member"),
  status: userStatusEnum("status").notNull().default("onboarding"),
  /** batch / branch etc., used as a leaderboard filter */
  groupTag: text("group_tag"),
  /** privacy: show platform handle instead of real name */
  showHandleOnly: boolean("show_handle_only").notNull().default(false),
  /** privacy: hide from public view (members still see their own rank). TODO: public board. */
  hidden: boolean("hidden").notNull().default(false),
  inviteCode: text("invite_code"),
  consentAt: ts("consent_at"),
  lastRefreshRequestedAt: ts("last_refresh_requested_at"),
  createdAt: createdAt(),
});

export const inviteCodes = pgTable("invite_codes", {
  code: text("code").primaryKey(),
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  expiresAt: ts("expires_at"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

// ---------- platform data ----------

export const platformAccounts = pgTable(
  "platform_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    handle: text("handle").notNull(),
    verified: boolean("verified").notNull().default(false),
    verifiedAt: ts("verified_at"),
    verifyToken: text("verify_token"),
    tokenIssuedAt: ts("token_issued_at"),
    lastSyncedAt: ts("last_synced_at"),
    syncStatus: syncStatusEnum("sync_status").notNull().default("pending"),
    lastError: text("last_error"),
    /** seeded demo account — never synced against the real platform */
    synthetic: boolean("synthetic").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    // a handle can't be claimed twice; one handle per platform per member
    uniqueIndex("platform_accounts_platform_handle_uq").on(t.platform, sql`lower(${t.handle})`),
    uniqueIndex("platform_accounts_user_platform_uq").on(t.userId, t.platform),
  ],
);

/** One row per account per UTC day (upserted on each sync). Components are kept for re-scoring. */
export const platformSnapshots = pgTable(
  "platform_snapshots",
  {
    id: serial("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    capturedAt: ts("captured_at").notNull().defaultNow(),
    rating: integer("rating"),
    maxRating: integer("max_rating"),
    globalRank: integer("global_rank"),
    totalRanked: integer("total_ranked"),
    percentile: doublePrecision("percentile"),
    tier: text("tier"),
    contestsCount: integer("contests_count"),
    solvedTotal: integer("solved_total"),
    /** { kind: 'leetcode', easy, medium, hard } | { kind: 'codeforces', buckets } | { kind: 'codechef', total } */
    solved: jsonb("solved"),
    weightedSolved: doublePrecision("weighted_solved"),
    rawJson: jsonb("raw_json"),
    parserVersion: text("parser_version"),
  },
  (t) => [uniqueIndex("platform_snapshots_account_day_uq").on(t.accountId, t.day)],
);

export const contestResults = pgTable(
  "contest_results",
  {
    id: serial("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    contestId: text("contest_id").notNull(),
    name: text("name").notNull(),
    startTime: ts("start_time").notNull(),
    rank: integer("rank"),
    solved: integer("solved"),
    totalProblems: integer("total_problems"),
    oldRating: integer("old_rating"),
    newRating: integer("new_rating"),
    status: resultStatusEnum("status").notNull().default("final"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contest_results_account_contest_uq").on(t.accountId, t.contestId),
    index("contest_results_start_idx").on(t.startTime),
  ],
);

export const dailyActivity = pgTable(
  "daily_activity",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    platform: platformEnum("platform").notNull(),
    /** accepted problems (Codeforces) or submissions (LeetCode exposes only that) */
    accepted: integer("accepted").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day, t.platform] })],
);

// ---------- contests hub ----------

export const contests = pgTable(
  "contests",
  {
    id: serial("id").primaryKey(),
    platform: platformEnum("platform").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    startTime: ts("start_time").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    source: text("source").notNull().default("direct"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("contests_platform_ext_uq").on(t.platform, t.externalId), index("contests_start_idx").on(t.startTime)],
);

export const contestRsvps = pgTable(
  "contest_rsvps",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contestId: integer("contest_id")
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.contestId] })],
);

// ---------- scoring ----------

export const scoringConfig = pgTable("scoring_config", {
  version: text("version").primaryKey(),
  config: jsonb("config").notNull(),
  active: boolean("active").notNull().default(false),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const scoreSnapshots = pgTable(
  "score_snapshots",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    power: doublePrecision("power").notNull(),
    /** PowerComponents from @cp-arena/scoring */
    components: jsonb("components").notNull(),
    overallRank: integer("overall_rank").notNull(),
    division: text("division").notNull(),
    divisionRank: integer("division_rank").notNull(),
    /** when the member first reached this Power (tie-breaker) */
    reachedAt: ts("reached_at").notNull(),
    seasonPoints: doublePrecision("season_points").notNull().default(0),
    formulaVersion: text("formula_version").notNull(),
    computedAt: ts("computed_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] }), index("score_snapshots_day_idx").on(t.day, t.overallRank)],
);

// ---------- worker / ops ----------

export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: serial("id").primaryKey(),
    /** 'account' | 'contests' | 'recompute' */
    kind: text("kind").notNull(),
    accountId: uuid("account_id").references(() => platformAccounts.id, { onDelete: "cascade" }),
    status: jobStatusEnum("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(0),
    runAt: ts("run_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: createdAt(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("sync_jobs_pick_idx").on(t.status, t.runAt)],
);

export const sourceHealth = pgTable("source_health", {
  source: text("source").primaryKey(),
  state: sourceStateEnum("state").notNull().default("ok"),
  lastSuccessAt: ts("last_success_at"),
  lastErrorAt: ts("last_error_at"),
  lastError: text("last_error"),
  successCount: integer("success_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  parserFailures: integer("parser_failures").notNull().default(0),
  circuitOpenUntil: ts("circuit_open_until"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  target: text("target"),
  meta: jsonb("meta"),
  createdAt: createdAt(),
});

// ---------- later checkpoints (tables exist so the model is stable; not wired yet) ----------

// TODO(checkpoint 6): seasons, season points, recaps, hall of fame.
export const seasons = pgTable("seasons", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  createdAt: createdAt(),
});

// TODO(checkpoint 6): achievements engine.
export const achievements = pgTable("achievements", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
});

export const userAchievements = pgTable(
  "user_achievements",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    achievementKey: text("achievement_key")
      .notNull()
      .references(() => achievements.key, { onDelete: "cascade" }),
    earnedAt: ts("earned_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.achievementKey] })],
);

// TODO(checkpoint 6): admin challenges with progress bars.
export const challenges = pgTable("challenges", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  goal: jsonb("goal").notNull(),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
});

// TODO(checkpoint 6/7): digest emails, reminders, web push.
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  payload: jsonb("payload"),
  sentAt: ts("sent_at"),
  createdAt: createdAt(),
});

export const notificationPrefs = pgTable("notification_prefs", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  weeklyDigest: boolean("weekly_digest").notNull().default(true),
  contestReminders: boolean("contest_reminders").notNull().default(false),
  overtakeAlerts: boolean("overtake_alerts").notNull().default(false),
  quietStart: integer("quiet_start_hour"),
  quietEnd: integer("quiet_end_hour"),
});

export type User = typeof users.$inferSelect;
export type PlatformAccount = typeof platformAccounts.$inferSelect;
export type PlatformSnapshot = typeof platformSnapshots.$inferSelect;
export type ContestResult = typeof contestResults.$inferSelect;
export type ScoreSnapshot = typeof scoreSnapshots.$inferSelect;
