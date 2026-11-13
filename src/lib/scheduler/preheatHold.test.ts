import { describe, expect, it } from "vitest";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import type { ChargerState } from "@/lib/zaptec/types";
import { decideNextAction } from "./engine";
import {
  PREHEAT_HOLD_REASON,
  applyPreheatHold,
  preheatHoldActive,
  preheatHoldEnd,
  preheatHoldEstimate,
} from "./preheatHold";

const at = (iso: string) => new Date(iso);
const now = at("2026-11-13T05:00:00Z"); // 06:00 Oslo
const charging = { operationMode: ChargerOperationMode.Charging, sessionId: "s1" };

describe("preheatHoldEnd (D67)", () => {
  it("is 60 min from the tap, or readyBy if that's sooner", () => {
    expect(preheatHoldEnd(now, at("2026-11-13T09:00:00Z"))).toEqual(at("2026-11-13T06:00:00Z"));
    expect(preheatHoldEnd(now, at("2026-11-13T05:30:00Z"))).toEqual(at("2026-11-13T05:30:00Z"));
  });
  it("is null once readyBy has passed", () => {
    expect(preheatHoldEnd(now, at("2026-11-13T04:59:00Z"))).toBeNull();
  });
});

describe("preheatHoldActive (D67)", () => {
  const holdUntil = at("2026-11-13T06:00:00Z");
  it("counts until it ends, on the same plug-in", () => {
    expect(preheatHoldActive({ holdUntil, scheduleSessionId: "s1", state: charging, now })).toBe(true);
    expect(preheatHoldActive({ holdUntil, scheduleSessionId: null, state: charging, now })).toBe(true);
    expect(preheatHoldActive({ holdUntil, scheduleSessionId: "s1", state: charging, now: holdUntil })).toBe(false);
    expect(preheatHoldActive({ holdUntil: null, scheduleSessionId: "s1", state: charging, now })).toBe(false);
  });
  it("ends on unplug and on a new session (a re-plug between ticks)", () => {
    const unplugged = { operationMode: ChargerOperationMode.Disconnected, sessionId: null };
    expect(preheatHoldActive({ holdUntil, scheduleSessionId: "s1", state: unplugged, now })).toBe(false);
    expect(preheatHoldActive({ holdUntil, scheduleSessionId: "s1", state: { ...charging, sessionId: "s2" }, now })).toBe(false);
  });
});

describe("the scheduler during a hold (D67)", () => {
  const state = (kwh: number): ChargerState =>
    ({
      chargerId: "c",
      isOnline: true,
      operationMode: ChargerOperationMode.Charging,
      finalStopActive: false,
      instantPowerWatts: 7000,
      sessionEnergyKwh: kwh,
      sessionId: "s1",
      maxPowerKw: 7.4,
    }) as ChargerState;
  const holdUntil = at("2026-11-13T06:00:00Z");
  const decide = (plan: { targetEnergyKwh: number; readyBy: Date; started: boolean }, kwh: number, t: Date) =>
    applyPreheatHold(
      decideNextAction(plan, state(kwh), t, 7),
      preheatHoldActive({ holdUntil, scheduleSessionId: "s1", state: state(kwh), now: t }),
    );

  it("doesn't stop at the target during the hold, and does after it", () => {
    const plan = { targetEnergyKwh: 10, readyBy: at("2026-11-13T06:30:00Z"), started: true };
    expect(decideNextAction(plan, state(10.5), now, 7)).toEqual({ action: "complete" });
    expect(decide(plan, 10.5, now)).toEqual({ action: "none", reason: PREHEAT_HOLD_REASON });
    expect(decide(plan, 12, at("2026-11-13T06:00:00Z"))).toEqual({ action: "complete" });
  });

  it("doesn't pause a plan that's early during the hold, and does after it", () => {
    // 5 kWh by 15:00 Oslo: far too early to charge at 06:00 -> pause
    const plan = { targetEnergyKwh: 5, readyBy: at("2026-11-13T14:00:00Z"), started: false };
    expect(decideNextAction(plan, state(0), now, 7).action).toBe("pause");
    expect(decide(plan, 0, now)).toEqual({ action: "none", reason: PREHEAT_HOLD_REASON });
    expect(decide(plan, 1, at("2026-11-13T06:01:00Z")).action).toBe("pause");
  });

  it("leaves a start (resume) alone", () => {
    expect(applyPreheatHold({ action: "resume" }, true)).toEqual({ action: "resume" });
  });
});

describe("preheatHoldEstimate (D67)", () => {
  const prices = { energyNokPerKwh: 1, gridDayNokPerKwh: 0.5, gridNightNokPerKwh: 0.25 };
  const until = at("2026-11-13T05:30:00Z"); // 30 min, 06:00-06:30 Oslo weekday = day rate
  it("is charge power x hold length, priced for those hours", () => {
    expect(preheatHoldEstimate({ now, until, powerKw: 6, prices, roomKwh: null })).toEqual({ kwh: 3, nok: 5 });
  });
  it("is capped by the room left in the battery", () => {
    expect(preheatHoldEstimate({ now, until, powerKw: 6, prices, roomKwh: 1.2 })).toEqual({ kwh: 1.2, nok: 2 });
  });
  it("has no kr when no price is set", () => {
    const none = { energyNokPerKwh: 0, gridDayNokPerKwh: null, gridNightNokPerKwh: null };
    expect(preheatHoldEstimate({ now, until, powerKw: 6, prices: none, roomKwh: null })).toEqual({ kwh: 3, nok: null });
  });
});
