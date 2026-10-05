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
  // The charger's own configured current limit (amps).
  ChargerMaxCurrent: 510,
  // Bitmask from the Phases constant (1/2/4, or 7 for all three) — for this
  // single-phase household installation it's always 1.
  MaxPhases: 520,
  // The GUID of whatever session is current (plugged-in or charging); used
  // to link a schedule to its real Zaptec session for later lookup via
  // getChargeHistory(). Changes whenever a new physical session starts.
  SessionIdentifier: 721,
} as const;

// ChargerOperationMode values — all 4 documented values (there's no 4).
export const ChargerOperationMode = {
  Disconnected: 1,
  ConnectedRequesting: 2,
  Charging: 3,
  StoppedOrIdle: 5,
} as const;

// Norway's standard residential phase-to-neutral voltage (TN network) — used
// to convert a current limit (amps) into a power ceiling (kW), since Zaptec
// doesn't report voltage until a session is actively drawing power.
export const NOMINAL_VOLTAGE = 230;
