CREATE TABLE "vehicle_telemetry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"battery_percent" integer,
	"battery_reported_at" timestamp with time zone,
	"odometer_km" numeric(8, 1),
	"odometer_reported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "charge_schedules" ADD COLUMN "estimated_duration_minutes" integer;