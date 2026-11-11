import { ChargerOperationMode } from "@/lib/zaptec/constants";
import type { ChargerState } from "@/lib/zaptec/types";
import type { chargeSchedules } from "@/lib/db/schema";
import type { HomeState } from "@/lib/ui/homeState";

type Schedule = typeof chargeSchedules.$inferSelect;

const HOUR = 60 * 60 * 1000;

function baseState(overrides: Partial<ChargerState>): ChargerState {
  return {
    chargerId: "debug-preview",
    isOnline: true,
    operationMode: ChargerOperationMode.ConnectedRequesting,
    finalStopActive: null,
    chargeCurrentSetAmps: null,
    instantPowerWatts: null,
    sessionEnergyKwh: null,
    observedAt: new Date().toISOString(),
    sessionId: "debug-session",
    chargeDurationSeconds: null,
    scheduledChargingStartAt: null,
    lastCompletedSession: {
      startedAt: new Date(Date.now() - 30 * HOUR).toISOString(),
      endedAt: new Date(Date.now() - 22 * HOUR).toISOString(),
      energyKwh: 14.2,
    },
    maxPowerKw: 7.4,
    installationRequiresAuth: false,
    ...overrides,
  };
}

function baseSchedule(overrides: Partial<Schedule>): Schedule {
  const now = new Date();
  return {
    id: "debug-preview",
    createdByUserId: "debug-preview",
    chargerId: "debug-preview",
    chargerName: "Forhåndsvisning",
    targetEnergyKwh: "15.6",
    readyBy: new Date(now.getTime() + 9 * HOUR),
    status: "pending",
    lastCommand: null,
    lastNote: null,
    lastEvaluatedAt: null,
    lastError: null,
    startedAt: null,
    endedAt: null,
    zaptecSessionId: null,
    estimatedDurationMinutes: null,
    remainingKwhAtStart: null,
    priorSessionEnergyKwh: null,
    lastObservedSessionEnergyKwh: null,
    source: "user",
    blocks: null,
    startPercent: null,
    targetPercent: null,
    carId: null,
    lateNotifiedAt: null,
    waitingNotifiedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const freshReading = (percent: number, minutesAgo = 20) => ({
  percent,
  oemUpdatedAt: new Date(Date.now() - minutesAgo * 60 * 1000),
});

export interface DebugScenario {
  label: string;
  /** The Hjem state this fixture is meant to show (checked by a unit test). */
  homeState: HomeState;
  state: ChargerState;
  schedule: Schedule | null;
  startTime: string | null;
  startsImmediately?: boolean;
  openSession: { kind: "manual" | "preheat" | "guest" | "automatic"; startedAt: string } | null;
  lastCompletedPlanSessionId: string | null;
  stateOfCharge: { percent: number; oemUpdatedAt: Date } | null;
}

// Pure front-end previews -- never touch the real charger, DB, or Zaptec
// API. Each one is a complete, self-consistent mock so Hjem renders exactly
// as it would for a real charger in that situation. Action buttons are
// disabled while one of these is active (see HomeCard) so a click can't send
// a real command based on fake displayed state.
export const DEBUG_SCENARIOS: Record<string, DebugScenario> = {
  noCar: {
    label: "Ingen bil tilkoblet",
    homeState: "noCar",
    state: baseState({ operationMode: ChargerOperationMode.Disconnected, sessionId: null }),
    schedule: null,
    startTime: null,
    openSession: null,
    lastCompletedPlanSessionId: null,
    stateOfCharge: freshReading(62, 300),
  },
  planWaiting: {
    label: "Plan klar – venter på bilen",
    homeState: "planWaiting",
    state: baseState({ operationMode: ChargerOperationMode.Disconnected, sessionId: null }),
    schedule: baseSchedule({ status: "pending" }),
    startTime: new Date(Date.now() + 5 * HOUR).toISOString(),
    openSession: null,
    lastCompletedPlanSessionId: null,
    stateOfCharge: freshReading(46, 90),
  },
  planWaitingProblem: {
    label: "Plan med problem (ingen bil)",
    homeState: "planWaiting",
    state: baseState({ operationMode: ChargerOperationMode.Disconnected, sessionId: null }),
    schedule: baseSchedule({
      status: "pending",
      readyBy: new Date(Date.now() + 1 * HOUR),
      lastError: "Needs to charge but no car is connected",
    }),
    startTime: new Date(Date.now() - 2 * HOUR).toISOString(),
    startsImmediately: true,
    openSession: null,
    lastCompletedPlanSessionId: null,
    stateOfCharge: null,
  },
  connected: {
    label: "Tilkoblet – ingen plan",
    homeState: "connected",
    state: baseState({ operationMode: ChargerOperationMode.ConnectedRequesting }),
    schedule: null,
    startTime: null,
    openSession: null,
    lastCompletedPlanSessionId: null,
    stateOfCharge: freshReading(46),
  },
  planned: {
    label: "Planlagt",
    homeState: "planned",
    state: baseState({ operationMode: ChargerOperationMode.StoppedOrIdle, finalStopActive: true }),
    schedule: baseSchedule({ status: "pending" }),
    startTime: new Date(Date.now() + 4 * HOUR).toISOString(),
    openSession: null,
    lastCompletedPlanSessionId: null,
    stateOfCharge: freshReading(46),
  },
  plannedTooTight: {
    label: "Planlagt – rekker ikke helt",
    homeState: "planned",
    state: baseState({ operationMode: ChargerOperationMode.StoppedOrIdle, finalStopActive: true }),
    schedule: baseSchedule({ status: "pending", readyBy: new Date(Date.now() + 1 * HOUR) }),
    startTime: new Date(Date.now() - 1 * HOUR).toISOString(),
    startsImmediately: true,
    openSession: null,
    lastCompletedPlanSessionId: null,
    stateOfCharge: freshReading(46),
  },
  chargingPlan: {
    label: "Lader etter plan",
    homeState: "chargingPlan",
    state: baseState({
      operationMode: ChargerOperationMode.Charging,
      instantPowerWatts: 7100,
      sessionEnergyKwh: 4.1,
      chargeDurationSeconds: 35 * 60,
    }),
    schedule: baseSchedule({ status: "active", lastCommand: "resume", priorSessionEnergyKwh: "0" }),
    startTime: null,
    openSession: null,
    lastCompletedPlanSessionId: null,
    stateOfCharge: freshReading(46, 120),
  },
  chargingManual: {
    label: "Lader nå (Lad nå)",
    homeState: "chargingManual",
    state: baseState({
      operationMode: ChargerOperationMode.Charging,
      instantPowerWatts: 7100,
      sessionEnergyKwh: 1.4,
      chargeDurationSeconds: 12 * 60,
    }),
    schedule: null,
    startTime: null,
    openSession: { kind: "manual", startedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString() },
    lastCompletedPlanSessionId: null,
    stateOfCharge: freshReading(55, 40),
  },
  chargingAutomatic: {
    label: "Lader automatisk (tillatt)",
    homeState: "chargingManual",
    state: baseState({
      operationMode: ChargerOperationMode.Charging,
      instantPowerWatts: 6800,
      sessionEnergyKwh: 2.2,
      chargeDurationSeconds: 20 * 60,
    }),
    schedule: null,
    startTime: null,
    openSession: { kind: "automatic", startedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString() },
    lastCompletedPlanSessionId: null,
    stateOfCharge: freshReading(50, 60),
  },
  guestWaiting: {
    label: "Lånt ut – venter på gjesten",
    homeState: "guest",
    state: baseState({ operationMode: ChargerOperationMode.Disconnected, sessionId: null }),
    schedule: null,
    startTime: null,
    openSession: { kind: "guest", startedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() },
    lastCompletedPlanSessionId: null,
    stateOfCharge: null,
  },
  smartWaiting: {
    label: "Smart lading – venter på natten",
    homeState: "smartWaiting",
    state: baseState({ operationMode: ChargerOperationMode.StoppedOrIdle, finalStopActive: true }),
    schedule: baseSchedule({
      status: "pending",
      source: "smart",
      startPercent: 46,
      targetPercent: 80,
      blocks: {
        blocks: [
          {
            start: new Date(Date.now() + 9 * HOUR).toISOString(),
            end: new Date(Date.now() + 11.25 * HOUR).toISOString(),
          },
        ],
        powerKw: 7,
        costNok: 12.7,
        nowCostNok: 15.0,
        late: false,
        plannedAt: new Date().toISOString(),
      },
      readyBy: new Date(Date.now() + 12.75 * HOUR),
    }),
    startTime: null,
    openSession: null,
    lastCompletedPlanSessionId: null,
    stateOfCharge: freshReading(46, 30),
  },
  smartCharging: {
    label: "Smart lading – lader",
    homeState: "smartCharging",
    state: baseState({
      operationMode: ChargerOperationMode.Charging,
      instantPowerWatts: 7000,
      sessionEnergyKwh: 6.2,
      chargeDurationSeconds: 53 * 60,
    }),
    schedule: baseSchedule({
      status: "active",
      source: "smart",
      lastCommand: "resume",
      startPercent: 46,
      targetPercent: 80,
      priorSessionEnergyKwh: "0",
      blocks: {
        blocks: [{ start: new Date(Date.now() - HOUR).toISOString(), end: new Date(Date.now() + 1.25 * HOUR).toISOString() }],
        powerKw: 7,
        costNok: 12.7,
        nowCostNok: 15.0,
        late: false,
        plannedAt: new Date(Date.now() - 6 * HOUR).toISOString(),
      },
      readyBy: new Date(Date.now() + 2 * HOUR),
    }),
    startTime: null,
    openSession: null,
    lastCompletedPlanSessionId: null,
    stateOfCharge: freshReading(46, 300),
  },
  guestCharging: {
    label: "Lånt ut – gjest lader",
    homeState: "guest",
    state: baseState({
      operationMode: ChargerOperationMode.Charging,
      instantPowerWatts: 10800,
      sessionEnergyKwh: 6.3,
      chargeDurationSeconds: 40 * 60,
    }),
    schedule: null,
    startTime: null,
    openSession: { kind: "guest", startedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString() },
    lastCompletedPlanSessionId: null,
    stateOfCharge: null,
  },
  preheating: {
    label: "Forvarmer",
    homeState: "preheating",
    state: baseState({
      operationMode: ChargerOperationMode.Charging,
      instantPowerWatts: 2300,
      sessionEnergyKwh: 0.4,
      chargeDurationSeconds: 8 * 60,
    }),
    schedule: null,
    startTime: null,
    openSession: { kind: "preheat", startedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString() },
    lastCompletedPlanSessionId: null,
    stateOfCharge: freshReading(78, 30),
  },
  ready: {
    label: "Klar",
    homeState: "ready",
    state: baseState({ operationMode: ChargerOperationMode.StoppedOrIdle, finalStopActive: true }),
    schedule: null,
    startTime: null,
    openSession: null,
    lastCompletedPlanSessionId: "debug-session",
    stateOfCharge: freshReading(80, 15),
  },
  noControl: {
    label: "Appen styrer ikke laderen",
    homeState: "noControl",
    state: baseState({
      operationMode: ChargerOperationMode.ConnectedRequesting,
      installationRequiresAuth: true,
    }),
    schedule: null,
    startTime: null,
    openSession: null,
    lastCompletedPlanSessionId: null,
    stateOfCharge: freshReading(46),
  },
};

export type DebugScenarioKey = keyof typeof DEBUG_SCENARIOS | "real";
