import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cars } from "@/lib/db/schema";

// Car attribution (design 6c): new rows record which car they belong to. With
// one car that is always the household's first car; the backfill migration
// (0020) uses the same rule for older rows.

/** The household's default car id, or null before any car exists. */
export async function defaultCarId(): Promise<string | null> {
  const [row] = await db.select({ id: cars.id }).from(cars).orderBy(asc(cars.createdAt)).limit(1);
  return row?.id ?? null;
}

/** The car a Smartcar vehicle id belongs to, falling back to the default car. */
export async function carIdForVehicle(vehicleId: string | null | undefined): Promise<string | null> {
  if (vehicleId) {
    const [row] = await db.select({ id: cars.id }).from(cars).where(eq(cars.smartcarVehicleId, vehicleId)).limit(1);
    if (row) return row.id;
  }
  return defaultCarId();
}
