import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import type { ChargerState } from "@/lib/zaptec/types";

// D68 against an in-memory Postgres (real migrations): the flag lives on the
// Forvarm row / the plan's hold, and the push goes out once per Forvarm.
const sendPushToAllSubscribers = vi.fn(async () => undefined);
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => (await import("@/lib/db/testDb")).createTestDb());
vi.mock("@/lib/push/send", () => ({ sendPushToAllSubscribers }));

const { db } = await import("@/lib/db");
const { chargeSchedules, manualChargeSessions } = await import("@/lib/db/schema");
const { checkHoldPower, checkPreheatSessionPower } = await import("./preheatPower.server");

const t0 = new Date("2026-11-13T08:30:48Z");
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const state = (mode: number, watts: number) =>
  ({ chargerId: "charger-1", operationMode: mode, instantPowerWatts: watts, sessionId: "s1" }) as ChargerState;
const finished = state(ChargerOperationMode.StoppedOrIdle, 0);
const drawing = state(ChargerOperationMode.Charging, 3000);

beforeEach(async () => {
  await db.delete(manualChargeSessions);
  await db.delete(chargeSchedules);
  sendPushToAllSubscribers.mockClear();
});

describe("Forvarm session: the car stops drawing (D68)", () => {
  const row = async () => (await db.select().from(manualChargeSessions))[0];

  it("mode 5 gives the flag and one push; later ticks don't push again", async () => {
    await db.insert(manualChargeSessions).values({ chargerId: "charger-1", kind: "preheat", startedAt: t0, zaptecSessionId: "s1" });
    await checkPreheatSessionPower(await row(), drawing, at(1));
    expect((await row()).powerLostAt).toBeNull();
    await checkPreheatSessionPower(await row(), finished, at(6.5));
    expect((await row()).powerLostAt).toEqual(at(6.5));
    expect((await row()).powerLostNotifiedAt).toEqual(at(6.5));
    expect(sendPushToAllSubscribers).toHaveBeenCalledTimes(1);
    expect(sendPushToAllSubscribers).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Forvarming bruker batteriet", tag: "preheat-charger-1" }),
    );
    await checkPreheatSessionPower(await row(), finished, at(7.5));
    await checkPreheatSessionPower(await row(), finished, at(8.5));
    expect(sendPushToAllSubscribers).toHaveBeenCalledTimes(1);
  });

  it("drawing again clears the flag (and a second stop doesn't push again)", async () => {
    await db.insert(manualChargeSessions).values({ chargerId: "charger-1", kind: "preheat", startedAt: t0, zaptecSessionId: "s1" });
    await checkPreheatSessionPower(await row(), finished, at(6));
    await checkPreheatSessionPower(await row(), drawing, at(8));
    expect((await row()).powerLostAt).toBeNull();
    await checkPreheatSessionPower(await row(), finished, at(12));
    expect((await row()).powerLostAt).toEqual(at(12));
    expect(sendPushToAllSubscribers).toHaveBeenCalledTimes(1);
  });
});

describe("Forvarm hold on a plan: the car stops drawing (D68)", () => {
  it("flags the hold and pushes once", async () => {
    const [plan] = await db
      .insert(chargeSchedules)
      .values({ chargerId: "charger-1", chargerName: "Lader", status: "active", targetEnergyKwh: "10", readyBy: at(120), preheatHoldUntil: at(60) })
      .returning();
    const read = async () => (await db.select().from(chargeSchedules).where(eq(chargeSchedules.id, plan.id)))[0];
    await checkHoldPower(await read(), finished, at(5));
    await checkHoldPower(await read(), finished, at(6));
    expect((await read()).preheatPowerLostAt).toEqual(at(5));
    expect(sendPushToAllSubscribers).toHaveBeenCalledTimes(1);
    await checkHoldPower(await read(), drawing, at(7));
    expect((await read()).preheatPowerLostAt).toBeNull();
  });
});
