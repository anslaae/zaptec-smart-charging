import "server-only";
import { getZaptecAccessToken } from "./auth";
import { ZAPTEC_API_BASE, ObservationId } from "./constants";
import type {
  ZaptecChargerListResponse,
  ZaptecStateObservation,
  ChargerState,
  ZaptecCharger,
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
  const data = (await response.json()) as ZaptecChargerListResponse;
  return data.data;
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
  const observations = (await response.json()) as ZaptecStateObservation[];

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
