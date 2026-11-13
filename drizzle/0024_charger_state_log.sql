CREATE TABLE "charger_state_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charger_id" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation_mode" integer,
	"power_kw" numeric(6, 2),
	"phase1_amps" real,
	"phase2_amps" real,
	"phase3_amps" real,
	"final_stop_active" boolean,
	"session_id" text,
	"raw" jsonb
);
--> statement-breakpoint
CREATE INDEX "charger_state_log_charger_observed" ON "charger_state_log" USING btree ("charger_id","observed_at");