ALTER TABLE "charge_sessions" DROP CONSTRAINT "charge_sessions_schedule_id_charge_schedules_id_fk";
--> statement-breakpoint
ALTER TABLE "schedule_actions" DROP CONSTRAINT "schedule_actions_schedule_id_charge_schedules_id_fk";
--> statement-breakpoint
ALTER TABLE "charge_sessions" ADD CONSTRAINT "charge_sessions_schedule_id_charge_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."charge_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_actions" ADD CONSTRAINT "schedule_actions_schedule_id_charge_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."charge_schedules"("id") ON DELETE cascade ON UPDATE no action;