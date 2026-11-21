import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import type { ChargerState } from "@/lib/zaptec/types";

// D86 against an in-memory Postgres (real migrations). The charger client is
// mocked only to prove nothing here ever sends a command.
const sendChargerCommand = vi.fn();
const getStateOfCharge = vi.fn(async () => null as { percent: number; oemUpdatedAt: Date } | null);
const stateOfChargeCarId = vi.fn(async () => null as string | null);
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => (await import("@/lib/db/testDb")).createTestDb());
vi.mock("@/lib/zaptec/client", () => ({ sendChargerCommand }));
vi.mock("@/lib/smartcar/client", () => ({ getStateOfCharge, stateOfChargeCarId }));

const { db } = await import("@/lib/db");
const { cars, chargeSchedules, chargerStateLog, manualChargeSessions, vehicleTelemetry } = await import("@/lib/db/schema");
const { checkPlanReading, checkSessionReading, getKwhPerPercentDetails, latestBatteryReading, resetKwhPerPercentCache } =
  await import("./socTarget.server");

const t0 = new Date("2026-11-20T22:00:00Z");
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const charging = { chargerId: "c1", operationMode: ChargerOperationMode.Charging, instantPowerWatts: 4400, sessionId: "s1" } as ChargerState;
let carId: string;
const ours = (percent: number, min: number) => ({ percent, oemUpdatedAt: at(min), carId });

beforeEach(async () => {
  await db.delete(chargeSchedules);
  await db.delete(manualChargeSessions);
  await db.delete(vehicleTelemetry);
  await db.delete(chargerStateLog);
  await db.delete(cars);
  [{ id: carId }] = await db.insert(cars).values({ name: "Mokka", batteryCapacityKwh: "46.0" }).returning({ id: cars.id });
  resetKwhPerPercentCache();
  getStateOfCharge.mockReset();
  getStateOfCharge.mockResolvedValue(null);
  stateOfChargeCarId.mockReset();
  stateOfChargeCarId.mockResolvedValue(carId);
  sendChargerCommand.mockClear();
  // Measured history: drawing 4.4 kW from the start.
  await db.insert(chargerStateLog).values({ chargerId: "c1", observedAt: at(0), operationMode: 3, powerKw: "4.40" });
});

describe("latestBatteryReading", () => {
  it("the newer of the Smartcar API and the newest webhook row, with its car", async () => {
    await db.insert(vehicleTelemetry).values({ batteryPercent: 61, batteryReportedAt: at(10) });
    getStateOfCharge.mockResolvedValue({ percent: 55, oemUpdatedAt: at(0) });
    expect(await latestBatteryReading()).toEqual(ours(61, 10)); // unattributed row: the default car
    getStateOfCharge.mockResolvedValue({ percent: 64, oemUpdatedAt: at(20) });
    expect(await latestBatteryReading()).toEqual(ours(64, 20));
  });
});

describe("getKwhPerPercentDetails", () => {
  async function plan(day: number, kwh: number, before: number, after: number) {
    const start = at(day * 1440);
    const end = at(day * 1440 + 300);
    await db.insert(chargeSchedules).values({
      chargerId: "c1",
      chargerName: "Lader",
      targetEnergyKwh: kwh.toFixed(2),
      readyBy: end,
      status: "completed",
      startedAt: start,
      endedAt: end,
      zaptecSessionId: `s${day}`,
      priorSessionEnergyKwh: "0",
      lastObservedSessionEnergyKwh: kwh.toFixed(2),
    });
    await db.insert(vehicleTelemetry).values([
      { batteryPercent: before, batteryReportedAt: new Date(start.getTime() - 20 * 60_000) },
      { batteryPercent: after, batteryReportedAt: new Date(end.getTime() + 30 * 60_000) },
    ]);
  }

  it("learns from plans with a reading on each side (median), else capacity/100", async () => {
    expect((await getKwhPerPercentDetails(46)).kwhPerPercent).toBe(0.46);
    await plan(-3, 20.99, 41, 92); // 0.41
    await plan(-2, 10.45, 58, 81); // 0.454
    resetKwhPerPercentCache();
    expect((await getKwhPerPercentDetails(46)).kwhPerPercent).toBe(0.46); // only 2 samples
    await plan(-1, 24, 30, 82); // 0.46
    resetKwhPerPercentCache();
    const details = await getKwhPerPercentDetails(46);
    expect(details.samples).toHaveLength(3);
    expect(details.kwhPerPercent).toBeCloseTo(10.45 / 23, 5);
    expect(details.learned).toBe(true);
  });

  it("is cached (~10 min)", async () => {
    expect((await getKwhPerPercentDetails(46)).kwhPerPercent).toBe(0.46);
    await plan(-3, 20.99, 41, 92);
    await plan(-2, 10.45, 58, 81);
    await plan(-1, 24, 30, 82);
    expect((await getKwhPerPercentDetails(46)).learned).toBe(false); // still the cached answer
  });
});

describe("checkPlanReading", () => {
  async function userPlan(values: Partial<typeof chargeSchedules.$inferInsert> = {}) {
    const [row] = await db
      .insert(chargeSchedules)
      .values({
        chargerId: "c1",
        chargerName: "Lader",
        targetEnergyKwh: "13.80",
        readyBy: at(600),
        status: "active",
        startedAt: at(0),
        startPercent: 50,
        targetPercent: 80,
        ...values,
      })
      .returning();
    return row;
  }
  const reload = async (id: string) => (await db.select().from(chargeSchedules)).find((r) => r.id === id)!;

  it("retargets from measured energy and stores the baseline; repeated ticks with the same reading do nothing more", async () => {
    let row = await userPlan();
    // 4.4 kW since 22:00: 2.13 kWh at the reading (29 min), 2.2 kWh now.
    const first = await checkPlanReading({ schedule: row, state: charging, deliveredKwh: 2.2, reading: ours(70, 29), kwhPerPercent: 0.46, now: at(30) });
    expect(first.kind).toBe("retarget");
    row = await reload(row.id);
    // Wanted 2.13 + 10 × 0.46 ≈ 6.7, but one correction lowers by at most 10 points' worth: 13.8 − 4.6.
    expect(Number(row.targetEnergyKwh)).toBeCloseTo(9.2, 2);
    expect(row.socAdjust).toMatchObject({ percent: 70, readingAt: at(29).toISOString() });
    for (let m = 31; m < 90; m++) {
      const again = await checkPlanReading({ schedule: row, state: charging, deliveredKwh: 2.2 + (m - 30) * 0.07, reading: ours(70, 29), kwhPerPercent: 0.46, now: at(m) });
      expect(again.kind).not.toBe("retarget");
      expect(again.kind).not.toBe("complete");
      row = await reload(row.id);
    }
    expect(sendChargerCommand).not.toHaveBeenCalled();
  });

  it("a reading at the target completes (caller's path); a cancelled plan is never written", async () => {
    const row = await userPlan();
    const done = await checkPlanReading({ schedule: row, state: charging, deliveredKwh: 9, reading: ours(80, 100), kwhPerPercent: 0.46, now: at(101) });
    expect(done).toEqual({ kind: "complete", percent: 80 });
    await db.update(chargeSchedules).set({ status: "cancelled" });
    await checkPlanReading({ schedule: row, state: charging, deliveredKwh: 2, reading: ours(70, 29), kwhPerPercent: 0.46, now: at(30) });
    expect((await reload(row.id)).targetEnergyKwh).toBe("13.80");
    expect(sendChargerCommand).not.toHaveBeenCalled();
  });

  it("M1: a reading from another car is ignored (no stop, no drift)", async () => {
    const [other] = await db.insert(cars).values({ name: "Gjest", batteryCapacityKwh: "60.0" }).returning({ id: cars.id });
    const row = await userPlan({ carId: other.id });
    expect((await checkPlanReading({ schedule: row, state: charging, deliveredKwh: 9, reading: ours(85, 100), kwhPerPercent: 0.46, now: at(101) })).kind).toBe("none");
    expect((await checkPlanReading({ schedule: row, state: charging, deliveredKwh: 2.2, reading: ours(70, 29), kwhPerPercent: 0.46, now: at(30) })).kind).toBe("none");
  });

  it("H1 through the DB: a pause after the reading doesn't retarget low or stop early", async () => {
    await db.delete(chargerStateLog);
    const h = (hhmm: string, day = 20) => new Date(`2026-11-${day}T${hhmm}:00Z`);
    await db.insert(chargerStateLog).values([
      { chargerId: "c1", observedAt: h("22:00"), operationMode: 3, powerKw: "11.00" },
      { chargerId: "c1", observedAt: h("23:00"), operationMode: 5, powerKw: "0.00" },
      { chargerId: "c1", observedAt: h("00:30", 21), operationMode: 3, powerKw: "11.00" },
    ]);
    const row = await userPlan({ startedAt: h("22:00"), startPercent: 20, targetPercent: 80, targetEnergyKwh: "33.00" });
    const a = await checkPlanReading({
      schedule: row,
      state: { ...charging, instantPowerWatts: 11_000 },
      deliveredKwh: 16.5,
      reading: { percent: 40, oemUpdatedAt: h("23:00"), carId },
      kwhPerPercent: 0.55,
      now: h("01:00", 21),
    });
    expect(a.kind).toBe("none");
    expect((await reload(row.id)).targetEnergyKwh).toBe("33.00");
  });
});

describe("checkSessionReading (automatic, \"Lad med en gang\")", () => {
  async function automatic(car: string | null) {
    const [row] = await db
      .insert(manualChargeSessions)
      .values({ chargerId: "c1", kind: "automatic", carId: car, startedAt: at(0), targetKwh: "13.80", zaptecSessionId: "s1", startEnergyKwh: "0", lastObservedEnergyKwh: "2" })
      .returning();
    return row;
  }

  it("stops at a fresh reading ≥ target, retargets on drift, ignores old readings", async () => {
    const row = await automatic(carId);
    const base = { row, state: charging, deliveredKwh: 2, targetPercent: 80, kwhPerPercent: 0.46 };
    expect((await checkSessionReading({ ...base, reading: ours(90, -10), now: at(30) })).kind).toBe("none");
    expect(await checkSessionReading({ ...base, reading: ours(81, 29), now: at(30) })).toMatchObject({ kind: "complete", percent: 81 });
    // start implied: 80 − 13.8/0.46 = 50; expected at ~2 kWh ≈ 54; reading 65 -> retarget (lower, within 10 points' worth)
    const re = await checkSessionReading({ ...base, reading: ours(65, 29), now: at(30) });
    expect(re.kind).toBe("retarget");
    const [after] = await db.select().from(manualChargeSessions);
    expect(Number(after.targetKwh)).toBeLessThan(13.8);
    expect(after.socAdjust).toMatchObject({ percent: 65 });
    expect(sendChargerCommand).not.toHaveBeenCalled();
  });

  it("M1: a guest's or unattributed automatic row never acts on the household car's reading", async () => {
    const row = await automatic(null);
    const base = { row, state: charging, deliveredKwh: 2, targetPercent: 80, kwhPerPercent: 0.46 };
    expect((await checkSessionReading({ ...base, reading: ours(95, 29), now: at(30) })).kind).toBe("none");
    expect((await checkSessionReading({ ...base, reading: ours(60, 29), now: at(30) })).kind).toBe("none");
  });
});
