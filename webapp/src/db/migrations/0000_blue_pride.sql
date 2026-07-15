CREATE TYPE "public"."activity_sport" AS ENUM('run', 'trail_run', 'ride', 'mtb', 'swim');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('connected', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."detail_status" AS ENUM('outline', 'pending_review', 'detailed');--> statement-breakpoint
CREATE TYPE "public"."experience_level" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."insight_status" AS ENUM('pending', 'accepted', 'edited', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."race_priority" AS ENUM('A', 'B', 'C');--> statement-breakpoint
CREATE TYPE "public"."race_status" AS ENUM('upcoming', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."target_metric" AS ENUM('pace', 'power', 'hr_zone');--> statement-breakpoint
CREATE TYPE "public"."training_phase" AS ENUM('base', 'build', 'peak', 'taper', 'race_week');--> statement-breakpoint
CREATE TYPE "public"."workout_source" AS ENUM('user', 'ai_suggested');--> statement-breakpoint
CREATE TYPE "public"."workout_sport" AS ENUM('run', 'trail_run', 'ride', 'mtb', 'swim', 'rest');--> statement-breakpoint
CREATE TYPE "public"."workout_status" AS ENUM('planned', 'completed', 'skipped', 'pending_review', 'accepted', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."workout_type" AS ENUM('easy', 'tempo', 'interval', 'long', 'recovery', 'technique', 'rest');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"strava_activity_id" bigint NOT NULL,
	"date" date NOT NULL,
	"sport" "activity_sport" NOT NULL,
	"duration" integer NOT NULL,
	"distance" numeric(7, 2),
	"avg_hr" integer,
	"avg_pace_or_power" text,
	"relative_effort" integer,
	"raw_payload" jsonb NOT NULL,
	"matched_planned_workout_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_strava_activity_id_unique" UNIQUE("strava_activity_id")
);
--> statement-breakpoint
CREATE TABLE "checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"sleep_hours" numeric(4, 2),
	"soreness" integer,
	"energy" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"activity_id" uuid,
	"commentary" text NOT NULL,
	"suggested_workout_id" uuid,
	"status" "insight_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planned_workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"sport" "workout_sport" NOT NULL,
	"workout_type" "workout_type" NOT NULL,
	"target_duration_min" integer,
	"target_distance" numeric(7, 2),
	"target_metric" "target_metric",
	"target_value" text,
	"notes" text,
	"status" "workout_status" DEFAULT 'planned' NOT NULL,
	"source" "workout_source" DEFAULT 'user' NOT NULL,
	"superseded_by" uuid,
	"training_block_id" uuid,
	"race_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "race_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"date" date NOT NULL,
	"priority" "race_priority" NOT NULL,
	"goal_time" text,
	"course_notes" text,
	"status" "race_status" DEFAULT 'upcoming' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "race_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_event_id" uuid NOT NULL,
	"sport" "activity_sport" NOT NULL,
	"distance" numeric(7, 2) NOT NULL,
	"leg_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"race_event_id" uuid NOT NULL,
	"week_start_date" date NOT NULL,
	"phase" "training_phase" NOT NULL,
	"target_volume" numeric(7, 2) NOT NULL,
	"detail_status" "detail_status" DEFAULT 'outline' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strava_athlete_id" bigint NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"connection_status" "connection_status" DEFAULT 'connected' NOT NULL,
	"weekly_availability" jsonb,
	"experience_level" "experience_level",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_strava_athlete_id_unique" UNIQUE("strava_athlete_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_matched_planned_workout_id_planned_workouts_id_fk" FOREIGN KEY ("matched_planned_workout_id") REFERENCES "public"."planned_workouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_suggested_workout_id_planned_workouts_id_fk" FOREIGN KEY ("suggested_workout_id") REFERENCES "public"."planned_workouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_workouts" ADD CONSTRAINT "planned_workouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_workouts" ADD CONSTRAINT "planned_workouts_superseded_by_planned_workouts_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."planned_workouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_workouts" ADD CONSTRAINT "planned_workouts_training_block_id_training_blocks_id_fk" FOREIGN KEY ("training_block_id") REFERENCES "public"."training_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_workouts" ADD CONSTRAINT "planned_workouts_race_event_id_race_events_id_fk" FOREIGN KEY ("race_event_id") REFERENCES "public"."race_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_events" ADD CONSTRAINT "race_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_legs" ADD CONSTRAINT "race_legs_race_event_id_race_events_id_fk" FOREIGN KEY ("race_event_id") REFERENCES "public"."race_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_blocks" ADD CONSTRAINT "training_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_blocks" ADD CONSTRAINT "training_blocks_race_event_id_race_events_id_fk" FOREIGN KEY ("race_event_id") REFERENCES "public"."race_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkins_user_date_unique" ON "checkins" USING btree ("user_id","date");