ALTER TABLE "charge_schedules" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "charge_schedules" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "charge_schedules" ADD COLUMN "zaptec_session_id" text;