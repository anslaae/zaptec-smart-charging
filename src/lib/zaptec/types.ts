export interface ZaptecTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface ZaptecCharger {
  id: string;
  name: string;
  deviceId: string;
  isOnline: boolean;
  operatingMode: number;
  installationId: string;
  installationName: string;
}

export interface ZaptecChargerListResponse {
  pages: number;
  totalCount: number;
  data: ZaptecCharger[];
  message: string | null;
}

export interface ZaptecStateObservation {
  chargerId: string;
  stateId: number;
  stateName: string | null;
  timestamp: string;
  valueAsString: string | null;
}

// Derived, convenience view over the raw observation array for a single charger.
export interface ChargerState {
  chargerId: string;
  isOnline: boolean;
  operationMode: number | null;
  finalStopActive: boolean | null;
  chargeCurrentSetAmps: number | null;
  instantPowerWatts: number | null;
  sessionEnergyKwh: number | null;
  observedAt: string | null;
}
