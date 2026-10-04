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

export interface ZaptecStateObservation {
  chargerId: string;
  stateId: number;
  stateName: string | null;
  timestamp: string;
  valueAsString: string | null;
}

// Raw wire shapes: the Zaptec API responds in PascalCase, unlike its
// snake_case OAuth token endpoint. These are mapped into the camelCase
// types above immediately after fetching, in src/lib/zaptec/client.ts.
export interface ZaptecChargerApi {
  Id: string;
  Name: string;
  DeviceId: string;
  IsOnline: boolean;
  OperatingMode: number;
  InstallationId: string;
  InstallationName: string;
}

export interface ZaptecChargerListApiResponse {
  Pages: number;
  TotalCount: number;
  Data: ZaptecChargerApi[];
}

export interface ZaptecStateObservationApi {
  ChargerId: string;
  StateId: number;
  StateName?: string | null;
  Timestamp: string;
  ValueAsString: string | null;
}

export interface ChargeHistoryEntry {
  id: string;
  chargerId: string;
  deviceName: string;
  startedAt: string;
  endedAt: string | null;
  energyKwh: number;
  userFullName: string | null;
}

export interface ZaptecChargeHistoryEntryApi {
  Id: string;
  ChargerId: string;
  DeviceName: string;
  StartDateTime: string;
  EndDateTime: string | null;
  Energy: number;
  UserFullName: string | null;
}

export interface ZaptecChargeHistoryApiResponse {
  Pages: number;
  TotalCount: number;
  Data: ZaptecChargeHistoryEntryApi[];
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
