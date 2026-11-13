import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { ChargerOperationMode, ZaptecCommand } from "./constants";
import type { ChargerState } from "./types";

// D67: Forvarm while the car is already charging leaves that charge alone.
// startPreheat against an in-memory Postgres (real migrations); the Zaptec
// client is a stub, so no command can reach a real charger.
const charger = { id: "charger-1", isOnline: true, circuitId: "c", installationId: "i" };
let state: Partial<ChargerState> = {};
const sendChargerCommand = vi.fn(async () => undefined);
const cancelSmartRows = vi.fn(async () => 0);

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/cars", () => ({ defaultCarId: async () => null }));
vi.mock("@/lib/db", async () => (await import("@/lib/db/testDb")).createTestDb());
vi.mock("@/lib/auth/dal", () => ({ verifySession: async () => ({ userId: USER_ID }) }));
vi.mock("@/lib/scheduler/smartRun", () => ({ cancelSmartRows }));
vi.mock("./client", async () => ({
  ...(await import("./state")),
  listChargers: async () => [charger],
  getChargerState: async () => state,
  sendChargerCommand,
}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const { db } = await import("@/lib/db");
const { activityEvents, chargeSchedules, manualChargeSessions, scheduleActions, users } = await import("@/lib/db/schema");
const { startPreheat, stopChargingNow } = await import("./actions");
const { loadLoopGuard } = await import("@/lib/scheduler/loopGuard.server");

const charging: Partial<ChargerState> = {
  chargerId: charger.id,
  operationMode: ChargerOperationMode.Charging,
  sessionId: "s1",
  sessionEnergyKwh: 4,
};
const connectedIdle: Partial<ChargerState> = { ...charging, operationMode: ChargerOperationMode.StoppedOrIdle };

const plan = (source: "user" | "smart", status: "pending" | "active", readyInMs = 8 * 3600e3) =>
  db
    .insert(chargeSchedules)
    .values({ chargerId: charger.id, chargerName: "Lader", source, status, targetEnergyKwh: "10.00", readyBy: new Date(Date.now() + readyInMs) })
    .returning();
const scheduleRow = async (id: string) => (await db.select().from(chargeSchedules).where(eq(chargeSchedules.id, id)))[0];
const minutesFromNow = (d: Date | null) => (d == null ? null : Math.round((d.getTime() - Date.now()) / 60_000));
const sessions = () => db.select().from(manualChargeSessions).where(eq(manualChargeSessions.chargerId, charger.id));
const openRows = () =>
  db.select().from(manualChargeSessions).where(and(eq(manualChargeSessions.chargerId, charger.id), isNull(manualChargeSessions.endedAt)));
const events = async () => (await db.select().from(activityEvents)).map((e) => e.type);
const preheat = (cancelPlan = false) => {
  const fd = new FormData();
  if (cancelPlan) fd.set("cancelPlan", "1");
  return startPreheat(charger.id, "Lader", {}, fd);
};

beforeEach(async () => {
  await db.delete(activityEvents);
  await db.delete(scheduleActions);
  await db.delete(manualChargeSessions);
  await db.delete(chargeSchedules);
  await db.insert(users).values({ id: USER_ID, email: "a@example.test", passwordHash: "x", name: "A" }).onConflictDoNothing();
  sendChargerCommand.mockClear();
  cancelSmartRows.mockClear();
});

describe("Forvarm while the car is already charging (D67)", () => {
  it("during a plan: a 60-min hold on the plan, which keeps running -- no command, no new row", async () => {
    state = charging;
    const [row] = await plan("user", "active");
    // Even with cancelPlan=1 (a stale sheet), a charging plan is left alone.
    expect(await preheat(true)).toEqual({ success: true });
    const after = await scheduleRow(row.id);
    expect(after.status).toBe("active");
    expect(minutesFromNow(after.preheatHoldUntil)).toBe(60);
    expect(sendChargerCommand).not.toHaveBeenCalled();
    expect(cancelSmartRows).not.toHaveBeenCalled();
    expect(await sessions()).toHaveLength(0);
    expect(await events()).toEqual(["preheat_during_charge"]);
    // Nothing the loop guard (D65) or the start cap (D64) counts
    expect(await db.select().from(scheduleActions)).toHaveLength(0);
  });

  it("the hold ends at the plan's departure when that's sooner", async () => {
    state = charging;
    const [row] = await plan("user", "active", 20 * 60_000);
    await preheat();
    expect(minutesFromNow((await scheduleRow(row.id)).preheatHoldUntil)).toBe(20);
  });

  it("during Smart lading: the Smart row stays and gets the hold, no command, no new row", async () => {
    state = charging;
    const [row] = await plan("smart", "active");
    expect(await preheat()).toEqual({ success: true });
    const after = await scheduleRow(row.id);
    expect(after.status).toBe("active");
    expect(minutesFromNow(after.preheatHoldUntil)).toBe(60);
    expect(cancelSmartRows).not.toHaveBeenCalled();
    expect(sendChargerCommand).not.toHaveBeenCalled();
    expect(await sessions()).toHaveLength(0);
  });

  it("Stopp ends the hold", async () => {
    state = charging;
    const [row] = await plan("user", "active");
    await preheat();
    await stopChargingNow(charger.id, "Lader", {}, new FormData());
    expect((await scheduleRow(row.id)).preheatHoldUntil).toBeNull();
  });

  it("the loop guard doesn't take a Forvarm tap as a reset (it stays paused)", async () => {
    state = charging;
    await db.insert(activityEvents).values({ chargerId: charger.id, chargerName: "Lader", type: "automation_paused", detail: "s1" });
    await plan("user", "active");
    await preheat();
    expect(await loadLoopGuard(charger.id, new Date(), "s1")).toBe("paused");
  });

  it("during Lad nå: the Lad nå row stays open as it is, no command", async () => {
    state = charging;
    await db.insert(manualChargeSessions).values({ chargerId: charger.id, kind: "manual", zaptecSessionId: "s1" });
    expect(await preheat()).toEqual({ success: true });
    const open = await openRows();
    expect(open.map((r) => r.kind)).toEqual(["manual"]);
    expect(await sessions()).toHaveLength(1);
    expect(sendChargerCommand).not.toHaveBeenCalled();
    expect(await db.select().from(chargeSchedules)).toHaveLength(0); // no hold: Lad nå keeps the power on anyway
  });

  it("during a guest window: left alone", async () => {
    state = charging;
    await db.insert(manualChargeSessions).values({ chargerId: charger.id, kind: "guest", zaptecSessionId: "s1" });
    expect(await preheat()).toEqual({ success: true });
    expect((await openRows()).map((r) => r.kind)).toEqual(["guest"]);
    expect(sendChargerCommand).not.toHaveBeenCalled();
  });
});

describe("Forvarm when the car isn't charging (unchanged)", () => {
  it("starts power and opens a Forvarm row", async () => {
    state = connectedIdle;
    expect(await preheat()).toEqual({ success: true });
    expect(sendChargerCommand).toHaveBeenCalledWith(charger.id, ZaptecCommand.ResumeCharging);
    expect((await openRows()).map((r) => r.kind)).toEqual(["preheat"]);
    expect(await events()).toEqual(["preheat_started"]);
  });

  it("a plan waiting for its start time still needs cancelPlan=1 (D27)", async () => {
    state = connectedIdle;
    await plan("user", "pending");
    expect((await preheat()).error).toBeTruthy();
    expect(sendChargerCommand).not.toHaveBeenCalled();
    expect(await preheat(true)).toEqual({ success: true });
    expect(sendChargerCommand).toHaveBeenCalledTimes(1);
  });

  it("charging with nothing behind it (about to be stopped): normal Forvarm", async () => {
    state = charging;
    expect(await preheat()).toEqual({ success: true });
    expect(sendChargerCommand).toHaveBeenCalledTimes(1);
    expect((await openRows()).map((r) => r.kind)).toEqual(["preheat"]);
  });
});
