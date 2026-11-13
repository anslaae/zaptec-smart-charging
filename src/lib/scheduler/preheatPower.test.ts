import { describe, expect, it } from "vitest";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import { isDrawingPower, preheatPowerCheck } from "./preheatPower";

const now = new Date("2026-11-13T08:40:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);
const drawing = { operationMode: ChargerOperationMode.Charging, instantPowerWatts: 3000 };
const finished = { operationMode: ChargerOperationMode.StoppedOrIdle, instantPowerWatts: 0 };
const idleCharging = { operationMode: ChargerOperationMode.Charging, instantPowerWatts: 0 };

describe("preheatPowerCheck (D68)", () => {
  it("mode 5 during Forvarm: on battery, and one push", () => {
    expect(preheatPowerCheck({ state: finished, lostAt: null, notifiedAt: null, startedAt: ago(9), now })).toEqual({
      lostAt: now,
      onBattery: true,
      notify: true,
    });
  });

  it("no second push once one went out", () => {
    const r = preheatPowerCheck({ state: finished, lostAt: ago(1), notifiedAt: ago(1), startedAt: ago(9), now });
    expect(r).toEqual({ lostAt: ago(1), onBattery: true, notify: false });
  });

  it("drawing again clears it", () => {
    expect(preheatPowerCheck({ state: drawing, lostAt: ago(3), notifiedAt: ago(1), startedAt: ago(9), now })).toEqual({
      lostAt: null,
      onBattery: false,
      notify: false,
    });
  });

  it("no power while 'charging': only after 2 min", () => {
    expect(preheatPowerCheck({ state: idleCharging, lostAt: null, notifiedAt: null, startedAt: ago(9), now }).onBattery).toBe(false);
    expect(preheatPowerCheck({ state: idleCharging, lostAt: ago(1), notifiedAt: null, startedAt: ago(9), now }).onBattery).toBe(false);
    expect(preheatPowerCheck({ state: idleCharging, lostAt: ago(2), notifiedAt: null, startedAt: ago(9), now }).onBattery).toBe(true);
  });

  it("not in the first 2 min of a Forvarm (the car is still picking up the start)", () => {
    const r = preheatPowerCheck({ state: finished, lostAt: null, notifiedAt: null, startedAt: ago(1), now });
    expect(r.onBattery).toBe(false);
    expect(r.lostAt).toEqual(now);
  });

  it("unplugged: nothing (the session ends)", () => {
    const state = { operationMode: ChargerOperationMode.Disconnected, instantPowerWatts: 0 };
    expect(preheatPowerCheck({ state, lostAt: ago(5), notifiedAt: null, startedAt: ago(9), now }).onBattery).toBe(false);
  });

  it("standby noise below 0.1 kW isn't drawing", () => {
    expect(isDrawingPower({ operationMode: ChargerOperationMode.Charging, instantPowerWatts: 50 })).toBe(false);
    expect(isDrawingPower(drawing)).toBe(true);
  });

  it("phase currents drive it when the mode stays at 3 (D69)", () => {
    // Every phase idle (the 13 Nov readings) while the charger still says "charging" with stale power
    const idlePhases = { operationMode: ChargerOperationMode.Charging, instantPowerWatts: 3000, phaseCurrentsAmps: [0.048, 0.025, 0.027] };
    expect(isDrawingPower(idlePhases)).toBe(false);
    expect(isDrawingPower({ ...idlePhases, phaseCurrentsAmps: [13.1, 0.03, null] })).toBe(true);
    expect(preheatPowerCheck({ state: idlePhases, lostAt: null, notifiedAt: null, startedAt: ago(9), now }).onBattery).toBe(false);
    const after2 = preheatPowerCheck({ state: idlePhases, lostAt: ago(2), notifiedAt: null, startedAt: ago(9), now });
    expect(after2).toEqual({ lostAt: ago(2), onBattery: true, notify: true });
  });
});
