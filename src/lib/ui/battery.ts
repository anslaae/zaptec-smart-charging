// Battery figures for the Hjem ring (design/redesign/HANDOFF.md §3). The
// Smartcar reading is often hours old (Stellantis pushes rarely), so while the
// car charges the percentage is estimated from what the charger has delivered
// since that reading, and marked "ca.".

export const MEASURED_HINT_AFTER_MS = 60 * 60 * 1000;

export interface BatteryEstimateInput {
  reading: { percent: number; oemUpdatedAt: Date } | null;
  capacityKwh: number;
  now: Date;
  charging: boolean;
  /** kWh delivered in the current charging session. */
  sessionEnergyKwh: number | null;
  /** Seconds the current session has been charging (Zaptec only reports it while charging). */
  chargeDurationSeconds: number | null;
  /** kWh the open plan still needs, to place the target tick. */
  remainingPlanKwh: number | null;
}

export interface BatteryEstimate {
  /** Best estimate of the battery now, 0-100, or null without a reading. */
  percent: number | null;
  /** True when percent includes energy delivered after the reading. */
  approx: boolean;
  /** When the reading was taken, if it's old enough to be worth saying. */
  measuredAt: Date | null;
  /** Where the plan ends, 0-100, or null without a plan or a reading. */
  targetPercent: number | null;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * kWh delivered since the reading. If the reading predates the session, all
 * of the session's energy came after it; if it was taken mid-session, only
 * the share of the session after it (assuming a roughly steady rate).
 */
export function kwhDeliveredSinceReading(
  readingAt: Date,
  now: Date,
  sessionEnergyKwh: number,
  chargeDurationSeconds: number | null,
): number {
  if (sessionEnergyKwh <= 0) return 0;
  if (chargeDurationSeconds == null || chargeDurationSeconds <= 0) return 0;
  const sessionStartMs = now.getTime() - chargeDurationSeconds * 1000;
  if (readingAt.getTime() <= sessionStartMs) return sessionEnergyKwh;
  const share = (now.getTime() - readingAt.getTime()) / (now.getTime() - sessionStartMs);
  return sessionEnergyKwh * clamp(share, 0, 1);
}

export function estimateBattery(input: BatteryEstimateInput): BatteryEstimate {
  const { reading, capacityKwh, now } = input;
  if (!reading) return { percent: null, approx: false, measuredAt: null, targetPercent: null };

  const delivered =
    input.charging && input.sessionEnergyKwh != null
      ? kwhDeliveredSinceReading(reading.oemUpdatedAt, now, input.sessionEnergyKwh, input.chargeDurationSeconds)
      : 0;
  const percent = clamp(reading.percent + (delivered / capacityKwh) * 100, 0, 100);
  const targetPercent =
    input.remainingPlanKwh != null
      ? clamp(Math.round(percent + (input.remainingPlanKwh / capacityKwh) * 100), 0, 100)
      : null;
  const old = now.getTime() - reading.oemUpdatedAt.getTime() > MEASURED_HINT_AFTER_MS;

  return {
    percent: Math.round(percent),
    approx: delivered > 0,
    measuredAt: old ? reading.oemUpdatedAt : null,
    targetPercent,
  };
}

export type GreetingPart = "morning" | "day" | "afternoon" | "evening";

/** Time-of-day band for the Hjem greeting, from the Oslo hour (0-23). */
export function greetingPart(osloHour: number): GreetingPart {
  if (osloHour >= 5 && osloHour < 10) return "morning";
  if (osloHour >= 10 && osloHour < 12) return "day";
  if (osloHour >= 12 && osloHour < 18) return "afternoon";
  return "evening";
}
