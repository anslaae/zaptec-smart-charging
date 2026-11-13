CREATE TABLE "zaptec_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"charger_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"energy_kwh" numeric(8, 3) NOT NULL,
	"meter_readings" jsonb,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "zaptec_sessions_charger_started" ON "zaptec_sessions" USING btree ("charger_id","started_at");