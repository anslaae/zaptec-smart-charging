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

/**
 * Ensures location/charger/car rows exist for what Zaptec reports, and returns
 * them. Runs on every page load, so the usual case is three reads in parallel
 * (one database round trip) and no writes; it only writes when a row is
 * missing or Zaptec's installation name changed.
 */
export async function getHomeContext(zaptecChargers: ZaptecCharger[]): Promise<HomeContext> {
  const first = zaptecChargers[0];
  if (!first) return { location: null, car: await getDefaultCar(null) };

  const [found, knownChargers, existingCar] = await Promise.all([
    db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(eq(locations.zaptecInstallationId, first.installationId))
      .limit(1)
      .then((rows) => rows[0]),
    db.select({ id: chargers.id }).from(chargers),
    readCar(),
  ]);

  let location = found;
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

  const known = new Set(knownChargers.map((c) => c.id));
  const missing = zaptecChargers.filter((c) => !known.has(c.id));
  if (missing.length > 0) {
    await db
      .insert(chargers)
      .values(missing.map((c) => ({ id: c.id, locationId: location.id })))
      .onConflictDoNothing();
  }

  return { location, car: existingCar ?? (await getDefaultCar(location.id)) };
}

async function readCar(): Promise<HomeContext["car"]> {
  const [row] = await db
    .select({ id: cars.id, name: cars.name, batteryCapacityKwh: cars.batteryCapacityKwh })
    .from(cars)
    .limit(1);
  return row ? { ...row, batteryCapacityKwh: Number(row.batteryCapacityKwh) } : null;
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

