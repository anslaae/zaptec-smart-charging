ALTER TABLE "charge_schedules" ADD COLUMN "preheat_power_lost_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "charge_schedules" ADD COLUMN "preheat_power_lost_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "manual_charge_sessions" ADD COLUMN "power_lost_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "manual_charge_sessions" ADD COLUMN "power_lost_notified_at" timestamp with time zone;