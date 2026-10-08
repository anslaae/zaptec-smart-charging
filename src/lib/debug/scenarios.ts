import { ChargerOperationMode } from "@/lib/zaptec/constants";
import type { ChargerState } from "@/lib/zaptec/types";
import type { chargeSchedules } from "@/lib/db/schema";

type Schedule = typeof chargeSchedules.$inferSelect;

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
    sessionId: null,
    chargeDurationSeconds: null,
    scheduledChargingStartAt: null,
    lastCompletedSession: null,
    maxPowerKw: 4.6,
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
    chargerName: "Preview charger",
    targetEnergyKwh: "11.5",
    readyBy: new Date(now.getTime() + 8 * 60 * 60 * 1000),
    status: "pending",
    lastCommand: null,
    lastNote: null,
    lastEvaluatedAt: null,
    lastError: null,
    startedAt: null,
    endedAt: null,
    zaptecSessionId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export interface DebugScenario {
  label: string;
  state: ChargerState;
  schedule: Schedule | null;
  startTime: string | null;
}

// Pure front-end previews -- never touch the real charger, DB, or Zaptec
// API. Each one is a complete, self-consistent mock so ChargerCard renders
// exactly as it would for a real charger in that situation. Action buttons
// are disabled while one of these is active (see ChargerCard) so a click
// can't send a real command based on fake displayed state.
export const DEBUG_SCENARIOS: Record<string, DebugScenario> = {
  noCarConnected: {
    label: "No car connected",
    state: baseState({ operationMode: ChargerOperationMode.Disconnected }),
    schedule: null,
    startTime: null,
  },
  idleNoPlan: {
    label: "Plugged in, no plan",
    state: baseState({ operationMode: ChargerOperationMode.ConnectedRequesting }),
    schedule: null,
    startTime: null,
  },
  chargingNoPlan: {
    label: "Charging, no plan",
    state: baseState({
      operationMode: ChargerOperationMode.Charging,
      instantPowerWatts: 3200,
      sessionEnergyKwh: 1.4,
      chargeDurationSeconds: 12 * 60,
    }),
    schedule: null,
    startTime: null,
  },
  planPending: {
    label: "Plan pending",
    state: baseState({ operationMode: ChargerOperationMode.StoppedOrIdle, finalStopActive: true }),
    schedule: baseSchedule({ status: "pending", lastNote: "Waiting for the optimal start time" }),
    startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  },
  planActiveCharging: {
    label: "Plan active, charging",
    state: baseState({
      operationMode: ChargerOperationMode.Charging,
      instantPowerWatts: 3200,
      sessionEnergyKwh: 4.1,
      chargeDurationSeconds: 45 * 60,
    }),
    schedule: baseSchedule({ status: "active", lastCommand: "resume" }),
    startTime: null,
  },
  planError: {
    label: "Plan with a problem",
    state: baseState({ operationMode: ChargerOperationMode.Disconnected }),
    schedule: baseSchedule({
      status: "pending",
      lastError: "Needs to charge but no car is connected",
    }),
    startTime: null,
  },
  appNotInControl: {
    label: "App not in control",
    state: baseState({
      operationMode: ChargerOperationMode.ConnectedRequesting,
      installationRequiresAuth: true,
    }),
    schedule: null,
    startTime: null,
  },
};

export type DebugScenarioKey = keyof typeof DEBUG_SCENARIOS | "real";
