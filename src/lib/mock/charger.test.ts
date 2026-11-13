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

describe("ChargerSim: CompletedSession, command lag and warnings (D71-D73)", () => {
  it("reports the ended session with its id, exact energy and hourly meter readings", () => {
    const sim = new ChargerSim(at(-15), { powerKw: 6 });
    sim.plugIn(at(-15)); // 19:45 UTC
    const sessionId = sim.sessionId;
    sim.advance(at(30)); // passes 20:00
    sim.unplug(at(30));
    const done = sim.lastCompletedSession!;
    expect(done.sessionId).toBe(sessionId);
    expect(done.energyKwh).toBeCloseTo(4.5, 2);
    const readings = done.meterReadings!;
    expect(readings.map((r) => r.at)).toEqual([at(-15).toISOString(), at(0).toISOString(), at(30).toISOString()]);
    expect(readings[2].kwh - readings[0].kwh).toBeCloseTo(4.5, 2);
    expect(readings[1].kwh - readings[0].kwh).toBeCloseTo(1.5, 2);
  });

  it("with a command lag, the state shows the command only after the lag", () => {
    const sim = new ChargerSim(t0, { commandLagSeconds: 8 });
    sim.plugIn(t0);
    sim.command(ZaptecCommand.StopChargingFinal, t0);
    expect(sim.toChargerState("c", new Date(t0.getTime() + 5_000)).operationMode).toBe(ChargerOperationMode.Charging);
    expect(sim.toChargerState("c", new Date(t0.getTime() + 9_000)).operationMode).toBe(ChargerOperationMode.StoppedOrIdle);
    expect(sim.finalStopActive).toBe(true);
  });

  it("reports the warnings bitmask in health and raw observation 804", () => {
    const sim = new ChargerSim(t0, { warnings: 16 });
    const state = sim.toChargerState("c", t0);
    expect(state.health?.warnings).toBe(16);
    expect(state.rawObservations?.["804"]).toBe("16");
  });
});
