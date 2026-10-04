export const ZAPTEC_API_BASE = "https://api.zaptec.com";
export const ZAPTEC_TOKEN_URL = "https://api.zaptec.com/oauth/token";

export const ZaptecCommand = {
  Restart: 102,
  FirmwareUpgrade: 200,
  StopChargingFinal: 506,
  ResumeCharging: 507,
  DeauthorizeStop: 10001,
} as const;

// State observation IDs, see docs.zaptec.com/docs/state-observation-reference
export const ObservationId = {
  ChargerOperationMode: 710,
  FinalStopActive: 718,
  ChargeCurrentSet: 708,
  TotalChargePower: 513,
  TotalChargePowerSession: 553,
} as const;

// ChargerOperationMode values
export const ChargerOperationMode = {
  Disconnected: 1,
  Charging: 3,
  StoppedOrIdle: 5,
} as const;
