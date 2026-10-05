import "server-only";
import { getZaptecAccessToken } from "./auth";
import { ZAPTEC_API_BASE, ObservationId, NOMINAL_VOLTAGE } from "./constants";
import type {
  ZaptecChargerListApiResponse,
  ZaptecStateObservation,
  ZaptecStateObservationApi,
  ChargerState,
  ZaptecCharger,
  ChargeHistoryEntry,
  ZaptecChargeHistoryApiResponse,
  ZaptecCircuitApiResponse,
  LastCompletedSession,
} from "./types";

export { isCurrentlyCharging, isPausedAndResumable } from "./state";

async function zaptecFetch(
  path: string,
  init?: RequestInit & { next?: { revalidate?: number } },
): Promise<Response> {
  const token = await getZaptecAccessToken();
  const response = await fetch(`${ZAPTEC_API_BASE}${path}`, {
    // Zaptec's fair-use policy asks integrators not to poll aggressively;
    // callers that pass `next.revalidate` opt into Next.js's fetch cache
    // instead of always hitting the API fresh.
    cache: init?.next ? undefined : "no-store",
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  });
  return response;
}

export async function listChargers(): Promise<ZaptecCharger[]> {
  // The charger list rarely changes; Zaptec's fair-use policy explicitly
  // asks for this to be fetched at most once an hour rather than on every
  // poll.
  const response = await zaptecFetch("/api/chargers?PageSize=100", {
    next: { revalidate: 3600 },
  });
  if (!response.ok) {
    throw new Error(`Failed to list chargers: ${response.status}`);
  }
  const data = (await response.json()) as ZaptecChargerListApiResponse;
  return data.Data.map((charger) => ({
    id: charger.Id,
    name: charger.Name,
    deviceId: charger.DeviceId,
    isOnline: charger.IsOnline,
    operatingMode: charger.OperatingMode,
    installationId: charger.InstallationId,
    installationName: charger.InstallationName,
    circuitId: charger.CircuitId,
  }));
}

// A circuit's current limit is an electrical installation fact that
// essentially never changes, so this is cached hard (24h) — fetching it on
// every poll would be exactly the "aggressive polling" Zaptec's fair-use
// policy asks integrators to avoid.
export async function getCircuitMaxCurrentAmps(circuitId: string): Promise<number | null> {
  const response = await zaptecFetch(`/api/circuits/${circuitId}`, {
    next: { revalidate: 86_400 },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as ZaptecCircuitApiResponse;
  return data.MaxCurrent ?? null;
}

// Only the most recent 100 sessions per charger; fine for a household charger,
// but would need real pagination to show a multi-year history.
export async function getChargeHistory(chargerId: string): Promise<ChargeHistoryEntry[]> {
  const response = await zaptecFetch(`/api/chargehistory?ChargerId=${chargerId}&PageSize=100`);
  if (!response.ok) {
    throw new Error(`Failed to read charge history: ${response.status}`);
  }
  const data = (await response.json()) as ZaptecChargeHistoryApiResponse;
  return data.Data.map((entry) => ({
    id: entry.Id,
    chargerId: entry.ChargerId,
    deviceName: entry.DeviceName,
    startedAt: entry.StartDateTime,
    endedAt: entry.EndDateTime,
    energyKwh: entry.Energy,
    userFullName: entry.UserFullName,
  }));
}

function findObservation(
  observations: ZaptecStateObservation[],
  stateId: number,
): ZaptecStateObservation | undefined {
  return observations.find((observation) => observation.stateId === stateId);
}

// CompletedSession's value is a JSON blob (StartDateTime/EndDateTime/Energy);
// parsed defensively since its exact shape isn't formally documented.
function parseCompletedSession(raw: string | null | undefined): LastCompletedSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      StartDateTime?: string;
      EndDateTime?: string;
      Energy?: number;
    };
    if (!parsed.StartDateTime || !parsed.EndDateTime || parsed.Energy == null) return null;
    return { startedAt: parsed.StartDateTime, endedAt: parsed.EndDateTime, energyKwh: parsed.Energy };
  } catch {
    return null;
  }
}

// NextScheduleEvent's exact format (e.g. for Smart Eco Mode) isn't
// documented publicly; parsed defensively as an ISO-ish date string and
// simply omitted if it doesn't parse cleanly.
function parseScheduledStart(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// MaxPhases is a bitmask (Phase_1=1, Phase_2=2, Phase_3=4, All=7); the
// number of set bits is how many phases are actually available.
function countPhases(bitmask: number): number {
  return [1, 2, 4].filter((bit) => (bitmask & bit) !== 0).length;
}

export async function getChargerState(
  chargerId: string,
  isOnline: boolean,
  circuitId: string,
): Promise<ChargerState> {
  const response = await zaptecFetch(`/api/chargers/${chargerId}/state`);
  if (!response.ok) {
    throw new Error(`Failed to read charger state: ${response.status}`);
  }
  const rawObservations = (await response.json()) as ZaptecStateObservationApi[];
  const observations: ZaptecStateObservation[] = rawObservations.map((raw) => ({
    chargerId: raw.ChargerId,
    stateId: raw.StateId,
    stateName: raw.StateName ?? null,
    timestamp: raw.Timestamp,
    valueAsString: raw.ValueAsString,
  }));

  const operationModeObs = findObservation(
    observations,
    ObservationId.ChargerOperationMode,
  );
  const finalStopActiveObs = findObservation(
    observations,
    ObservationId.FinalStopActive,
  );
  const currentSetObs = findObservation(observations, ObservationId.ChargeCurrentSet);
  const powerObs = findObservation(observations, ObservationId.TotalChargePower);
  const sessionEnergyObs = findObservation(
    observations,
    ObservationId.TotalChargePowerSession,
  );
  const chargeDurationObs = findObservation(observations, ObservationId.ChargeDuration);
  const nextScheduleObs = findObservation(observations, ObservationId.NextScheduleEvent);
  const completedSessionObs = findObservation(observations, ObservationId.CompletedSession);
  const chargerMaxCurrentObs = findObservation(observations, ObservationId.ChargerMaxCurrent);
  const maxPhasesObs = findObservation(observations, ObservationId.MaxPhases);
  const sessionIdObs = findObservation(observations, ObservationId.SessionIdentifier);

  const chargerMaxCurrentAmps = chargerMaxCurrentObs?.valueAsString
    ? Number(chargerMaxCurrentObs.valueAsString)
    : null;
  const phases = maxPhasesObs?.valueAsString ? countPhases(Number(maxPhasesObs.valueAsString)) : null;
  const circuitMaxCurrentAmps = await getCircuitMaxCurrentAmps(circuitId);
  const effectiveMaxCurrentAmps =
    chargerMaxCurrentAmps != null && circuitMaxCurrentAmps != null
      ? Math.min(chargerMaxCurrentAmps, circuitMaxCurrentAmps)
      : (chargerMaxCurrentAmps ?? circuitMaxCurrentAmps);
  const maxPowerKw =
    effectiveMaxCurrentAmps != null && phases != null
      ? (effectiveMaxCurrentAmps * phases * NOMINAL_VOLTAGE) / 1000
      : null;

  return {
    chargerId,
    isOnline,
    operationMode: operationModeObs?.valueAsString
      ? Number(operationModeObs.valueAsString)
      : null,
    finalStopActive: finalStopActiveObs?.valueAsString
      ? finalStopActiveObs.valueAsString === "1"
      : null,
    chargeCurrentSetAmps: currentSetObs?.valueAsString
      ? Number(currentSetObs.valueAsString)
      : null,
    instantPowerWatts: powerObs?.valueAsString ? Number(powerObs.valueAsString) : null,
    sessionEnergyKwh: sessionEnergyObs?.valueAsString
      ? Number(sessionEnergyObs.valueAsString)
      : null,
    observedAt:
      operationModeObs?.timestamp ?? powerObs?.timestamp ?? sessionEnergyObs?.timestamp ?? null,
    sessionId: sessionIdObs?.valueAsString ?? null,
    chargeDurationSeconds: chargeDurationObs?.valueAsString
      ? Number(chargeDurationObs.valueAsString)
      : null,
    scheduledChargingStartAt: parseScheduledStart(nextScheduleObs?.valueAsString),
    lastCompletedSession: parseCompletedSession(completedSessionObs?.valueAsString),
    maxPowerKw,
  };
}

export async function sendChargerCommand(
  chargerId: string,
  commandId: number,
): Promise<void> {
  const response = await zaptecFetch(
    `/api/chargers/${chargerId}/sendCommand/${commandId}`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new Error(
      `Zaptec command ${commandId} failed for charger ${chargerId}: ${response.status} ${await response.text()}`,
    );
  }
}
