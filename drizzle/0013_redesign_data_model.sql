CREATE TABLE "cars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"battery_capacity_kwh" numeric(5, 1) NOT NULL,
	"smartcar_vehicle_id" text,
	"default_location_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chargers" (
	"id" text PRIMARY KEY NOT NULL,
	"location_id" uuid NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"zaptec_installation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_zaptec_installation_id_unique" UNIQUE("zaptec_installation_id")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY NOT NULL,
	"allow_automatic_charging" boolean DEFAULT false NOT NULL,
	"energy_price_model" text DEFAULT 'norgespris' NOT NULL,
	"energy_price_nok_per_kwh" numeric(6, 3) DEFAULT '0.500' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "manual_charge_sessions" ALTER COLUMN "started_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "charge_schedules" ADD COLUMN "start_percent" integer;--> statement-breakpoint
ALTER TABLE "charge_schedules" ADD COLUMN "target_percent" integer;--> statement-breakpoint
ALTER TABLE "charge_schedules" ADD COLUMN "car_id" uuid;--> statement-breakpoint
ALTER TABLE "charge_schedules" ADD COLUMN "late_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "charge_schedules" ADD COLUMN "waiting_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "manual_charge_sessions" ADD COLUMN "kind" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "manual_charge_sessions" ADD COLUMN "zaptec_session_id" text;--> statement-breakpoint
ALTER TABLE "manual_charge_sessions" ADD COLUMN "start_energy_kwh" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "manual_charge_sessions" ADD COLUMN "last_observed_energy_kwh" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "manual_charge_sessions" ADD COLUMN "energy_kwh" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "cars" ADD CONSTRAINT "cars_default_location_id_locations_id_fk" FOREIGN KEY ("default_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chargers" ADD CONSTRAINT "chargers_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_schedules" ADD CONSTRAINT "charge_schedules_car_id_cars_id_fk" FOREIGN KEY ("car_id") REFERENCES "public"."cars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Data: sessions opened by "Forvarm" before the kind column existed were logged
-- as a preheat_started activity event at the same moment -- tag them as such.
UPDATE "manual_charge_sessions" m SET "kind" = 'preheat' WHERE EXISTS (SELECT 1 FROM "activity_events" e WHERE e."charger_id" = m."charger_id" AND e."type" = 'preheat_started' AND e."created_at" BETWEEN m."started_at" - interval '5 seconds' AND m."started_at" + interval '60 seconds');
