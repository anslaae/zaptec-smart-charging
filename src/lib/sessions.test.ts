import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";

// openSession against a real (in-memory) Postgres built from the Drizzle
// migrations, so the D66 unique index is the one production gets.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/cars", () => ({ defaultCarId: async () => null }));
vi.mock("@/lib/zaptec/client", () => ({ getChargerState: vi.fn(), listChargers: vi.fn(async () => []) }));
vi.mock("@/lib/db", async () => (await import("@/lib/db/testDb")).createTestDb());

const { db } = await import("@/lib/db");
const { manualChargeSessions } = await import("@/lib/db/schema");
const { openSession, isUniqueViolation } = await import("./sessions");

const CHARGER = "charger-1";
const openRows = () =>
  db
    .select()
    .from(manualChargeSessions)
    .where(and(eq(manualChargeSessions.chargerId, CHARGER), isNull(manualChargeSessions.endedAt)));

beforeEach(async () => {
  await db.delete(manualChargeSessions);
});

describe("openSession (D62/D66)", () => {
  it("a second Lad nå reuses the open row", async () => {
    await openSession(CHARGER, "manual", null);
    await openSession(CHARGER, "manual", null);
    expect(await openRows()).toHaveLength(1);
  });

  it("Lad nå while Forvarm is on ends Forvarm and opens Lad nå (D62)", async () => {
    await openSession(CHARGER, "preheat", null);
    await openSession(CHARGER, "manual", null);
    const open = await openRows();
    expect(open.map((r) => r.kind)).toEqual(["manual"]);
    expect(await db.select().from(manualChargeSessions)).toHaveLength(2);
  });

  it("two taps at the same moment (two phones) leave one open row", async () => {
    await Promise.all([openSession(CHARGER, "manual", null), openSession(CHARGER, "manual", null)]);
    expect(await openRows()).toHaveLength(1);
  });

  it("Lad nå and Forvarm at the same moment leave one open row", async () => {
    await Promise.all([openSession(CHARGER, "manual", null), openSession(CHARGER, "preheat", null)]);
    expect(await openRows()).toHaveLength(1);
  });

  it("the database refuses a second open row outright", async () => {
    await db.insert(manualChargeSessions).values({ chargerId: CHARGER, kind: "manual" });
    const second = db.insert(manualChargeSessions).values({ chargerId: CHARGER, kind: "automatic" });
    await expect(second).rejects.toSatisfy(isUniqueViolation);
  });

  it("a guest window lives alongside (UC15)", async () => {
    await openSession(CHARGER, "guest", null, undefined, "Kari");
    await openSession(CHARGER, "manual", null);
    expect((await openRows()).map((r) => r.kind).sort()).toEqual(["guest", "manual"]);
  });
});
