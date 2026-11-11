import type { ChargerState } from "@/lib/zaptec/types";
import type { Prices } from "@/lib/pricing";
import type { SinceUnplug } from "@/lib/ui/sinceUnplug";

/**
 * Everything the Hjem card needs for one charger, as plain serialisable data
 * (dates as ISO strings) so it can cross the server -> client boundary.
 * Built by src/app/page.tsx; replaced wholesale by a debug scenario in preview.
 */
export interface HomeCardData {
  chargerId: string;
  chargerName: string;
  /** Server "now", so the first render and hydration compute identical text. */
  nowIso: string;
  state: ChargerState;
  schedule: {
    id: string;
    status: "pending" | "active" | "completed" | "cancelled";
    targetEnergyKwh: number;
    readyByIso: string;
    lastError: string | null;
    /** kWh this plan has delivered so far (planDeliveredNow: across re-plugs, never negative). */
    deliveredKwh: number;
    /** Battery % the plan aims for (null for plans made before the plan sheet). */
    targetPercent: number | null;
    /** "user" or "smart" (Smart lading, UC16). */
    source: string;
    /** Smart lading: the planned blocks, cost and saving. */
    smart: { blocks: { start: string; end: string }[]; costNok: number; nowCostNok: number } | null;
  } | null;
  /** Latest start time from estimateChargingPlan, for a pending plan. */
  startTimeIso: string | null;
  startsImmediately: boolean;
  openSession: { kind: "manual" | "preheat" | "guest" | "automatic"; startedAtIso: string; guestName?: string | null } | null;
  lastCompletedPlanSessionId: string | null;
  stateOfCharge: { percent: number; oemUpdatedAtIso: string } | null;
  learnedPowerKw: number | null;
  /** The household car's usable capacity (cars table). */
  capacityKwh: number;
  /** Norgespris + nettleie rates from Innstillinger (src/lib/pricing.ts). */
  prices: Prices;
  /** noCar: what happened since the last unplug (HANDOFF §3 "Koblet fra"); null = hide the card. */
  sinceUnplug: SinceUnplug | null;
  /** ready: the plan that just finished, for the status line and the "Siste lading" card. */
  lastPlan: {
    id: string;
    startPercent: number | null;
    targetPercent: number | null;
    reachedPercent: number | null;
    deliveredKwh: number | null;
    startedAtIso: string | null;
    endedAtIso: string | null;
    readyByIso: string;
    byName: string | null;
    /** The car charged (design 6c): the line starts with it. */
    carName: string | null;
    costNok: number | null;
  } | null;
  suggestion: {
    targetKwh: number;
    /** Last plan's battery target, with kWh worked out from the battery now (null for older plans). */
    targetPercent: number | null;
    startPercent: number | null;
    readyByLocal: string;
    readyByIso: string;
  } | null;
}
