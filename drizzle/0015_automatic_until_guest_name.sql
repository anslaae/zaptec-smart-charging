ALTER TABLE "manual_charge_sessions" ADD COLUMN "guest_name" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "allow_automatic_charging_until" timestamp with time zone;