ALTER TABLE "charge_schedules" ADD COLUMN "prior_session_energy_kwh" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "charge_schedules" ADD COLUMN "last_observed_session_energy_kwh" numeric(6, 2);