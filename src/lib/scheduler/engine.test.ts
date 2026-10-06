import { describe, expect, it } from "vitest";
import { decideNextAction, type ScheduleInput } from "./engine";
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

  it("reports no car connected instead of silently doing nothing", () => {
    const state = baseState({ operationMode: ChargerOperationMode.Disconnected, finalStopActive: null });
    const decision = decideNextAction(schedule, state, new Date("2026-01-01T06:59:00Z"));
    expect(decision).toEqual({
      action: "none",
      reason: "Needs to charge but no car is connected",
    });
  });

  it("starts (not resumes) a charger that's connected but was never stopped by us", () => {
    // ResumeCharging only undoes a previous StopChargingFinal and fails
    // against a charger that's simply plugged in and idle -- confirmed via
    // a live 500 error ("Charging is not Paused nor Scheduled").
    const state = baseState({
      operationMode: ChargerOperationMode.ConnectedRequesting,
      finalStopActive: null,
    });
    const decision = decideNextAction(schedule, state, new Date("2026-01-01T06:59:00Z"));
    expect(decision).toEqual({ action: "start" });
  });
});
