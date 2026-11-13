import { ChargerOperationMode, ZaptecCommand } from "@/lib/zaptec/constants";
import type { ChargerState, ChargeHistoryEntry, LastCompletedSession, MeterReading } from "@/lib/zaptec/types";

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
  /** The Smartcar signals API fails (as it now and then does in production); the webhook rows still exist. */
  smartcarDown: boolean;
  /** What the car draws while charging. */
  powerKw: number;
  /** Simulation speed for energy: 60 = one real second delivers a minute's worth. */
  speed: number;
  capacityKwh: number;
  maxPowerKw: number;
  /** D71: Zaptec's /state lags a command; this many seconds pass before the command shows. */
  commandLagSeconds: number;
  /** D73: Warnings (804) bitmask the charger reports; 0 = none. */
  warnings: number;
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
  /** D69: the car sits at 0 A while the charger still says "charging" (mode 3). */
  idleWhileCharging = false;
  /** D75: the car stopped requesting power by itself; a start command is accepted but changes nothing until it asks again. */
  carDeclined = false;
  history: ChargeHistoryEntry[] = [];
  /** D72: the charger's lifetime meter register (kWh), like OCMF's RV. */
  meterKwh = 431.6;
  /** D72: this session's meter readings: begin, each whole hour, end. */
  sessionReadings: MeterReading[] = [];
  /** D71: commands accepted but not yet visible in /state. */
  private pendingCommands: { commandId: number; applyAt: number }[] = [];
  private lastAdvancedAt: number;

  constructor(now: Date, settings?: Partial<SimSettings>, batteryPercent = 46) {
    this.settings = {
      online: true,
      requiresAuth: false,
      smartcarDown: false,
      powerKw: 7.1,
      speed: 1,
      capacityKwh: 46,
      maxPowerKw: 11,
      commandLagSeconds: 0,
      warnings: 0,
      ...settings,
    };
    this.batteryPercent = batteryPercent;
    this.reading = { percent: batteryPercent, at: new Date(now.getTime() - 40 * 60_000) };
    this.lastAdvancedAt = now.getTime();
  }

  get charging(): boolean {
    return this.mode === ChargerOperationMode.Charging;
  }

  /** Charging and actually drawing current (not idling at 0 A in mode 3). */
  get drawing(): boolean {
    return this.charging && !this.idleWhileCharging;
  }

  /** Accrue energy for the time passed (times the speed setting). Call before every read or change. */
  advance(now: Date): void {
    const from = this.lastAdvancedAt;
    const seconds = Math.max(0, (now.getTime() - from) / 1000) * this.settings.speed;
    this.lastAdvancedAt = now.getTime();
    const meterBefore = this.meterKwh;
    if (this.drawing && seconds > 0) {
      this.addEnergy(this.settings.powerKw * (seconds / 3600));
      this.chargingSeconds += seconds;
    }
    // OCMF-style reading at each whole hour passed while connected (energy split by time).
    if (this.carConnected) {
      for (let h = Math.floor(from / 3_600_000) * 3_600_000 + 3_600_000; h <= now.getTime(); h += 3_600_000) {
        const share = now.getTime() > from ? (h - from) / (now.getTime() - from) : 1;
        this.sessionReadings.push({ at: new Date(h).toISOString(), kwh: Math.round((meterBefore + (this.meterKwh - meterBefore) * share) * 1000) / 1000 });
      }
    }
    // Commands whose lag is over now show in the state.
    const due = this.pendingCommands.filter((c) => c.applyAt <= now.getTime());
    if (due.length > 0) {
      this.pendingCommands = this.pendingCommands.filter((c) => c.applyAt > now.getTime());
      for (const c of due) this.applyCommand(c.commandId);
    }
  }

  /** Delivers energy into the session and the battery; the car stops drawing at 100 %. */
  addEnergy(kwh: number): void {
    if (!this.carConnected || kwh <= 0) return;
    const room = ((100 - this.batteryPercent) / 100) * this.settings.capacityKwh;
    const delivered = Math.min(kwh, room);
    this.sessionEnergyKwh += delivered;
    this.meterKwh += delivered;
    this.batteryPercent = Math.min(100, this.batteryPercent + (delivered / this.settings.capacityKwh) * 100);
    if (this.batteryPercent >= 100 && this.charging) {
      // Car is full: it stops drawing, the session stays open (not a final stop).
      this.mode = ChargerOperationMode.StoppedOrIdle;
    }
  }

  /** D68: the car stops requesting power by itself (as the Opel did during Forvarm on 13 Nov) -- mode 5, no final stop. */
  carStopsDrawing(now: Date): void {
    this.advance(now);
    if (this.charging) {
      this.mode = ChargerOperationMode.StoppedOrIdle;
      this.carDeclined = true;
    }
    this.idleWhileCharging = false;
  }

  /** D69: the car stops drawing but the charger stays in mode 3 (the mode lags): only the phase currents show it. */
  carIdlesWhileCharging(now: Date): void {
    this.advance(now);
    if (this.charging) this.idleWhileCharging = true;
  }

  /** The car asks for power again (only if nothing latched it off and it isn't full). */
  carDrawsAgain(now: Date): void {
    this.advance(now);
    this.idleWhileCharging = false;
    this.carDeclined = false;
    if (this.carConnected && this.mode === ChargerOperationMode.StoppedOrIdle && !this.finalStopActive && this.batteryPercent < 100) {
      this.mode = ChargerOperationMode.Charging;
    }
  }

  plugIn(now: Date): void {
    this.advance(now);
    if (this.carConnected) return;
    this.carConnected = true;
    this.idleWhileCharging = false;
    this.carDeclined = false;
    this.sessionId = newSessionId();
    this.sessionStartedAt = now;
    this.sessionEnergyKwh = 0;
    this.chargingSeconds = 0;
    this.finalStopActive = false;
    this.pendingCommands = [];
    this.sessionReadings = [{ at: now.toISOString(), kwh: Math.round(this.meterKwh * 1000) / 1000 }];
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
        sessionId: this.sessionId,
        startedAt: this.sessionStartedAt.toISOString(),
        endedAt: now.toISOString(),
        energyKwh: Math.round(this.sessionEnergyKwh * 1000) / 1000,
        meterReadings: [...this.sessionReadings, { at: now.toISOString(), kwh: Math.round(this.meterKwh * 1000) / 1000 }],
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
    this.sessionReadings = [];
    this.pendingCommands = [];
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
    const lag = this.settings.commandLagSeconds;
    if (lag > 0 && this.carConnected && (commandId === ZaptecCommand.ResumeCharging || commandId === ZaptecCommand.StopChargingFinal)) {
      this.pendingCommands.push({ commandId, applyAt: now.getTime() + lag * 1000 });
      return { accepted: true, note: `Accepted -- shows in the state after ${lag} s` };
    }
    return this.applyCommand(commandId);
  }

  private applyCommand(commandId: number): CommandResult {
    switch (commandId) {
      case ZaptecCommand.ResumeCharging: {
        if (!this.carConnected) return { accepted: true, note: "No car connected -- nothing to resume (528)" };
        // A real car that stopped by itself ignores a start (D68/D75).
        if (this.carDeclined && !this.charging) {
          this.finalStopActive = false;
          return { accepted: true, note: "Accepted, but the car isn't asking for power" };
        }
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
    const watts = this.drawing ? Math.round(this.settings.powerKw * 1000) : 0;
    // Single-phase: the drawing phase carries the current, the others read idle noise.
    const phaseCurrentsAmps = [this.drawing ? Math.round((watts / 230) * 10) / 10 : 0.05, 0.03, 0.03];
    return {
      chargerId,
      isOnline: online,
      operationMode: this.mode,
      finalStopActive: this.carConnected ? this.finalStopActive : null,
      chargeCurrentSetAmps: null,
      instantPowerWatts: watts,
      sessionEnergyKwh: this.carConnected ? Math.round(this.sessionEnergyKwh * 1000) / 1000 : null,
      observedAt: now.toISOString(),
      sessionId: this.sessionId,
      chargeDurationSeconds: this.charging ? Math.round(this.chargingSeconds) : null,
      scheduledChargingStartAt: null,
      lastCompletedSession: this.lastCompletedSession,
      maxPowerKw: this.settings.maxPowerKw,
      installationRequiresAuth: this.settings.requiresAuth,
      phaseCurrentsAmps,
      health: { warnings: this.settings.warnings, notifications: 0, signalDbm: -71 },
      rawObservations: {
        "507": String(phaseCurrentsAmps[0]),
        "508": String(phaseCurrentsAmps[1]),
        "509": String(phaseCurrentsAmps[2]),
        "513": String(watts),
        "710": String(this.mode),
        "718": this.carConnected ? (this.finalStopActive ? "1" : "0") : null,
        "721": this.sessionId,
        "804": String(this.settings.warnings),
      },
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
