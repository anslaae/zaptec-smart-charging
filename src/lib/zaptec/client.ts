import "server-only";
import { env } from "@/lib/env";
import { getZaptecAccessToken } from "./auth";
import { ZAPTEC_API_BASE, ObservationId } from "./constants";
import type {
  ZaptecChargerListApiResponse,
  ZaptecStateObservation,
  ZaptecStateObservationApi,
  ChargerState,
  ZaptecCharger,
  ChargeHistoryEntry,
  ZaptecChargeHistoryApiResponse,
} from "./types";

export { isCurrentlyCharging, isPausedAndResumable } from "./state";

async function zaptecFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getZaptecAccessToken();
  const response = await fetch(`${ZAPTEC_API_BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  return response;
}

export async function listChargers(): Promise<ZaptecCharger[]> {
  const response = await zaptecFetch("/api/chargers?PageSize=100");
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
  }));
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

export async function getChargerState(
  chargerId: string,
  isOnline: boolean,
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
  };
}

export async function sendChargerCommand(
  chargerId: string,
  commandId: number,
): Promise<void> {
  if (env.SIMULATE_CHARGER_COMMANDS) {
    console.log(`[simulated] Zaptec command ${commandId} for charger ${chargerId}`);
    return;
  }

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
