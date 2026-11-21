import { beforeEach, describe, expect, it, vi } from "vitest";

// D85 against an in-memory Postgres (real migrations).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => (await import("@/lib/db/testDb")).createTestDb());

const { db } = await import("@/lib/db");
const { chargeSchedules, chargerStateLog, scheduleActions } = await import("@/lib/db/schema");
const { getLearnedPowerDetails, getLearnedPowerKw, resetLearnedPowerCache } = await import("./powerHistory.server");

const day0 = new Date("2026-11-14T22:00:00Z");
const at = (day: number, min: number) => new Date(day0.getTime() + day * 86_400_000 + min * 60_000);

async function completedPlan(day: number, endMin: number, remaining = "17.90") {
  const [row] = await db
    .insert(chargeSchedules)
    .values({
      chargerId: "c1",
      chargerName: "Lader",
      targetEnergyKwh: "18",
      readyBy: at(day, 600),
      status: "completed",
      startedAt: at(day, 0),
      endedAt: at(day, endMin),
      remainingKwhAtStart: remaining,
    })
    .returning();
  await db.insert(scheduleActions).values({ scheduleId: row.id, chargerId: "c1", action: "resume", commandId: 507 });
  return row;
}

async function logRow(day: number, min: number, mode: number, kw: number) {
  await db.insert(chargerStateLog).values({ chargerId: "c1", observedAt: at(day, min), operationMode: mode, powerKw: kw.toFixed(2) });
}

beforeEach(async () => {
  await db.delete(scheduleActions);
  await db.delete(chargeSchedules);
  await db.delete(chargerStateLog);
  resetLearnedPowerCache();
});

describe("getLearnedPowerDetails (D85)", () => {
  it("learns ~4.4 kW from the state log for a car drawing 4.36-4.40 kW (was 2.8 from wall clock)", async () => {
    for (let day = 0; day < 3; day++) {
      await completedPlan(day, 455);
      await logRow(day, 0, 2, 0);
      await logRow(day, 60, 3, 4.36);
      await logRow(day, 150, 3, 4.4);
      await logRow(day, 330, 3, 2.0);
      await logRow(day, 345, 5, 0);
    }
    const details = await getLearnedPowerDetails();
    expect(details.kw).toBeGreaterThanOrEqual(4.3);
    expect(details.kw).toBeLessThanOrEqual(4.4);
    expect(details.samples).toHaveLength(3);
    expect(details.samples.map((s) => s.endedAt)).toEqual([at(2, 455), at(1, 455), at(0, 455)]); // newest first
    expect(await getLearnedPowerKw()).toBe(details.kw);
  });

  it("falls back to the wall-clock sample for plans older than the state log", async () => {
    await completedPlan(0, 360, "18.00"); // 3 kW over 6 h, before any log row
    await completedPlan(2, 455);
    await logRow(1, 0, 5, 0); // the log starts on day 1
    await logRow(2, 60, 3, 4.4);
    await logRow(2, 300, 5, 0);
    const details = await getLearnedPowerDetails();
    expect(details.samples.map((s) => s.kw)).toEqual([4.4, 3]);
    expect(details.kw).toBeCloseTo(3.7, 5);
  });

  it("at most 10 samples, and none without history", async () => {
    expect(await getLearnedPowerDetails()).toEqual({ kw: null, samples: [] });
    resetLearnedPowerCache();
    await logRow(0, -10, 5, 0);
    for (let i = 0; i < 12; i++) {
      await completedPlan(i, 120);
      await logRow(i, 10, 3, 4.4);
      await logRow(i, 100, 5, 0);
    }
    const details = await getLearnedPowerDetails();
    expect(details.samples).toHaveLength(10);
    expect(details.kw).toBe(4.4);
  });
});
