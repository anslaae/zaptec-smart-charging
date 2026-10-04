export const ZAPTEC_API_BASE = "https://api.zaptec.com";
export const ZAPTEC_TOKEN_URL = "https://api.zaptec.com/oauth/token";

export const ZaptecCommand = {
  Restart: 102,
  FirmwareUpgrade: 200,
  StopChargingFinal: 506,
  ResumeCharging: 507,
  DeauthorizeStop: 10001,
} as const;

// State observation IDs — confirmed against the live /api/constants
// "Observations" dictionary rather than the (sometimes stale) public docs.
export const ObservationId = {
  ChargerOperationMode: 710,
  FinalStopActive: 718,
  ChargeCurrentSet: 708,
  TotalChargePower: 513,
  TotalChargePowerSession: 553,
  // Only present while a session is actively charging.
  ChargeDuration: 701,
  // Only present when a schedule (e.g. Smart Eco Mode) is configured.
  NextScheduleEvent: 763,
  // The most recently *completed* session (JSON blob); only updates when a
  // session ends, so it reflects the last connection, not the current one.
  CompletedSession: 723,
} as const;

// ChargerOperationMode values — all 4 documented values (there's no 4).
export const ChargerOperationMode = {
  Disconnected: 1,
  ConnectedRequesting: 2,
  Charging: 3,
  StoppedOrIdle: 5,
} as const;
