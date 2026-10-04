CREATE TABLE "schedule_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"charger_id" text NOT NULL,
	"action" text NOT NULL,
	"command_id" integer NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "charge_schedules" ADD COLUMN "simulate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_actions" ADD CONSTRAINT "schedule_actions_schedule_id_charge_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."charge_schedules"("id") ON DELETE no action ON UPDATE no action;