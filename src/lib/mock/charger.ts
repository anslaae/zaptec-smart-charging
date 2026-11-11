import { ChargerOperationMode, ZaptecCommand } from "@/lib/zaptec/constants";
import type { ChargerState, ChargeHistoryEntry, LastCompletedSession } from "@/lib/zaptec/types";

// A simulated Zaptec charger + car for mock mode. Pure state + methods (no
// I/O) so it can be unit-tested; the mock store keeps one instance in memory.
// It mirrors the real behaviours HANDOVER.md documents:
// - free charging (auth off): plugging in auto-starts a session;
// - auth on: plugging in waits for an RFID/app authorisation, and
//   ResumeCharging can't authorise a fresh session (only undo a final stop);
// - StopChargingFinal latches (finalStopActive) until ResumeCharging;
// - the car stops drawing by itself when the battery is full.

export interface SimSettings {
  online: boolean;
  requiresAuth: boolean;
  /** What the car draws while charging. */
  powerKw: number;
  /** Simulation speed for energy: 60 = one real second delivers a minute's worth. */
  speed: number;
  capacityKwh: number;
  maxPowerKw: number;
}

export interface SimSnapshot extends SimSettings {
  carConnected: boolean;
  mode: number;
  finalStopActive: boolean;
  sessionId: string | null;
  sessionStartedAt: string | null;
  sessionEnergyKwh: number;
  chargingSeconds: number;
  batteryPercent: number;
  reading: { percent: number; at: string } | null;
  lastCompletedSession: LastCompletedSession | null;
}

export interface CommandResult {
  accepted: boolean;
  note: string;
}

let idCounter = 0;
function newSessionId(): string {
  idCounter += 1;
  const rand = Math.random().toString(16).slice(2, 10).padEnd(8, "0");
  return `00000000-0000-4000-9000-${rand}${String(idCounter).padStart(4, "0")}`;
}

export class ChargerSim {
  settings: SimSettings;
  carConnected = false;
  mode: number = ChargerOperationMode.Disconnected;
  finalStopActive = false;
  sessionId: string | null = null;
  sessionStartedAt: Date | null = null;
  sessionEnergyKwh = 0;
  chargingSeconds = 0;
  batteryPercent: number;
  /** The car's last report to Smartcar -- usually older than the real battery. */
  reading: { percent: number; at: Date } | null;
  lastCompletedSession: LastCompletedSession | null = null;
  history: ChargeHistoryEntry[] = [];
  private lastAdvancedAt: number;

  constructor(now: Date, settings?: Partial<SimSettings>, batteryPercent = 46) {
    this.settings = {
      online: true,
      requiresAuth: false,
      powerKw: 7.1,
      speed: 1,
      capacityKwh: 46,
      maxPowerKw: 11,
      ...settings,
    };
    this.batteryPercent = batteryPercent;
    this.reading = { percent: batteryPercent, at: new Date(now.getTime() - 40 * 60_000) };
    this.lastAdvancedAt = now.getTime();
  }

  get charging(): boolean {
    return this.mode === ChargerOperationMode.Charging;
  }

  /** Accrue energy for the time passed (times the speed setting). Call before every read or change. */
  advance(now: Date): void {
    const seconds = Math.max(0, (now.getTime() - this.lastAdvancedAt) / 1000) * this.settings.speed;
    this.lastAdvancedAt = now.getTime();
    if (!this.charging || seconds === 0) return;
    this.addEnergy(this.settings.powerKw * (seconds / 3600));
    this.chargingSeconds += seconds;
  }

  /** Delivers energy into the session and the battery; the car stops drawing at 100 %. */
  addEnergy(kwh: number): void {
    if (!this.carConnected || kwh <= 0) return;
    const room = ((100 - this.batteryPercent) / 100) * this.settings.capacityKwh;
    const delivered = Math.min(kwh, room);
    this.sessionEnergyKwh += delivered;
    this.batteryPercent = Math.min(100, this.batteryPercent + (delivered / this.settings.capacityKwh) * 100);
    if (this.batteryPercent >= 100 && this.charging) {
      // Car is full: it stops drawing, the session stays open (not a final stop).
      this.mode = ChargerOperationMode.StoppedOrIdle;
    }
  }

  plugIn(now: Date): void {
    this.advance(now);
    if (this.carConnected) return;
    this.carConnected = true;
    this.sessionId = newSessionId();
    this.sessionStartedAt = now;
    this.sessionEnergyKwh = 0;
    this.chargingSeconds = 0;
    this.finalStopActive = false;
    if (this.settings.requiresAuth) {
      this.mode = ChargerOperationMode.ConnectedRequesting;
    } else {
      // Free charging: the session starts on its own (the app's enforcement
      // stops it on the next tick if nothing authorises it).
      this.mode = this.batteryPercent >= 100 ? ChargerOperationMode.StoppedOrIdle : ChargerOperationMode.Charging;
    }
  }

  unplug(now: Date): void {
    this.advance(now);
    if (!this.carConnected) return;
    if (this.sessionId && this.sessionStartedAt) {
      const session: LastCompletedSession = {
        startedAt: this.sessionStartedAt.toISOString(),
        endedAt: now.toISOString(),
        energyKwh: Math.round(this.sessionEnergyKwh * 100) / 100,
      };
      this.lastCompletedSession = session;
      this.history.unshift({
        id: this.sessionId,
        chargerId: "",
        deviceName: "",
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        energyKwh: session.energyKwh,
        userFullName: null,
      });
    }
    this.carConnected = false;
    this.mode = ChargerOperationMode.Disconnected;
    this.finalStopActive = false;
    this.sessionId = null;
    this.sessionStartedAt = null;
    this.sessionEnergyKwh = 0;
    this.chargingSeconds = 0;
  }

  /** Someone taps an RFID tag / the Zaptec app: authorises a waiting session even with auth on. */
  authorise(now: Date): void {
    this.advance(now);
    if (this.carConnected && this.mode === ChargerOperationMode.ConnectedRequesting && this.batteryPercent < 100) {
      this.mode = ChargerOperationMode.Charging;
    }
  }

  command(commandId: number, now: Date): CommandResult {
    this.advance(now);
    if (!this.settings.online) return { accepted: false, note: "Charger offline" };
    switch (commandId) {
      case ZaptecCommand.ResumeCharging: {
        if (!this.carConnected) return { accepted: true, note: "No car connected -- nothing to resume (528)" };
        if (this.settings.requiresAuth && !this.finalStopActive && !this.charging) {
          return { accepted: true, note: "Not paused and auth required -- can't authorise a new session (528)" };
        }
        if (this.charging) return { accepted: true, note: "Already charging (528)" };
        this.finalStopActive = false;
        if (this.batteryPercent >= 100) {
          this.mode = ChargerOperationMode.StoppedOrIdle;
          return { accepted: true, note: "Resumed, but the battery is full" };
        }
        this.mode = ChargerOperationMode.Charging;
        return { accepted: true, note: "Charging resumed" };
      }
      case ZaptecCommand.StopChargingFinal: {
        if (!this.carConnected) return { accepted: true, note: "No car connected" };
        this.mode = ChargerOperationMode.StoppedOrIdle;
        this.finalStopActive = true;
        return { accepted: true, note: "Charging stopped (final stop latched)" };
      }
      default:
        return { accepted: false, note: `Unknown command ${commandId} (519)` };
    }
  }

  /** The car reports its battery to Smartcar (what the webhook/GET would then return). */
  reportBattery(now: Date): void {
    this.advance(now);
    this.reading = { percent: Math.round(this.batteryPercent), at: now };
  }

  setBattery(percent: number, now: Date): void {
    this.advance(now);
    this.batteryPercent = Math.max(0, Math.min(100, percent));
  }

  toChargerState(chargerId: string, now: Date): ChargerState {
    this.advance(now);
    const online = this.settings.online;
    return {
      chargerId,
      isOnline: online,
      operationMode: this.mode,
      finalStopActive: this.carConnected ? this.finalStopActive : null,
      chargeCurrentSetAmps: null,
      instantPowerWatts: this.charging ? Math.round(this.settings.powerKw * 1000) : 0,
      sessionEnergyKwh: this.carConnected ? Math.round(this.sessionEnergyKwh * 1000) / 1000 : null,
      observedAt: now.toISOString(),
      sessionId: this.sessionId,
      chargeDurationSeconds: this.charging ? Math.round(this.chargingSeconds) : null,
      scheduledChargingStartAt: null,
      lastCompletedSession: this.lastCompletedSession,
      maxPowerKw: this.settings.maxPowerKw,
      installationRequiresAuth: this.settings.requiresAuth,
    };
  }

  snapshot(now: Date): SimSnapshot {
    this.advance(now);
    return {
      ...this.settings,
      carConnected: this.carConnected,
      mode: this.mode,
      finalStopActive: this.finalStopActive,
      sessionId: this.sessionId,
      sessionStartedAt: this.sessionStartedAt?.toISOString() ?? null,
      sessionEnergyKwh: Math.round(this.sessionEnergyKwh * 100) / 100,
      chargingSeconds: Math.round(this.chargingSeconds),
      batteryPercent: Math.round(this.batteryPercent * 10) / 10,
      reading: this.reading ? { percent: this.reading.percent, at: this.reading.at.toISOString() } : null,
      lastCompletedSession: this.lastCompletedSession,
    };
  }
}
