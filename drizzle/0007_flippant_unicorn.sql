CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charger_id" text NOT NULL,
	"charger_name" text NOT NULL,
	"type" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charger_observed_state" (
	"charger_id" text PRIMARY KEY NOT NULL,
	"operation_mode" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduler_heartbeat" DROP COLUMN "last_blocked_at";--> statement-breakpoint
ALTER TABLE "scheduler_heartbeat" DROP COLUMN "last_blocked_charger_name";