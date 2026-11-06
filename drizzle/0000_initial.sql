CREATE TYPE "public"."admin_action" AS ENUM('dismiss', 'release', 'void', 'ban', 'rename');--> statement-breakpoint
CREATE TYPE "public"."device_class" AS ENUM('keyboard', 'touch', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'upheld', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."report_target" AS ENUM('username', 'result', 'appeal');--> statement-breakpoint
CREATE TYPE "public"."result_kind" AS ENUM('free', 'daily', 'import');--> statement-breakpoint
CREATE TYPE "public"."result_status" AS ENUM('passed', 'held', 'voided', 'unverified');--> statement-breakpoint
CREATE TYPE "public"."run_mode" AS ENUM('time', 'words');--> statement-breakpoint
CREATE TABLE "admin_audit" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"admin_clerk_id" text NOT NULL,
	"action" "admin_action" NOT NULL,
	"subject_id" bigint NOT NULL,
	"result_id" uuid,
	"report_id" bigint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_challenges" (
	"challenge_day" date NOT NULL,
	"list_id" smallint NOT NULL,
	"seed" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_challenges_challenge_day_list_id_pk" PRIMARY KEY("challenge_day","list_id")
);
--> statement-breakpoint
CREATE TABLE "daily_entries" (
	"challenge_day" date NOT NULL,
	"list_id" smallint NOT NULL,
	"profile_id" bigint NOT NULL,
	"ticket_nonce" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result_id" uuid,
	"wpm_cx" integer,
	"accuracy_bp" integer,
	"finished_at" timestamp with time zone,
	"visible" boolean DEFAULT false NOT NULL,
	"final_rank" integer,
	CONSTRAINT "daily_entries_challenge_day_list_id_profile_id_pk" PRIMARY KEY("challenge_day","list_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "daily_rollups" (
	"profile_id" bigint NOT NULL,
	"local_day" date NOT NULL,
	"list_id" smallint NOT NULL,
	"mode" "run_mode" NOT NULL,
	"amount" smallint NOT NULL,
	"runs" integer NOT NULL,
	"ms_typed" bigint NOT NULL,
	"wpm_sum_cx" bigint NOT NULL,
	"acc_sum_bp" bigint NOT NULL,
	"best_wpm_cx" integer NOT NULL,
	CONSTRAINT "daily_rollups_profile_id_local_day_list_id_mode_amount_pk" PRIMARY KEY("profile_id","local_day","list_id","mode","amount")
);
--> statement-breakpoint
CREATE TABLE "key_stats" (
	"profile_id" bigint NOT NULL,
	"list_id" smallint NOT NULL,
	"week_start" date NOT NULL,
	"counts" "bytea" NOT NULL,
	CONSTRAINT "key_stats_profile_id_list_id_week_start_pk" PRIMARY KEY("profile_id","list_id","week_start")
);
--> statement-breakpoint
CREATE TABLE "ladder" (
	"profile_id" bigint NOT NULL,
	"list_id" smallint NOT NULL,
	"pace_cx" integer NOT NULL,
	"best_cx" integer NOT NULL,
	"runs_in_window" smallint NOT NULL,
	"last_ranked_at" timestamp with time zone NOT NULL,
	"oldest_in_window_at" timestamp with time zone NOT NULL,
	"eligible" boolean DEFAULT false NOT NULL,
	CONSTRAINT "ladder_profile_id_list_id_pk" PRIMARY KEY("profile_id","list_id")
);
--> statement-breakpoint
CREATE TABLE "personal_bests" (
	"profile_id" bigint NOT NULL,
	"list_id" smallint NOT NULL,
	"mode" "run_mode" NOT NULL,
	"amount" smallint NOT NULL,
	"wpm_cx" integer NOT NULL,
	"accuracy_bp" integer NOT NULL,
	"result_id" uuid NOT NULL,
	"achieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "personal_bests_profile_id_list_id_mode_amount_pk" PRIMARY KEY("profile_id","list_id","mode","amount")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"clerk_user_id" text NOT NULL,
	"username" text,
	"ranking_consent_at" timestamp with time zone,
	"listed_at" timestamp with time zone,
	"banned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_clerk_user_id_unique" UNIQUE("clerk_user_id"),
	CONSTRAINT "profiles_username_unique" UNIQUE("username"),
	CONSTRAINT "username_format" CHECK ("profiles"."username" ~ '^[a-z0-9][a-z0-9_-]{2,19}$'),
	CONSTRAINT "listed_needs_username" CHECK ("profiles"."listed_at" IS NULL OR "profiles"."username" IS NOT NULL),
	CONSTRAINT "consent_needs_username" CHECK ("profiles"."ranking_consent_at" IS NULL OR "profiles"."username" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "rate_counters" (
	"profile_id" bigint NOT NULL,
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer NOT NULL,
	CONSTRAINT "rate_counters_profile_id_bucket_window_start_pk" PRIMARY KEY("profile_id","bucket","window_start")
);
--> statement-breakpoint
CREATE TABLE "replays" (
	"result_id" uuid PRIMARY KEY NOT NULL,
	"profile_id" bigint NOT NULL,
	"log" "bytea" NOT NULL,
	"purge_after" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"target" "report_target" NOT NULL,
	"reporter_id" bigint,
	"subject_id" bigint NOT NULL,
	"result_id" uuid,
	"note" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	CONSTRAINT "note_length" CHECK (char_length("reports"."note") <= 280)
);
--> statement-breakpoint
CREATE TABLE "results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" bigint NOT NULL,
	"list_id" smallint,
	"kind" "result_kind" NOT NULL,
	"status" "result_status" NOT NULL,
	"ranked" boolean DEFAULT false NOT NULL,
	"rankable" boolean DEFAULT false NOT NULL,
	"mode" "run_mode" NOT NULL,
	"amount" smallint NOT NULL,
	"wpm_cx" integer NOT NULL,
	"raw_cx" integer NOT NULL,
	"accuracy_bp" integer NOT NULL,
	"consistency_bp" integer,
	"elapsed_ms" integer NOT NULL,
	"seed" "bytea",
	"scorer_version" smallint,
	"body_hash" "bytea",
	"device" "device_class" DEFAULT 'unknown' NOT NULL,
	"challenge_day" date,
	"local_day" date NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"wpm_series" "bytea",
	"hold_reasons" text[],
	"reviewed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"new_best" boolean DEFAULT false NOT NULL,
	"previous_best_cx" integer,
	CONSTRAINT "wpm_range" CHECK ("results"."wpm_cx" >= 0 AND "results"."raw_cx" >= 0),
	CONSTRAINT "accuracy_range" CHECK ("results"."accuracy_bp" BETWEEN 0 AND 10000),
	CONSTRAINT "ranked_needs_passed" CHECK (NOT "results"."ranked" OR ("results"."status" = 'passed' AND "results"."rankable")),
	CONSTRAINT "import_is_private" CHECK ("results"."kind" <> 'import' OR ("results"."status" = 'unverified' AND NOT "results"."ranked" AND NOT "results"."rankable" AND NOT "results"."new_best")),
	CONSTRAINT "run_has_proof" CHECK ("results"."kind" = 'import' OR ("results"."list_id" IS NOT NULL AND "results"."seed" IS NOT NULL AND "results"."scorer_version" IS NOT NULL AND "results"."body_hash" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "username_holds" (
	"username" text PRIMARY KEY NOT NULL,
	"profile_id" bigint NOT NULL,
	"release_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word_lists" (
	"id" smallint PRIMARY KEY NOT NULL,
	"pack_id" text NOT NULL,
	"language" text NOT NULL,
	"sha256" text NOT NULL,
	"ranked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "word_lists_pack_id_unique" UNIQUE("pack_id")
);
--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_subject_id_profiles_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_challenges" ADD CONSTRAINT "daily_challenges_list_id_word_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."word_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_entries" ADD CONSTRAINT "daily_entries_list_id_word_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."word_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_entries" ADD CONSTRAINT "daily_entries_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_rollups" ADD CONSTRAINT "daily_rollups_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_rollups" ADD CONSTRAINT "daily_rollups_list_id_word_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."word_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_stats" ADD CONSTRAINT "key_stats_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_stats" ADD CONSTRAINT "key_stats_list_id_word_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."word_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ladder" ADD CONSTRAINT "ladder_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ladder" ADD CONSTRAINT "ladder_list_id_word_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."word_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_bests" ADD CONSTRAINT "personal_bests_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_bests" ADD CONSTRAINT "personal_bests_list_id_word_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."word_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_counters" ADD CONSTRAINT "rate_counters_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replays" ADD CONSTRAINT "replays_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_profiles_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_subject_id_profiles_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_list_id_word_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."word_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "username_holds" ADD CONSTRAINT "username_holds_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_subject_idx" ON "admin_audit" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "daily_board_idx" ON "daily_entries" USING btree ("challenge_day","list_id","wpm_cx" DESC NULLS FIRST,"accuracy_bp" DESC NULLS FIRST,"finished_at","profile_id") WHERE "daily_entries"."visible";--> statement-breakpoint
CREATE INDEX "daily_profile_idx" ON "daily_entries" USING btree ("profile_id","challenge_day" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ladder_board_idx" ON "ladder" USING btree ("list_id","pace_cx" DESC NULLS FIRST,"profile_id") WHERE "ladder"."eligible";--> statement-breakpoint
CREATE INDEX "rate_counters_window_idx" ON "rate_counters" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "replays_purge_idx" ON "replays" USING btree ("purge_after");--> statement-breakpoint
CREATE INDEX "replays_profile_idx" ON "replays" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "reports_queue_idx" ON "reports" USING btree ("created_at") WHERE "reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "reports_result_idx" ON "reports" USING btree ("result_id") WHERE "reports"."result_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "reports_reporter_idx" ON "reports" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "reports_subject_idx" ON "reports" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "reports_resolved_idx" ON "reports" USING btree ("resolved_at") WHERE "reports"."resolved_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_one_open_subject_idx" ON "reports" USING btree ("reporter_id","target","subject_id") WHERE "reports"."status" = 'open' AND "reports"."result_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_one_open_result_idx" ON "reports" USING btree ("reporter_id","target","result_id") WHERE "reports"."status" = 'open' AND "reports"."result_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "results_profile_time_idx" ON "results" USING btree ("profile_id","finished_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "results_ranked_idx" ON "results" USING btree ("profile_id","list_id","finished_at" DESC NULLS FIRST) WHERE "results"."ranked";--> statement-breakpoint
CREATE INDEX "results_held_idx" ON "results" USING btree ("finished_at") WHERE "results"."status" = 'held';--> statement-breakpoint
CREATE INDEX "username_holds_profile_idx" ON "username_holds" USING btree ("profile_id");