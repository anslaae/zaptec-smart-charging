import { describe, expect, it } from "vitest";
import { decideNextAction, reconcileSessionEnergy, type ScheduleInput } from "./engine";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import type { ChargerState } from "@/lib/zaptec/types";

function baseState(overrides: Partial<ChargerState> = {}): ChargerState {
  return {
    chargerId: "charger-1",
    isOnline: true,
    operationMode: ChargerOperationMode.StoppedOrIdle,
    finalStopActive: true,
    chargeCurrentSetAmps: 0,
    instantPowerWatts: null,
    sessionEnergyKwh: 0,
    observedAt: new Date().toISOString(),
    sessionId: null,
    chargeDurationSeconds: null,
    scheduledChargingStartAt: null,
    lastCompletedSession: null,
    maxPowerKw: null,
    installationRequiresAuth: false,
    ...overrides,
  };
}

const schedule: ScheduleInput = {
  targetEnergyKwh: 20,
  readyBy: new Date("2026-01-01T07:00:00Z"),
};

describe("decideNextAction", () => {
  it("completes once the target energy has been delivered", () => {
    const state = baseState({ sessionEnergyKwh: 20 });
    const decision = decideNextAction(schedule, state, new Date("2026-01-01T02:00:00Z"));
    expect(decision.action).toBe("complete");
  });

  it("does nothing when the charger is offline", () => {
    const state = baseState({ isOnline: false });
    const decision = decideNextAction(schedule, state, new Date("2026-01-01T02:00:00Z"));
    expect(decision).toEqual({ action: "none", reason: "Charger is offline" });
  });

  it("waits when there is slack time before the deadline", () => {
    // 20kWh at the 7kW default fallback needs ~2h51m; far from a 07:00 deadline.
    const state = baseState();
    const decision = decideNextAction(schedule, state, new Date("2026-01-01T01:00:00Z"));
    expect(decision.action).toBe("none");
  });

  it("resumes when it is time to start charging to hit the deadline", () => {
    const state = baseState(); // paused and resumable
    // 20kWh / 7kW ≈ 2h51m + 15min margin ⇒ should start by ~03:54.
    const decision = decideNextAction(schedule, state, new Date("2026-01-01T04:00:00Z"));
    expect(decision.action).toBe("resume");
  });

  it("pauses active charging when running far ahead of schedule", () => {
    const state = baseState({ operationMode: ChargerOperationMode.Charging });
    const decision = decideNextAction(schedule, state, new Date("2026-01-01T00:00:00Z"));
    expect(decision.action).toBe("pause");
  });

  it("keeps charging past the deadline instead of leaving the car undercharged", () => {
    const state = baseState({ operationMode: ChargerOperationMode.Charging, sessionEnergyKwh: 5 });
    const decision = decideNextAction(schedule, state, new Date("2026-01-01T08:00:00Z"));
    expect(decision.action).toBe("none");
    expect(decision).toMatchObject({ reason: "Already charging" });
  });

  it("tries to resume past the deadline if not already charging", () => {
    const state = baseState({ sessionEnergyKwh: 5 });
    const decision = decideNextAction(schedule, state, new Date("2026-01-01T08:00:00Z"));
    expect(decision.action).toBe("resume");
  });

  it("reports no car connected as a problem, not silently doing nothing", () => {
    const state = baseState({ operationMode: ChargerOperationMode.Disconnected, finalStopActive: null });
    const decision = decideNextAction(schedule, state, new Date("2026-01-01T06:59:00Z"));
    expect(decision).toEqual({
      action: "none",
      reason: "Needs to charge but no car is connected",
      isProblem: true,
    });
  });

  it("still sends resume to a connected charger that was never stopped by us", () => {
    // There's no separate "start" command -- ResumeCharging is sent
    // regardless. If the charger was never paused, Zaptec rejects it with a
    // harmless 528 that sendChargerCommand() treats as success (confirmed
    // against evcc's production Zaptec driver, which does the same).
    const state = baseState({
      operationMode: ChargerOperationMode.ConnectedRequesting,
      finalStopActive: null,
    });
    const decision = decideNextAction(schedule, state, new Date("2026-01-01T06:59:00Z"));
    expect(decision).toEqual({ action: "resume" });
  });
});

describe("reconcileSessionEnergy", () => {
  it("passes through the live reading while the session hasn't changed", () => {
    const result = reconcileSessionEnergy(
      { zaptecSessionId: "session-a", priorSessionEnergyKwh: 0, lastObservedSessionEnergyKwh: 3 },
      "session-a",
      5,
    );
    expect(result.effectiveSessionEnergyKwh).toBe(5);
    expect(result.nextTracker).toEqual({
      zaptecSessionId: "session-a",
      priorSessionEnergyKwh: 0,
      lastObservedSessionEnergyKwh: 5,
    });
  });

  it("carries the last-seen reading forward when a new session starts (a disconnect/reconnect)", () => {
    // The car delivered 8 kWh on session-a, then got unplugged and replugged
    // -- session-b starts back at 0.5 kWh. The target comparison should see
    // 8.5 kWh delivered overall, not 0.5.
    const result = reconcileSessionEnergy(
      { zaptecSessionId: "session-a", priorSessionEnergyKwh: 0, lastObservedSessionEnergyKwh: 8 },
      "session-b",
      0.5,
    );
    expect(result.effectiveSessionEnergyKwh).toBe(8.5);
    expect(result.nextTracker).toEqual({
      zaptecSessionId: "session-b",
      priorSessionEnergyKwh: 8,
      lastObservedSessionEnergyKwh: 0.5,
    });
  });

  it("keeps accumulating correctly across a second reconnect", () => {
    const result = reconcileSessionEnergy(
      { zaptecSessionId: "session-b", priorSessionEnergyKwh: 8, lastObservedSessionEnergyKwh: 3 },
      "session-c",
      0,
    );
    expect(result.effectiveSessionEnergyKwh).toBe(11);
    expect(result.nextTracker.priorSessionEnergyKwh).toBe(11);
  });

  it("doesn't roll over before a session has ever been tracked", () => {
    const result = reconcileSessionEnergy(
      { zaptecSessionId: null, priorSessionEnergyKwh: 0, lastObservedSessionEnergyKwh: 0 },
      "session-a",
      1.5,
    );
    expect(result.effectiveSessionEnergyKwh).toBe(1.5);
    expect(result.nextTracker.zaptecSessionId).toBe("session-a");
  });
});
