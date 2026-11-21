import { priceAt, type Prices } from "@/lib/pricing";
import { plannedPowerKw } from "@/lib/scheduler/engine";
import { nextSmartReadyBy, planSmartCharge } from "@/lib/scheduler/smart";

// Hjem smartIdle's "Kobler du til nå" (HANDOFF §6g): the window Smart would
// pick if the car were plugged in now. The same planner, inputs and power
// rule as the tick's first plan for a plug-in (planFor + plannedPowerKw in
// src/lib/scheduler/smartRun.ts), from the latest battery reading. Pure.

export interface SmartPreview {
  readyByIso: string;
  /** The planned window; null when the car is already at the target (nothing to charge). */
  window: { startIso: string; endIso: string; blocks: { start: string; end: string }[]; costNok: number; nowCostNok: number } | null;
}

export function smartPreview(input: {
  now: Date;
  /** Latest battery estimate; the caller hides the row without one. */
  socPercent: number;
  targetPercent: number;
  readyByWeekday: string;
  readyByWeekend: string;
  capacityKwh: number;
  learnedPowerKw: number | null;
  maxPowerKw: number | null;
  prices: Prices;
}): SmartPreview {
  const readyBy = nextSmartReadyBy(input.now, input.readyByWeekday, input.readyByWeekend);
  const plan = planSmartCharge({
    now: input.now,
    socPercent: input.socPercent,
    targetPercent: input.targetPercent,
    capacityKwh: input.capacityKwh,
    powerKw: plannedPowerKw(input.learnedPowerKw, input.maxPowerKw),
    readyBy,
    priceFn: (d) => priceAt(d, input.prices),
  });
  const first = plan.blocks[0];
  const last = plan.blocks[plan.blocks.length - 1];
  return {
    readyByIso: readyBy.toISOString(),
    window:
      plan.neededKwh > 0 && first && last
        ? { startIso: first.start, endIso: last.end, blocks: plan.blocks, costNok: plan.costNok, nowCostNok: plan.nowCostNok }
        : null,
  };
}
