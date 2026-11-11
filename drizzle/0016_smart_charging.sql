ALTER TABLE "charge_schedules" ALTER COLUMN "created_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "charge_schedules" ADD COLUMN "source" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "charge_schedules" ADD COLUMN "blocks" jsonb;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "on_plugin_mode" text DEFAULT 'wait' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "on_plugin_mode_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "smart_target_percent" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "smart_ready_by_weekday" text DEFAULT '07:30' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "smart_ready_by_weekend" text DEFAULT '10:00' NOT NULL;--> statement-breakpoint
-- Data: "Tillat automatisk lading" (UC14) becomes on_plugin_mode = 'now'.
UPDATE "settings" SET "on_plugin_mode" = 'now', "on_plugin_mode_until" = "allow_automatic_charging_until" WHERE "allow_automatic_charging" = true;
