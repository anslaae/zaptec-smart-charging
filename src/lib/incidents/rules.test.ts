import { describe, expect, it } from "vitest";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import { currentIncident, incidentStatus, subjectKey, type Wanted } from "./rules";

const t0 = new Date("2026-11-13T20:00:00Z");
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

const drawing = {
  operationMode: ChargerOperationMode.Charging,
  instantPowerWatts: 7100,
  phaseCurrentsAmps: [10.3, 0.04, 0.03],
  isOnline: true,
  finalStopActive: false,
  health: { warnings: 0, notifications: 0, signalDbm: -71 },
};
const carStopped = { ...drawing, operationMode: ChargerOperationMode.StoppedOrIdle, instantPowerWatts: 0, phaseCurrentsAmps: [0.04, 0.03, 0.03] };
const idling = { ...drawing, instantPowerWatts: 0, phaseCurrentsAmps: [0.04, 0.03, 0.03] };
const unplugged = { ...carStopped, operationMode: ChargerOperationMode.Disconnected };

const chargeNow = (deliveredKwh: number, requestedAt = t0): Wanted => ({
  type: "session",
  id: "row-1",
  kind: "manual",
  requestedAt,
  deliveredKwh,
});
const plan = (overrides: Partial<Extract<Wanted, { type: "schedule" }>> = {}): Wanted => ({
  type: "schedule",
  id: "plan-1",
  requestedAt: t0,
  startFailed: false,
  ...overrides,
});

describe("currentIncident (D75)", () => {
  it("nothing while the car draws, or when nothing is asked for", () => {
    expect(currentIncident({ state: drawing, wanted: chargeNow(1), guardPaused: false })).toBeNull();
    expect(currentIncident({ state: carStopped, wanted: null, guardPaused: false })).toBeNull();
  });

  it("the car not drawing while charging is wanted", () => {
    expect(currentIncident({ state: carStopped, wanted: chargeNow(4), guardPaused: false })).toBe("car");
    expect(currentIncident({ state: idling, wanted: plan(), guardPaused: false })).toBe("car");
  });

  it("an unplug ends it (expected ending)", () => {
    expect(currentIncident({ state: unplugged, wanted: chargeNow(4), guardPaused: false })).toBeNull();
  });

  it("faults outrank the car: loop guard, Zaptec's lock, start failed, offline, a warning", () => {
    expect(currentIncident({ state: carStopped, wanted: chargeNow(4), guardPaused: true })).toBe("locked");
    expect(currentIncident({ state: carStopped, wanted: null, guardPaused: true })).toBe("locked");
    expect(
      currentIncident({ state: { ...carStopped, health: { warnings: 16, notifications: 0, signalDbm: null } }, wanted: plan(), guardPaused: false }),
    ).toBe("locked");
    expect(
      currentIncident({ state: { ...carStopped, finalStopActive: true }, wanted: plan({ startFailed: true }), guardPaused: false }),
    ).toBe("start_failed");
    expect(
      currentIncident({ state: { ...carStopped, operationMode: ChargerOperationMode.ConnectedRequesting }, wanted: plan({ startFailed: true }), guardPaused: false }),
    ).toBe("start_failed");
    expect(currentIncident({ state: { ...carStopped, isOnline: false }, wanted: chargeNow(4), guardPaused: false })).toBe("offline");
    expect(
      currentIncident({ state: { ...carStopped, health: { warnings: 4096, notifications: 0, signalDbm: null } }, wanted: chargeNow(4), guardPaused: false }),
    ).toBe("charger_warning");
  });

  it("a plan's starts that the car ignored (mode 5, nothing latched) are the car declining, not a fault", () => {
    expect(currentIncident({ state: carStopped, wanted: plan({ startFailed: true }), guardPaused: false })).toBe("car");
  });

  it("a warning while the car still draws isn't a stop", () => {
    expect(
      currentIncident({ state: { ...drawing, health: { warnings: 2, notifications: 0, signalDbm: null } }, wanted: chargeNow(4), guardPaused: false }),
    ).toBeNull();
  });

  it("subject keys", () => {
    expect(subjectKey(chargeNow(1))).toBe("session:row-1");
    expect(subjectKey(plan())).toBe("schedule:plan-1");
    expect(subjectKey(null)).toBe("charger");
  });
});

describe("incidentStatus: Lad nå cases (HANDOFF §6e)", () => {
  const status = (input: Partial<Parameters<typeof incidentStatus>[0]>) =>
    incidentStatus({
      kind: "car",
      since: at(10),
      state: carStopped,
      wanted: chargeNow(6),
      batteryPercent: 70,
      targetPercent: null,
      now: at(10),
      ...input,
    });

  it("case 1 probably full: battery >= 95\u202F% or >= the last plan's target, pushes, ends itself after 30 min", () => {
    const full = status({ batteryPercent: 96 });
    expect(full).toMatchObject({ visible: true, carCase: "full", pushes: true });
    expect(full.autoEndAt).toEqual(at(40));
    expect(status({ batteryPercent: 81, targetPercent: 80 }).carCase).toBe("full");
  });

  it("case 2 stopped below full: mode 5 at once", () => {
    expect(status({})).toMatchObject({ visible: true, carCase: "stopped", pushes: true, autoEndAt: null });
  });

  it("case 3 idling (mode 3, 0 A): after 2 min, calm and no push; after 30 min it reads as case 2", () => {
    expect(status({ state: idling, now: at(11) }).visible).toBe(false);
    expect(status({ state: idling, now: at(12) })).toMatchObject({ visible: true, carCase: "idle", pushes: false });
    expect(status({ state: idling, now: at(40) })).toMatchObject({ carCase: "stopped", pushes: true });
  });

  it("case 4 never started: 0 kWh 5 min after the tap", () => {
    expect(status({ wanted: chargeNow(0), since: at(0), now: at(4) }).visible).toBe(false);
    expect(status({ wanted: chargeNow(0), since: at(0), now: at(5) })).toMatchObject({ carCase: "never", pushes: true });
  });

  it("the first 2 min after the tap don't count (the car picks up the start)", () => {
    expect(status({ wanted: chargeNow(1, at(9)), now: at(10) }).visible).toBe(false);
  });

  it("an automatic session reads like a plan; a full one is simply done", () => {
    const automatic: Wanted = { ...(chargeNow(6) as Extract<Wanted, { type: "session" }>), kind: "automatic" };
    expect(status({ wanted: automatic }).carCase).toBe("declinedPlan");
    expect(status({ wanted: automatic, batteryPercent: 97 }).visible).toBe(false);
  });
});

describe("incidentStatus: plans, Smart lading and faults", () => {
  const base = {
    kind: "car" as const,
    since: at(10),
    state: carStopped,
    wanted: plan(),
    batteryPercent: 60,
    targetPercent: 80,
    now: at(10),
  };

  it("a plan whose car stopped before the target", () => {
    expect(incidentStatus(base)).toMatchObject({ visible: true, carCase: "declinedPlan", pushes: true });
  });

  it("not while the charger is still latched by our stop (that's D64's start failed), nor when full", () => {
    expect(incidentStatus({ ...base, state: { ...carStopped, finalStopActive: true } }).visible).toBe(false);
    expect(incidentStatus({ ...base, batteryPercent: 96 }).visible).toBe(false);
  });

  it("offline shows after 10 min; the other faults at once", () => {
    expect(incidentStatus({ ...base, kind: "offline", now: at(19) }).visible).toBe(false);
    expect(incidentStatus({ ...base, kind: "offline", now: at(20) })).toMatchObject({ visible: true, pushes: true });
    for (const kind of ["start_failed", "locked", "charger_warning"] as const) {
      expect(incidentStatus({ ...base, kind })).toMatchObject({ visible: true, pushes: true, carCase: null });
    }
  });
});
