import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cars, chargers, locations } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { VEHICLE_BATTERY_CAPACITY_KWH } from "@/lib/vehicle";
import type { ZaptecCharger } from "@/lib/zaptec/types";

// Locations, chargers and cars (design/redesign/HANDOFF.md §7). The app is
// organised around an address; today there is one location, one charger and
// one car, and the UI never shows a picker for that case. Rows are created
// lazily from what Zaptec reports, so a fresh database needs no seed.

export interface HomeContext {
  location: { id: string; name: string } | null;
  car: { id: string; name: string; batteryCapacityKwh: number } | null;
}

const DEFAULT_CAR_NAME = "Opel Mokka-e";

/** Ensures location/charger/car rows exist for what Zaptec reports, and returns them. */
export async function getHomeContext(zaptecChargers: ZaptecCharger[]): Promise<HomeContext> {
  const first = zaptecChargers[0];
  if (!first) return { location: null, car: await getDefaultCar(null) };

  let [location] = await db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(eq(locations.zaptecInstallationId, first.installationId))
    .limit(1);
  // The name comes from Zaptec (the installation's name) and follows it --
  // renaming belongs in Zaptec, so the app shows it read-only.
  if (location && first.installationName && location.name !== first.installationName) {
    await db.update(locations).set({ name: first.installationName }).where(eq(locations.id, location.id));
    location = { ...location, name: first.installationName };
  }
  if (!location) {
    [location] = await db
      .insert(locations)
      .values({ name: first.installationName || "Hjemme", zaptecInstallationId: first.installationId })
      .onConflictDoNothing()
      .returning({ id: locations.id, name: locations.name });
    location ??= (
      await db
        .select({ id: locations.id, name: locations.name })
        .from(locations)
        .where(eq(locations.zaptecInstallationId, first.installationId))
        .limit(1)
    )[0];
  }

  for (const charger of zaptecChargers) {
    await db
      .insert(chargers)
      .values({ id: charger.id, locationId: location.id })
      .onConflictDoNothing();
  }

  return { location, car: await getDefaultCar(location.id) };
}

/** The household car (created from vehicle.ts + SMARTCAR_VEHICLE_ID on first use). */
export async function getDefaultCar(locationId: string | null): Promise<HomeContext["car"]> {
  const [existing] = await db
    .select({ id: cars.id, name: cars.name, batteryCapacityKwh: cars.batteryCapacityKwh })
    .from(cars)
    .limit(1);
  if (existing) return { ...existing, batteryCapacityKwh: Number(existing.batteryCapacityKwh) };

  const [created] = await db
    .insert(cars)
    .values({
      name: DEFAULT_CAR_NAME,
      batteryCapacityKwh: VEHICLE_BATTERY_CAPACITY_KWH.toFixed(1),
      smartcarVehicleId: env.SMARTCAR_VEHICLE_ID ?? null,
      defaultLocationId: locationId,
    })
    .returning({ id: cars.id, name: cars.name, batteryCapacityKwh: cars.batteryCapacityKwh });
  return { ...created, batteryCapacityKwh: Number(created.batteryCapacityKwh) };
}

