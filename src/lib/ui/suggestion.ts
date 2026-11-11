// "Forslag fra sist" on Hjem (connected, no plan): last completed plan's
// target and ready time, for tomorrow. When that plan had a battery target
// and the battery is known now, the kWh is worked out from the battery now
// -- "Lad til 80 %" means something different at 30 % than at 60 %.
// Plans from before the plan sheet (no %) fall back to their kWh. Pure.

export interface Suggestion {
  targetKwh: number;
  targetPercent: number | null;
  startPercent: number | null;
}

/** Plans smaller than this aren't worth suggesting (the car is basically there). */
const MIN_SUGGESTED_KWH = 0.5;

export function buildSuggestion(input: {
  lastPlan: { targetPercent: number | null; targetKwh: number };
  batteryPercent: number | null;
  capacityKwh: number;
}): Suggestion | null {
  const { lastPlan, batteryPercent, capacityKwh } = input;
  if (lastPlan.targetPercent != null && batteryPercent != null) {
    const start = Math.round(batteryPercent);
    const kwh = Math.round(((lastPlan.targetPercent - start) / 100) * capacityKwh * 10) / 10;
    if (kwh < MIN_SUGGESTED_KWH) return null;
    return { targetKwh: kwh, targetPercent: lastPlan.targetPercent, startPercent: start };
  }
  return { targetKwh: lastPlan.targetKwh, targetPercent: null, startPercent: null };
}
