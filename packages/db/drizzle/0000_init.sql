CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('codeforces', 'leetcode', 'codechef');--> statement-breakpoint
CREATE TYPE "public"."result_status" AS ENUM('pending', 'final');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('member', 'admin');--> statement-breakpoint
CREATE TYPE "public"."source_state" AS ENUM('ok', 'degraded', 'down');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('pending', 'syncing', 'ok', 'error', 'paused');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('onboarding', 'active', 'removed');--> statement-breakpoint
CREATE TABLE "achievements" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"goal" jsonb NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contest_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"contest_id" text NOT NULL,
	"name" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"rank" integer,
	"solved" integer,
	"total_problems" integer,
	"old_rating" integer,
	"new_rating" integer,
	"status" "result_status" DEFAULT 'final' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contest_rsvps" (
	"user_id" uuid NOT NULL,
	"contest_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contest_rsvps_user_id_contest_id_pk" PRIMARY KEY("user_id","contest_id")
);
--> statement-breakpoint
CREATE TABLE "contests" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" "platform" NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"source" text DEFAULT 'direct' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_activity" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"platform" "platform" NOT NULL,
	"accepted" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_activity_user_id_day_platform_pk" PRIMARY KEY("user_id","day","platform")
);
--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"weekly_digest" boolean DEFAULT true NOT NULL,
	"contest_reminders" boolean DEFAULT false NOT NULL,
	"overtake_alerts" boolean DEFAULT false NOT NULL,
	"quiet_start_hour" integer,
	"quiet_end_hour" integer
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"handle" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"verify_token" text,
	"token_issued_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"sync_status" "sync_status" DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"day" date NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rating" integer,
	"max_rating" integer,
	"global_rank" integer,
	"total_ranked" integer,
	"percentile" double precision,
	"tier" text,
	"contests_count" integer,
	"solved_total" integer,
	"solved" jsonb,
	"weighted_solved" double precision,
	"raw_json" jsonb,
	"parser_version" text
);
--> statement-breakpoint
CREATE TABLE "score_snapshots" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"power" double precision NOT NULL,
	"components" jsonb NOT NULL,
	"overall_rank" integer NOT NULL,
	"division" text NOT NULL,
	"division_rank" integer NOT NULL,
	"reached_at" timestamp with time zone NOT NULL,
	"season_points" double precision DEFAULT 0 NOT NULL,
	"formula_version" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_snapshots_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "scoring_config" (
	"version" text PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_health" (
	"source" text PRIMARY KEY NOT NULL,
	"state" "source_state" DEFAULT 'ok' NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"success_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"parser_failures" integer DEFAULT 0 NOT NULL,
	"circuit_open_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"account_id" uuid,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" uuid NOT NULL,
	"achievement_key" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_achievements_user_id_achievement_key_pk" PRIMARY KEY("user_id","achievement_key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"display_name" text,
	"image" text,
	"role" "role" DEFAULT 'member' NOT NULL,
	"status" "user_status" DEFAULT 'onboarding' NOT NULL,
	"group_tag" text,
	"show_handle_only" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"invite_code" text,
	"consent_at" timestamp with time zone,
	"last_refresh_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_results" ADD CONSTRAINT "contest_results_account_id_platform_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_rsvps" ADD CONSTRAINT "contest_rsvps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_rsvps" ADD CONSTRAINT "contest_rsvps_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_activity" ADD CONSTRAINT "daily_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_snapshots" ADD CONSTRAINT "platform_snapshots_account_id_platform_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_account_id_platform_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_key_achievements_key_fk" FOREIGN KEY ("achievement_key") REFERENCES "public"."achievements"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contest_results_account_contest_uq" ON "contest_results" USING btree ("account_id","contest_id");--> statement-breakpoint
CREATE INDEX "contest_results_start_idx" ON "contest_results" USING btree ("start_time");--> statement-breakpoint
CREATE UNIQUE INDEX "contests_platform_ext_uq" ON "contests" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "contests_start_idx" ON "contests" USING btree ("start_time");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_accounts_platform_handle_uq" ON "platform_accounts" USING btree ("platform",lower("handle"));--> statement-breakpoint
CREATE UNIQUE INDEX "platform_accounts_user_platform_uq" ON "platform_accounts" USING btree ("user_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_snapshots_account_day_uq" ON "platform_snapshots" USING btree ("account_id","day");--> statement-breakpoint
CREATE INDEX "score_snapshots_day_idx" ON "score_snapshots" USING btree ("day","overall_rank");--> statement-breakpoint
CREATE INDEX "sync_jobs_pick_idx" ON "sync_jobs" USING btree ("status","run_at");