export const ZAPTEC_API_BASE = "https://api.zaptec.com";
export const ZAPTEC_TOKEN_URL = "https://api.zaptec.com/oauth/token";

export const ZaptecCommand = {
  Restart: 102,
  FirmwareUpgrade: 200,
  StopChargingFinal: 506,
  // Only undoes a previous StopChargingFinal/pause -- does not start a
  // fresh session from idle. There is no separate "start" command: the
  // listed StartCharging (501) returns a live 519 UnknownCommand via this
  // endpoint. A charger that's connected but never stopped by us will
  // reject this with a (harmless, treated as success) 528 -- see
  // sendChargerCommand in client.ts. Matches evcc's production Zaptec
  // driver, which uses this exact same pair and nothing else.
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
  // D69: current per phase (amps), confirmed in /api/constants on 2026-11-13.
  // Idle reads ~0.03-0.05 A; a charging phase reads several amps.
  CurrentPhase1: 507,
  CurrentPhase2: 508,
  CurrentPhase3: 509,
  // D72: hourly OCMF meter reading ("OCMF|{...}", RD[].RV = total kWh).
  SignedMeterValue: 554,
  // D73: charger health. Warnings is a bitmask (SmartWarnings in
  // /api/constants, see health.ts); 0 = none.
  Notifications: 803,
  Warnings: 804,
  CommunicationSignalStrength: 809,
} as const;

// The IDs a /state dump reports that aren't in /api/constants "Observations"
// are named in its "Schema.Apollo.ObservationIds" (Apollo = Zaptec Go), read
// 2026-11-13. Not used by the app; kept here so nobody has to look them up
// again. Values from the production charger that day in brackets.
//   145 TransmitInterval [3600]        147 PulseInterval [600 -> changed at the stop]
//   160 DpsScopeIdSource [EEPROM]      204 TemperatureEMeterPhase2
//   206/207 TemperatureTM/TM2          220/221 TemperatureSessionMaxAir/Board
//   544 MaxCurrentConfigurationSource [2]   545 SwitchPosition [0]
//   546 ChargeCurrentInstallationMaxLimit [25]  547 StandAloneCurrent [20]
//   548 PhaseRotation [10]             732 OvercurrentWarningValue [0]
//   733 OverrideNetworkType [1]        749 NrOfChargeCards [1]
//   802 ChargePointName                815 ESPResetSource
//   864 OcppNativeAuthorizationKeyFromZaptec   916 SourceVersion [go-2.6.0.7]
//   917/918 HwIdMainBoard/HwIdPowerBoard
// Named ones from the backlog: 702 ChargeMode, 714 CableType,
// 151 PermanentCableLock, 519 SetPhases, 808 DiagnosticsString,
// 811 McuResetSource, -2 IsOnline.

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
