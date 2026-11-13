CREATE TABLE "charge_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charger_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"since" timestamp with time zone NOT NULL,
	"detail" jsonb,
	"notified_at" timestamp with time zone,
	"retried_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "charge_incidents_one_open" ON "charge_incidents" USING btree ("charger_id") WHERE "charge_incidents"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "charge_incidents_subject" ON "charge_incidents" USING btree ("subject");