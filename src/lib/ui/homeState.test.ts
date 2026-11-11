import { describe, expect, it } from "vitest";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import type { ChargerState } from "@/lib/zaptec/types";
import { HOME_STATES, homeState, type HomeStateInput } from "./homeState";

function charger(overrides: Partial<ChargerState> = {}): ChargerState {
  return {
    chargerId: "c1",
    isOnline: true,
    operationMode: ChargerOperationMode.ConnectedRequesting,
    finalStopActive: null,
    chargeCurrentSetAmps: null,
    instantPowerWatts: null,
    sessionEnergyKwh: null,
    observedAt: null,
    sessionId: "session-now",
    chargeDurationSeconds: null,
    scheduledChargingStartAt: null,
    lastCompletedSession: null,
    maxPowerKw: 7.4,
    installationRequiresAuth: false,
    ...overrides,
  };
}

const disconnected = { operationMode: ChargerOperationMode.Disconnected, sessionId: null };
const charging = { operationMode: ChargerOperationMode.Charging, instantPowerWatts: 7100 };

function input(overrides: Partial<HomeStateInput> = {}): HomeStateInput {
  return { state: charger(), schedule: null, openSession: null, lastCompletedPlanSessionId: null, ...overrides };
}

describe("homeState", () => {
  it("noControl: authentication required and no session to manage", () => {
    expect(homeState(input({ state: charger({ installationRequiresAuth: true }) }))).toBe("noControl");
  });

  it("noControl wins over a plan or a manual session", () => {
    expect(
      homeState(
        input({
          state: charger({ installationRequiresAuth: true }),
          schedule: { status: "pending" },
          openSession: { kind: "manual" },
        }),
      ),
    ).toBe("noControl");
  });

  it("keeps control while auth is required but a session is already charging", () => {
    expect(
      homeState(input({ state: charger({ installationRequiresAuth: true, ...charging }), openSession: { kind: "manual" } })),
    ).toBe("chargingManual");
  });

  it("noCar: disconnected, no plan", () => {
    expect(homeState(input({ state: charger(disconnected) }))).toBe("noCar");
  });

  it("planWaiting: disconnected with a pending plan", () => {
    expect(homeState(input({ state: charger(disconnected), schedule: { status: "pending" } }))).toBe("planWaiting");
  });

  it("planWaiting: unplugged in the middle of an active plan", () => {
    expect(homeState(input({ state: charger(disconnected), schedule: { status: "active" } }))).toBe("planWaiting");
  });

  it("connected: plugged in, idle, no plan", () => {
    expect(homeState(input())).toBe("connected");
  });

  it("connected: a free-charging session that started on plug-in without a plan", () => {
    expect(homeState(input({ state: charger(charging) }))).toBe("connected");
  });

  it("planned: connected with a pending plan", () => {
    expect(homeState(input({ schedule: { status: "pending" } }))).toBe("planned");
  });

  it("planned: an active plan the scheduler has paused", () => {
    expect(
      homeState(
        input({
          state: charger({ operationMode: ChargerOperationMode.StoppedOrIdle, finalStopActive: true }),
          schedule: { status: "active" },
        }),
      ),
    ).toBe("planned");
  });

  it("chargingPlan: active plan, charging", () => {
    expect(homeState(input({ state: charger(charging), schedule: { status: "active" } }))).toBe("chargingPlan");
  });

  it("chargingManual: a Lad nå session", () => {
    expect(homeState(input({ state: charger(charging), openSession: { kind: "manual" } }))).toBe("chargingManual");
  });

  it("preheating: a Forvarm session, charging or not", () => {
    expect(homeState(input({ state: charger(charging), openSession: { kind: "preheat" } }))).toBe("preheating");
    expect(homeState(input({ openSession: { kind: "preheat" } }))).toBe("preheating");
  });

  it("a manual session left open after unplugging doesn't count", () => {
    expect(homeState(input({ state: charger(disconnected), openSession: { kind: "manual" } }))).toBe("noCar");
  });

  it("ready: the plan that just completed was on this same plug-in", () => {
    expect(homeState(input({ lastCompletedPlanSessionId: "session-now" }))).toBe("ready");
  });

  it("not ready when the completed plan was an earlier plug-in", () => {
    expect(homeState(input({ lastCompletedPlanSessionId: "session-before" }))).toBe("connected");
  });

  it("ignores completed or cancelled schedules passed as the open plan", () => {
    expect(homeState(input({ schedule: { status: "completed" } }))).toBe("connected");
    expect(homeState(input({ state: charger(disconnected), schedule: { status: "cancelled" } }))).toBe("noCar");
  });

  it("covers every state in the table", () => {
    const reached = new Set([
      homeState(input({ state: charger({ installationRequiresAuth: true }) })),
      homeState(input({ state: charger(disconnected) })),
      homeState(input({ state: charger(disconnected), schedule: { status: "pending" } })),
      homeState(input()),
      homeState(input({ schedule: { status: "pending" } })),
      homeState(input({ state: charger(charging), schedule: { status: "active" } })),
      homeState(input({ state: charger(charging), openSession: { kind: "manual" } })),
      homeState(input({ openSession: { kind: "preheat" } })),
      homeState(input({ lastCompletedPlanSessionId: "session-now" })),
      homeState(input({ openSession: { kind: "guest" } })),
      homeState(input({ schedule: { status: "pending", source: "smart" } })),
      homeState(input({ state: charger(charging), schedule: { status: "active", source: "smart" } })),
    ]);
    expect([...reached].sort()).toEqual([...HOME_STATES].sort());
  });

  it("guest window wins while open, connected or not", () => {
    expect(homeState(input({ state: charger({ operationMode: ChargerOperationMode.Disconnected }), openSession: { kind: "guest" } }))).toBe("guest");
    expect(homeState(input({ openSession: { kind: "guest" } }))).toBe("guest");
  });

  it("an automatic session reads like Lad nå", () => {
    expect(homeState(input({ openSession: { kind: "automatic" } }))).toBe("chargingManual");
  });

  it("Smart lading: waiting for its block, charging in it, gone when unplugged", () => {
    expect(homeState(input({ schedule: { status: "pending", source: "smart" } }))).toBe("smartWaiting");
    // paused between blocks still reads as waiting
    expect(homeState(input({ schedule: { status: "active", source: "smart" } }))).toBe("smartWaiting");
    expect(homeState(input({ state: charger(charging), schedule: { status: "active", source: "smart" } }))).toBe("smartCharging");
    expect(homeState(input({ state: charger(disconnected), schedule: { status: "pending", source: "smart" } }))).toBe("noCar");
  });
});
