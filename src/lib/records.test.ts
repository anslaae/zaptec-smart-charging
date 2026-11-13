import { beforeEach, describe, expect, it, vi } from "vitest";

// Imported Zaptec sessions (D70) in Historikk/Innsikt, against an in-memory
// Postgres built from the real migrations.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => (await import("@/lib/db/testDb")).createTestDb());

const { db } = await import("@/lib/db");
const { manualChargeSessions } = await import("@/lib/db/schema");
const { loadSessionRecords } = await import("./records");
const { monthInsights } = await import("@/lib/ui/insights");

const CAR = "00000000-0000-4000-8000-0000000000ca";
const prices = { energyNokPerKwh: 0.5, gridDayNokPerKwh: 0.4, gridNightNokPerKwh: 0.3 };
const since = new Date("2026-01-01T00:00:00Z");

beforeEach(async () => {
  await db.delete(manualChargeSessions);
  await db.insert(manualChargeSessions).values({
    chargerId: "charger-1",
    kind: "imported",
    zaptecSessionId: "zap-1",
    startedAt: new Date("2026-06-02T20:00:00Z"),
    endedAt: new Date("2026-06-02T23:00:00Z"),
    energyKwh: "20.00",
  });
});

describe("imported sessions in records (D70)", () => {
  it("are listed with the default car, no person, and a cost from time and kWh", async () => {
    const { records } = await loadSessionRecords(since, 46, prices, CAR);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ tag: "imported", kwh: 20, userId: null, carId: CAR });
    // 22:00-01:00 Oslo (summer time): all at the night rate, 20 x (0.5 + 0.3)
    expect(records[0].costNok).toBeCloseTo(16, 5);
  });

  it("have no cost (not 0 kr) when no energy price is set", async () => {
    const { records } = await loadSessionRecords(since, 46, { energyNokPerKwh: 0, gridDayNokPerKwh: null, gridNightNokPerKwh: null }, CAR);
    expect(records[0].costNok).toBeNull();
  });

  it("count in Innsikt's month totals, but for no person", async () => {
    const { records } = await loadSessionRecords(since, 46, prices, CAR);
    const m = monthInsights(records, "2026-06", new Date("2026-11-13T10:00:00Z"));
    expect(m.totalKwh).toBe(20);
    expect(m.totalCostNok).toBeCloseTo(records[0].costNok!, 5);
    expect(m.importedKwh).toBe(20);
    expect(m.perPerson).toEqual([]);
  });
});
