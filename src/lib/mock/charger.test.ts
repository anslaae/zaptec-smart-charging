import { describe, expect, it } from "vitest";
import { ChargerOperationMode, ZaptecCommand } from "@/lib/zaptec/constants";
import { ChargerSim } from "./charger";

const t0 = new Date("2026-11-10T20:00:00Z");
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

describe("ChargerSim", () => {
  it("free charging: plugging in starts charging on its own", () => {
    const sim = new ChargerSim(t0);
    sim.plugIn(t0);
    expect(sim.mode).toBe(ChargerOperationMode.Charging);
    expect(sim.sessionId).not.toBeNull();
  });

  it("auth required: plugging in waits, and ResumeCharging can't authorise it", () => {
    const sim = new ChargerSim(t0, { requiresAuth: true });
    sim.plugIn(t0);
    expect(sim.mode).toBe(ChargerOperationMode.ConnectedRequesting);
    const result = sim.command(ZaptecCommand.ResumeCharging, t0);
    expect(result.accepted).toBe(true);
    expect(sim.mode).toBe(ChargerOperationMode.ConnectedRequesting);
    sim.authorise(t0);
    expect(sim.mode).toBe(ChargerOperationMode.Charging);
  });

  it("StopChargingFinal latches until ResumeCharging", () => {
    const sim = new ChargerSim(t0);
    sim.plugIn(t0);
    sim.command(ZaptecCommand.StopChargingFinal, t0);
    expect(sim.mode).toBe(ChargerOperationMode.StoppedOrIdle);
    expect(sim.finalStopActive).toBe(true);
    sim.command(ZaptecCommand.ResumeCharging, t0);
    expect(sim.mode).toBe(ChargerOperationMode.Charging);
    expect(sim.finalStopActive).toBe(false);
  });

  it("accrues energy and battery while charging, scaled by speed", () => {
    const sim = new ChargerSim(t0, { powerKw: 6, speed: 60, capacityKwh: 40 }, 50);
    sim.plugIn(t0);
    const state = sim.toChargerState("c", at(1)); // 1 real minute x60 = 1 hour at 6 kW
    expect(state.sessionEnergyKwh).toBeCloseTo(6, 1);
    expect(sim.batteryPercent).toBeCloseTo(65, 1);
    expect(state.instantPowerWatts).toBe(6000);
  });

  it("the car stops drawing at 100 %", () => {
    const sim = new ChargerSim(t0, { powerKw: 10, speed: 3600, capacityKwh: 40 }, 90);
    sim.plugIn(t0);
    sim.advance(at(1)); // far more than the 4 kWh of room
    expect(sim.batteryPercent).toBe(100);
    expect(sim.sessionEnergyKwh).toBeCloseTo(4, 5);
    expect(sim.mode).toBe(ChargerOperationMode.StoppedOrIdle);
    expect(sim.finalStopActive).toBe(false);
  });

  it("unplugging closes the session into lastCompletedSession and history", () => {
    const sim = new ChargerSim(t0, { powerKw: 6, speed: 60 });
    sim.plugIn(t0);
    sim.unplug(at(1));
    expect(sim.mode).toBe(ChargerOperationMode.Disconnected);
    expect(sim.sessionId).toBeNull();
    expect(sim.lastCompletedSession?.energyKwh).toBeCloseTo(6, 1);
    expect(sim.history).toHaveLength(1);
  });

  it("commands fail while offline and are harmless without a car", () => {
    const sim = new ChargerSim(t0);
    expect(sim.command(ZaptecCommand.ResumeCharging, t0).note).toMatch(/nothing to resume/);
    sim.settings.online = false;
    expect(sim.command(ZaptecCommand.ResumeCharging, t0).accepted).toBe(false);
  });

  it("reportBattery updates the Smartcar reading to the current battery", () => {
    const sim = new ChargerSim(t0, { powerKw: 6, speed: 60, capacityKwh: 40 }, 50);
    sim.plugIn(t0);
    sim.reportBattery(at(1));
    expect(sim.reading?.percent).toBe(65);
    expect(sim.reading?.at).toEqual(at(1));
  });
});
