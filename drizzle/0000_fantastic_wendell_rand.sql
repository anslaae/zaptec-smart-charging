CREATE TYPE "public"."schedule_status" AS ENUM('pending', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "charge_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"charger_id" text NOT NULL,
	"charger_name" text NOT NULL,
	"target_energy_kwh" numeric(6, 2) NOT NULL,
	"ready_by" timestamp with time zone NOT NULL,
	"status" "schedule_status" DEFAULT 'pending' NOT NULL,
	"last_command" text,
	"last_note" text,
	"last_evaluated_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charge_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charger_id" text NOT NULL,
	"zaptec_session_id" text,
	"schedule_id" uuid,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"energy_kwh" numeric(6, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "charge_schedules" ADD CONSTRAINT "charge_schedules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_sessions" ADD CONSTRAINT "charge_sessions_schedule_id_charge_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."charge_schedules"("id") ON DELETE no action ON UPDATE no action;