CREATE TABLE "push_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"tag" text,
	"event" text,
	"user_id" uuid,
	"devices_attempted" integer NOT NULL,
	"devices_ok" integer NOT NULL,
	"errors" text
);
--> statement-breakpoint
ALTER TABLE "charge_schedules" ADD COLUMN "soc_adjust" jsonb;--> statement-breakpoint
ALTER TABLE "manual_charge_sessions" ADD COLUMN "soc_adjust" jsonb;--> statement-breakpoint
CREATE INDEX "push_log_created" ON "push_log" USING btree ("created_at");