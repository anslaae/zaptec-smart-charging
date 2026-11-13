import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import type { ChargerState } from "@/lib/zaptec/types";

// D75 against an in-memory Postgres (real migrations, 0026 included).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => (await import("@/lib/db/testDb")).createTestDb());
const pushes: { title: string; body: string; tag?: string }[] = [];
vi.mock("@/lib/push/send", () => ({
  sendPushToAllSubscribers: async (payload: { title: string; body: string; tag?: string }) => {
    pushes.push(payload);
  },
}));
let battery: { percent: number; oemUpdatedAt: Date } | null = null;
vi.mock("@/lib/smartcar/client", () => ({ getStateOfCharge: async () => battery }));
// sessions.ts reads the charger for other callers; never here.
vi.mock("@/lib/zaptec/client", () => ({
  listChargers: async () => [],
  getChargerState: async () => undefined,
  sendChargerCommand: async () => undefined,
}));

const { db } = await import("@/lib/db");
const { activityEvents, chargeIncidents, chargeSchedules, manualChargeSessions, scheduleActions } = await import("@/lib/db/schema");
const { syncChargerIncident } = await import("./sync.server");
const { START_FAILED_REASON } = await import("@/lib/scheduler/engine");
const { eq } = await import("drizzle-orm");

const t0 = new Date("2026-11-13T19:00:00Z");
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
const charger = { id: "charger-1", name: "ZAP" };

const state = (overrides: Partial<ChargerState> = {}): ChargerState =>
  ({
    chargerId: charger.id,
    isOnline: true,
    operationMode: ChargerOperationMode.StoppedOrIdle,
    finalStopActive: false,
    instantPowerWatts: 0,
    phaseCurrentsAmps: [0.04, 0.03, 0.03],
    sessionId: "z-1",
    sessionEnergyKwh: 6,
    chargeDurationSeconds: 3000,
    health: { warnings: 0, notifications: 0, signalDbm: -71 },
    ...overrides,
  }) as unknown as ChargerState;
const drawing = () => state({ operationMode: ChargerOperationMode.Charging, instantPowerWatts: 7100, phaseCurrentsAmps: [10, 0, 0] });

const sync = (s: ChargerState, now: Date, guardPaused = false) =>
  syncChargerIncident({ charger, state: s, guardPaused, capacityKwh: 46, now });
const incidents = () => db.select().from(chargeIncidents);
const activity = async () => (await db.select().from(activityEvents)).map((e) => e.type);

async function chargeNowRow(startedAt = t0) {
  const [row] = await db
    .insert(manualChargeSessions)
    .values({ chargerId: charger.id, kind: "manual", startedAt, startEnergyKwh: "0", lastObservedEnergyKwh: "6" })
    .returning();
  return row;
}

beforeEach(async () => {
  pushes.length = 0;
  battery = { percent: 50, oemUpdatedAt: at(-60) };
  await db.delete(chargeIncidents);
  await db.delete(manualChargeSessions);
  await db.delete(scheduleActions);
  await db.delete(chargeSchedules);
  await db.delete(activityEvents);
});

describe("syncChargerIncident: Lad nå (D75)", () => {
  it("the car stops below full: one incident, one push and one activity line, however many ticks", async () => {
    await chargeNowRow();
    await sync(state(), at(30));
    await sync(state(), at(31));
    const [incident] = await incidents();
    expect(incident).toMatchObject({ kind: "car", subject: expect.stringMatching(/^session:/), closedAt: null });
    expect(incident.notifiedAt).not.toBeNull();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ title: "Bilen sluttet å lade", tag: `incident-${incident.id}` });
    expect(await activity()).toEqual(["car_stopped"]);
  });

  it("drawing again closes it; a second stop in the same Lad nå shows again but pushes no more", async () => {
    await chargeNowRow();
    await sync(state(), at(30));
    await sync(drawing(), at(32));
    expect((await incidents())[0].closedAt).not.toBeNull();
    await sync(state(), at(40));
    const open = (await incidents()).filter((i) => i.closedAt == null);
    expect(open).toHaveLength(1);
    expect(open[0].notifiedAt).not.toBeNull();
    expect(pushes).toHaveLength(1);
  });

  it("probably full: 'trolig full', and the session ends itself 30 min after the car stopped", async () => {
    const row = await chargeNowRow();
    battery = { percent: 96, oemUpdatedAt: at(29) };
    await sync(state(), at(30));
    expect(pushes[0].title).toBe("Bilen er trolig full");
    expect(await activity()).toEqual(["car_stopped_full"]);
    await sync(state(), at(59));
    expect((await db.select().from(manualChargeSessions))[0].endedAt).toBeNull();
    await sync(state(), at(60));
    const [closed] = await db.select().from(manualChargeSessions);
    expect(closed.id).toBe(row.id);
    expect(closed.endedAt).toEqual(at(30));
    expect((await incidents())[0].closedAt).not.toBeNull();
  });

  it("idling (mode 3, 0 A) is quiet until 30 min, then it's a stop", async () => {
    await chargeNowRow();
    const idle = state({ operationMode: ChargerOperationMode.Charging });
    await sync(idle, at(30));
    await sync(idle, at(33));
    expect(pushes).toHaveLength(0);
    await sync(idle, at(60));
    expect(pushes.map((p) => p.title)).toEqual(["Bilen sluttet å lade"]);
  });
});

describe("syncChargerIncident: faults", () => {
  async function stuckPlan() {
    const [plan] = await db
      .insert(chargeSchedules)
      .values({
        chargerId: charger.id,
        chargerName: charger.name,
        targetEnergyKwh: "12",
        readyBy: at(600),
        status: "pending",
        lastError: START_FAILED_REASON,
      })
      .returning();
    for (const minutes of [0, 1, 2]) {
      await db.insert(scheduleActions).values({ scheduleId: plan.id, chargerId: charger.id, action: "resume", commandId: 507, createdAt: at(minutes) });
    }
    return plan;
  }

  it("start failed (D64): fault push with the time, activity line with the tries", async () => {
    await stuckPlan();
    await sync(state({ finalStopActive: true }), at(3));
    const [incident] = await incidents();
    expect(incident.kind).toBe("start_failed");
    expect(incident.detail).toMatchObject({ count: 3, from: "20:00", to: "20:02" });
    expect(pushes[0]).toMatchObject({ title: "Ladingen stoppet", body: expect.stringContaining("kl. 20:03") });
    expect(await activity()).toEqual(["start_failed"]);
  });

  it("offline while charging is wanted: shown after 10 min; 'Laderen er tilbake' when it answers again", async () => {
    await chargeNowRow();
    const offline = state({ isOnline: false });
    await sync(offline, at(30));
    await sync(offline, at(39));
    expect(pushes).toHaveLength(0);
    await sync(offline, at(40));
    expect(pushes.map((p) => p.title)).toEqual(["Laderen svarer ikke"]);
    await sync(drawing(), at(45));
    expect(await activity()).toEqual(["charger_offline", "charger_back"]);
  });

  it("the loop guard: 'locked' outranks the car, and its push replaces the old one", async () => {
    await chargeNowRow();
    await sync(state(), at(30), true);
    const [incident] = await incidents();
    expect(incident).toMatchObject({ kind: "locked", subject: "charger" });
    expect(pushes.map((p) => p.title)).toEqual(["Laderen stoppet for mange ganger"]);
    // The guard logs its own line (automation_paused) in the tick.
    expect(await activity()).toEqual([]);
  });

  it("a plan's car incident that closes and reopens (Smart blocks) pushes once", async () => {
    const [plan] = await db
      .insert(chargeSchedules)
      .values({ chargerId: charger.id, chargerName: charger.name, targetEnergyKwh: "12", readyBy: at(600), status: "active", lastCommand: "resume" })
      .returning();
    await sync(state(), at(30));
    await db.update(chargeSchedules).set({ lastCommand: "pause" }).where(eq(chargeSchedules.id, plan.id));
    await sync(state(), at(31));
    await db.update(chargeSchedules).set({ lastCommand: "resume" }).where(eq(chargeSchedules.id, plan.id));
    await sync(state(), at(60));
    expect((await incidents()).filter((i) => i.closedAt == null)).toHaveLength(1);
    expect(pushes.map((p) => p.title)).toEqual(["Bilen sluttet å lade"]);
  });

  it("an older plan's target doesn't make a Lad nå 'full'; one in this plug-in does", async () => {
    await db.insert(chargeSchedules).values({
      chargerId: charger.id, chargerName: charger.name, targetEnergyKwh: "5", readyBy: at(-600),
      status: "completed", targetPercent: 45, zaptecSessionId: "z-old", endedAt: at(-500),
    });
    await chargeNowRow();
    await sync(state(), at(30));
    expect(pushes[0].title).toBe("Bilen sluttet å lade");
  });

  it("a guest window: the guest's car, nothing of ours is wanted", async () => {
    await db.insert(chargeSchedules).values({
      chargerId: charger.id, chargerName: charger.name, targetEnergyKwh: "12", readyBy: at(600), status: "active", lastCommand: "resume",
    });
    await db.insert(manualChargeSessions).values({ chargerId: charger.id, kind: "guest", startedAt: t0 });
    await sync(state(), at(30));
    expect(await incidents()).toHaveLength(0);
    expect(pushes).toHaveLength(0);
  });

  it("nothing asked for: no incident, and an open one closes", async () => {
    await sync(state(), at(30));
    expect(await incidents()).toHaveLength(0);
  });
});
