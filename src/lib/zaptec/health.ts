// Charger health from Zaptec's own observations (D73): IsOnline (-2),
// Warnings (804, a bitmask), Notifications (803) and the signal strength
// (809, dBm). Bit names come from the live /api/constants "SmartWarnings"
// dictionary (read 2026-11-13); the production charger reported 0 then.
// Pure, unit tested.

import { fill, nb } from "@/lib/i18n/nb";

/** /api/constants SmartWarnings (2026-11-13). Values go past 2^32, so no bitwise ops. */
export const SMART_WARNINGS: Record<string, number> = {
  WARNING_HUMIDITY: 1,
  WARNING_TEMPERATURE: 2,
  WARNING_TEMPERATURE_ERROR: 4,
  WARNING_EMETER_NO_RESPONSE: 8,
  WARNING_MAX_SESSION_RESTART: 16,
  WARNING_CHARGE_OVERCURRENT: 32,
  WARNING_PILOT_STATE: 64,
  WARNING_RELAY_WELDED: 128,
  WARNING_PILOT_LOW_LEVEL: 256,
  WARNING_FPGA_COM_TIMEOUT: 512,
  WARNING_REBOOT: 1024,
  WARNING_DISABLED: 2048,
  WARNING_RCD_AC: 4096,
  WARNING_RCD_DC: 8192,
  WARNING_RCD_PEAK: 16384,
  WARNING_RCD_TEST_AC: 65536,
  WARNING_RCD_TEST_DC: 131072,
  WARNING_RCD_FAILURE: 262144,
  WARNING_RCD_TEST_TIMEOUT: 524288,
  WARNING_FPGA_VERSION: 1048576,
  WARNING_FPGA_UNEXPECTED_RELAY: 2097152,
  WARNING_FPGA_CHARGING_RESET: 4194304,
  WARNING_PILOT_NO_PROXIMITY: 8388608,
  WARNING_EMETER_ALARM: 16777216,
  WARNING_EMETER_LINK: 33554432,
  WARNING_NO_VOLTAGE_L1: 67108864,
  WARNING_NO_VOLTAGE_L2_L3: 134217728,
  WARNING_FPGA_WATCHDOG: 268435456,
  WARNING_EMETER_CAL: 536870912,
  WARNING_MID: 1073741824,
  WARNING_VARISCITE: 2147483648,
  WARNING_MCU_BOOTLOADER: 4294967296,
  WARNING_FPGA_INIT_FAILED: 8589934592,
  WARNING_VARISCITE_ILLEGAL_PHASE: 17179869184,
};

/** The ones a household member can act on or should know about, in Norwegian. */
const WARNING_NB: Record<string, string> = {
  WARNING_HUMIDITY: "fukt i laderen",
  WARNING_TEMPERATURE: "høy temperatur",
  WARNING_TEMPERATURE_ERROR: "for høy temperatur",
  WARNING_MAX_SESSION_RESTART: "stoppet for mange ganger – koble bilen fra og til",
  WARNING_CHARGE_OVERCURRENT: "for høy strøm",
  WARNING_RELAY_WELDED: "relefeil",
  WARNING_PILOT_STATE: "feil i kommunikasjonen med bilen",
  WARNING_PILOT_LOW_LEVEL: "feil i kommunikasjonen med bilen",
  WARNING_PILOT_NO_PROXIMITY: "kabelen er ikke helt inne",
  WARNING_RCD_AC: "jordfeil",
  WARNING_RCD_DC: "jordfeil",
  WARNING_RCD_PEAK: "jordfeil",
  WARNING_RCD_FAILURE: "jordfeilbryteren svarer ikke",
  WARNING_NO_VOLTAGE_L1: "ingen spenning",
  WARNING_NO_VOLTAGE_L2_L3: "mangler spenning på en fase",
  WARNING_DISABLED: "laderen er deaktivert",
};

function hasBit(mask: number, bit: number): boolean {
  return Math.floor(mask / bit) % 2 === 1;
}

/** Names of the set warning bits; unknown leftover bits as "UNKNOWN_<value>". */
export function warningNames(mask: number | null | undefined): string[] {
  if (mask == null || !Number.isFinite(mask) || mask <= 0) return [];
  const names: string[] = [];
  let known = 0;
  for (const [name, bit] of Object.entries(SMART_WARNINGS)) {
    if (hasBit(mask, bit)) {
      names.push(name);
      known += bit;
    }
  }
  if (mask - known > 0) names.push(`UNKNOWN_${mask - known}`);
  return names;
}

export interface ChargerHealthInput {
  isOnline: boolean;
  warnings: number | null;
  notifications: number | null;
  signalDbm: number | null;
}

export interface ChargerHealth {
  level: "ok" | "warning" | "offline";
  /** Hjem: a short amber line, only when something is wrong (null when fine). */
  homeLine: string | null;
  /** Innstillinger → System: always a line. */
  detail: string;
  warningCodes: string[];
}

/** What the set warning bits mean, in Norwegian ("jordfeil, høy temperatur"), or null with none set. */
export function warningText(mask: number | null | undefined): string | null {
  const codes = warningNames(mask);
  if (codes.length === 0) return null;
  const texts = [...new Set(codes.map((c) => WARNING_NB[c]).filter((t): t is string => t != null))];
  return texts.length > 0 ? texts.join(", ") : fill(nb.health.code, { code: mask ?? 0 });
}

export function chargerHealth(input: ChargerHealthInput): ChargerHealth {
  const codes = warningNames(input.warnings);
  const signal = input.signalDbm != null ? fill(nb.health.signal, { dbm: Math.round(input.signalDbm) }) : null;
  if (!input.isOnline) {
    return { level: "offline", homeLine: null, detail: nb.health.offline, warningCodes: codes };
  }
  if (codes.length > 0) {
    const what = warningText(input.warnings)!;
    return {
      level: "warning",
      homeLine: fill(nb.health.warningHome, { what }),
      detail: [fill(nb.health.warningDetail, { what, codes: codes.join(", ") }), signal].filter(Boolean).join(" · "),
      warningCodes: codes,
    };
  }
  return {
    level: "ok",
    homeLine: null,
    detail: [nb.health.ok, signal].filter(Boolean).join(" · "),
    warningCodes: [],
  };
}
