import { describe, expect, it } from "vitest";
import {
  decideNextAction,
  MAX_START_ATTEMPTS,
  planDeliveredNow,
  reconcileSessionEnergy,
  startAttemptsExhausted,
  type ScheduleInput,
} from "./engine";
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

// D64: the 13 Nov 2026 night. 17 kWh by 08:00 Oslo (07:00Z), learned rate
// 2.9 kW → latest start ≈ 00:53Z. Paused, the learned rate says "start";
// charging at a live 3.6 kW says "too early" -- the plan used to pause, then
// resume a minute later, about 20 times until Zaptec locked the car out.
describe("decideNextAction: a started plan keeps charging (D64)", () => {
  const night: ScheduleInput = { targetEnergyKwh: 17, readyBy: new Date("2026-11-13T07:00:00Z") };
  const learned = 2.9;
  const t = new Date("2026-11-13T00:54:00Z");
  const charging = baseState({ operationMode: ChargerOperationMode.Charging, finalStopActive: false, instantPowerWatts: 3600 });

  it("reproduces the edge: not started, the live rate would pause", () => {
    expect(decideNextAction(night, baseState(), t, learned).action).toBe("resume");
    expect(decideNextAction(night, charging, t, learned).action).toBe("pause");
  });

  it("once started, never pauses because the estimate moved", () => {
    const started = { ...night, started: true };
    expect(decideNextAction(started, charging, t, learned)).toEqual({ action: "none", reason: "Already charging" });
    // still hours early by the live rate
    expect(decideNextAction(started, charging, new Date("2026-11-13T00:10:00Z"), learned).action).toBe("none");
  });

  it("a started plan that stopped drawing is resumed, not left waiting", () => {
    expect(decideNextAction({ ...night, started: true }, baseState(), new Date("2026-11-13T00:10:00Z"), learned).action).toBe(
      "resume",
    );
  });

  it("a plan that hasn't started still pauses a car that started too early", () => {
    expect(decideNextAction(night, charging, new Date("2026-11-12T20:00:00Z"), learned).action).toBe("pause");
  });

  it("still completes at the target", () => {
    const full = baseState({ operationMode: ChargerOperationMode.Charging, sessionEnergyKwh: 17 });
    expect(decideNextAction({ ...night, started: true }, full, t, learned).action).toBe("complete");
  });
});

describe("startAttemptsExhausted (D64)", () => {
  const now = new Date("2026-11-13T02:00:00Z");
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  it("allows starts until the cap is reached", () => {
    const attempts = Array.from({ length: MAX_START_ATTEMPTS - 1 }, (_, i) => minutesAgo(i + 1));
    expect(startAttemptsExhausted({ attemptTimes: attempts, lastPluggedInAt: minutesAgo(60), now })).toBe(false);
  });

  it("stops after the cap within the window", () => {
    const attempts = [minutesAgo(1), minutesAgo(2), minutesAgo(3)];
    expect(startAttemptsExhausted({ attemptTimes: attempts, lastPluggedInAt: minutesAgo(60), now })).toBe(true);
  });

  it("re-plugging the car resets the count", () => {
    const attempts = [minutesAgo(5), minutesAgo(6), minutesAgo(7)];
    expect(startAttemptsExhausted({ attemptTimes: attempts, lastPluggedInAt: minutesAgo(2), now })).toBe(false);
  });

  it("attempts older than the window don't count", () => {
    const attempts = [minutesAgo(20), minutesAgo(30), minutesAgo(40)];
    expect(startAttemptsExhausted({ attemptTimes: attempts, lastPluggedInAt: null, now })).toBe(false);
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

  it("keeps the tracker while no session is reported (unplugged or offline)", () => {
    const tracker = { zaptecSessionId: "session-a", priorSessionEnergyKwh: -4, lastObservedSessionEnergyKwh: 4 };
    const result = reconcileSessionEnergy(tracker, null, 0);
    expect(result.effectiveSessionEnergyKwh).toBe(0);
    expect(result.nextTracker).toEqual(tracker);
    // ...so a re-plug after that still counts from the baseline
    expect(reconcileSessionEnergy(result.nextTracker, "session-b", 1).effectiveSessionEnergyKwh).toBe(1);
  });

  it("ignores a lower reading for the same session", () => {
    const result = reconcileSessionEnergy(
      { zaptecSessionId: "session-a", priorSessionEnergyKwh: -4, lastObservedSessionEnergyKwh: 6 },
      "session-a",
      0,
    );
    expect(result.effectiveSessionEnergyKwh).toBe(2);
    expect(result.nextTracker.lastObservedSessionEnergyKwh).toBe(6);
  });
});

describe("planDeliveredNow", () => {
  it("is never negative right after a re-plug, before the tick reconciles", () => {
    const tracker = { zaptecSessionId: "session-a", priorSessionEnergyKwh: -4, lastObservedSessionEnergyKwh: 5 };
    expect(planDeliveredNow(tracker, { sessionId: "session-a", sessionEnergyKwh: 5 })).toBe(1);
    expect(planDeliveredNow(tracker, { sessionId: "session-b", sessionEnergyKwh: 0.5 })).toBe(1.5);
    expect(planDeliveredNow({ ...tracker, lastObservedSessionEnergyKwh: 4 }, { sessionId: "session-a", sessionEnergyKwh: 0 })).toBe(0);
  });

  it("uses the session counter for a plan that hasn't tracked anything yet", () => {
    expect(
      planDeliveredNow({ zaptecSessionId: null, priorSessionEnergyKwh: 0, lastObservedSessionEnergyKwh: 0 }, { sessionId: "x", sessionEnergyKwh: 2 }),
    ).toBe(2);
  });
});

describe("reconcileSessionEnergy with CompletedSession (D72)", () => {
  const tracker = { zaptecSessionId: "session-a", priorSessionEnergyKwh: 1, lastObservedSessionEnergyKwh: 4.2 };

  it("uses the ended session's exact energy when the car is re-plugged", () => {
    const result = reconcileSessionEnergy(tracker, "session-b", 0.3, { sessionId: "session-a", energyKwh: 4.9 });
    expect(result.effectiveSessionEnergyKwh).toBeCloseTo(1 + 4.9 + 0.3);
    expect(result.nextTracker.priorSessionEnergyKwh).toBeCloseTo(5.9);
  });

  it("uses it while unplugged too", () => {
    const result = reconcileSessionEnergy(tracker, null, 0, { sessionId: "session-a", energyKwh: 4.9 });
    expect(result.effectiveSessionEnergyKwh).toBeCloseTo(5.9);
    expect(result.nextTracker.lastObservedSessionEnergyKwh).toBe(4.9);
  });

  it("ignores a CompletedSession for another session (the previous plug-in)", () => {
    const result = reconcileSessionEnergy(tracker, "session-b", 0.3, { sessionId: "older", energyKwh: 30 });
    expect(result.effectiveSessionEnergyKwh).toBeCloseTo(1 + 4.2 + 0.3);
  });

  it("never lowers what was already seen", () => {
    const result = reconcileSessionEnergy(tracker, null, 0, { sessionId: "session-a", energyKwh: 3 });
    expect(result.effectiveSessionEnergyKwh).toBeCloseTo(5.2);
  });

  it("works without a session id in the observation (falls back to carry-forward)", () => {
    const result = reconcileSessionEnergy(tracker, "session-b", 0, { energyKwh: 9 });
    expect(result.effectiveSessionEnergyKwh).toBeCloseTo(5.2);
  });
});
