ALTER TABLE "manual_charge_sessions" ADD COLUMN "car_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicle_telemetry" ADD COLUMN "car_id" uuid;--> statement-breakpoint
ALTER TABLE "manual_charge_sessions" ADD CONSTRAINT "manual_charge_sessions_car_id_cars_id_fk" FOREIGN KEY ("car_id") REFERENCES "public"."cars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_telemetry" ADD CONSTRAINT "vehicle_telemetry_car_id_cars_id_fk" FOREIGN KEY ("car_id") REFERENCES "public"."cars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Backfill (design 6c): one car so far, so everything before this belongs to it -- except guest windows.
UPDATE "charge_schedules" SET "car_id" = (SELECT "id" FROM "cars" ORDER BY "created_at" LIMIT 1) WHERE "car_id" IS NULL;--> statement-breakpoint
UPDATE "manual_charge_sessions" SET "car_id" = (SELECT "id" FROM "cars" ORDER BY "created_at" LIMIT 1) WHERE "car_id" IS NULL AND "kind" <> 'guest';--> statement-breakpoint
UPDATE "vehicle_telemetry" SET "car_id" = (SELECT "id" FROM "cars" ORDER BY "created_at" LIMIT 1) WHERE "car_id" IS NULL;
