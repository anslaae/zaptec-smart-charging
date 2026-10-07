CREATE TABLE "manual_charge_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charger_id" text NOT NULL,
	"started_by_user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "scheduler_heartbeat" ADD COLUMN "last_blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduler_heartbeat" ADD COLUMN "last_blocked_charger_name" text;--> statement-breakpoint
ALTER TABLE "manual_charge_sessions" ADD CONSTRAINT "manual_charge_sessions_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;