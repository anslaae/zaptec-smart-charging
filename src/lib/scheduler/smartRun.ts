import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { chargeSchedules, manualChargeSessions, vehicleTelemetry } from "@/lib/db/schema";
import type { ChargerState, ZaptecCharger } from "@/lib/zaptec/types";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import { isCurrentlyCharging } from "@/lib/zaptec/state";
import { getStateOfCharge } from "@/lib/smartcar/client";
import { estimateBattery } from "@/lib/ui/battery";
import { effectivePluginMode, pricesOf, type HouseholdSettings } from "@/lib/settings";
import { priceAt } from "@/lib/pricing";
import { logActivity, ActivityType } from "@/lib/activity/log";
import { sendPushToAllSubscribers } from "@/lib/push/send";
import { smartPlanned } from "@/lib/push/notifications";
import { formatTime } from "@/lib/datetime";
import { planDeliveredNow, plannedPowerKw, type SchedulerDecision } from "./engine";
import { decideSmart, nextSmartReadyBy, planSmartCharge, type SmartBlock, type SmartPlan } from "./smart";

// Smart lading in the tick (HANDOFF §6b "Execution"). One charge_schedules
// row with source = 'smart' per plug-in session, holding the planned blocks;
// the normal per-schedule loop then follows the blocks (smartDecision below)
// instead of latestStartTime. Never touches a session that a user plan,
// Lad nå, Forvarm, a guest window or automatic charging already covers.

type Schedule = typeof chargeSchedules.$inferSelect;

/** What's stored in charge_schedules.blocks for a smart row. */
export interface SmartBlocks {
  blocks: SmartBlock[];
  powerKw: number;
  costNok: number;
  nowCostNok: number;
  late: boolean;
  /** When this plan was made (re-plans replace it). */
  plannedAt: string;
  /** Battery % and delivered kWh the last re-plan started from (absent on the first plan). */
  socAtPlan?: number;
  deliveredAtPlan?: number;
}

export const isSmart = (s: Pick<Schedule, "source">) => s.source === "smart";

/** Re-plan when the car's reported % is this far from what we expected… */
const REPLAN_SOC_POINTS = 5;
/** …or the real charge rate is off by this much after REPLAN_AFTER_CHARGING_MS. */
const REPLAN_KW_SHARE = 0.2;
const REPLAN_AFTER_CHARGING_MS = 10 * 60_000;
/** At most one re-plan per this interval. */
const REPLAN_MIN_INTERVAL_MS = 10 * 60_000;

function planFor(input: {
  now: Date;
  socPercent: number;
  settings: HouseholdSettings;
  capacityKwh: number;
  powerKw: number;
  readyBy: Date;
}): SmartPlan {
  const prices = pricesOf(input.settings);
  return planSmartCharge({
    now: input.now,
    socPercent: input.socPercent,
    targetPercent: input.settings.smartTargetPercent,
    capacityKwh: input.capacityKwh,
    powerKw: input.powerKw,
    readyBy: input.readyBy,
    priceFn: (d) => priceAt(d, prices),
  });
}

const stored = (plan: SmartPlan, now: Date): SmartBlocks => ({
  blocks: plan.blocks,
  powerKw: plan.powerKw,
  costNok: plan.costNok,
  nowCostNok: plan.nowCostNok,
  late: plan.late,
  plannedAt: now.toISOString(),
});

/**
 * The car's battery % for planning. Smartcar readings are often hours old --
 * that's just how the car reports, not a fault -- so the latest reading is
 * used whatever its age (plus energy charged since, while charging). Without
 * a live Smartcar answer, the last reading stored from its webhook. Null only
 * when the car has never reported at all.
 */
export async function resolveSocPercent(
  state: ChargerState,
  capacityKwh: number,
  now: Date,
): Promise<{ percent: number; measuredAt: Date } | null> {
  let reading = await getStateOfCharge().catch(() => null);
  if (!reading) {
    const [row] = await db
      .select({ percent: vehicleTelemetry.batteryPercent, at: vehicleTelemetry.batteryReportedAt })
      .from(vehicleTelemetry)
      .where(isNotNull(vehicleTelemetry.batteryPercent))
      .orderBy(desc(vehicleTelemetry.batteryReportedAt))
      .limit(1);
    if (row?.percent != null && row.at) reading = { percent: row.percent, oemUpdatedAt: row.at };
  }
  if (!reading) return null;
  const battery = estimateBattery({
    reading,
    capacityKwh,
    now,
    charging: isCurrentlyCharging(state),
    sessionEnergyKwh: state.sessionEnergyKwh,
    chargeDurationSeconds: state.chargeDurationSeconds,
    remainingPlanKwh: null,
  });
  return battery.percent == null ? null : { percent: battery.percent, measuredAt: reading.oemUpdatedAt };
}

/** "Lad med en gang" to the target %: kWh to deliver, or null (charge until the car stops) without any reading. */
export async function automaticTargetKwh(
  state: ChargerState,
  settings: HouseholdSettings,
  capacityKwh: number,
  now: Date,
): Promise<number | null> {
  const soc = await resolveSocPercent(state, capacityKwh, now);
  if (!soc) return null;
  return Math.max(0, Math.round(((settings.smartTargetPercent - soc.percent) / 100) * capacityKwh * 100) / 100);
}

/**
 * Runs before enforcement each full tick. Returns the open smart rows after
 * any changes, so the caller can add new ones to the schedules it processes.
 */
export async function manageSmartRows(input: {
  chargers: ZaptecCharger[];
  stateCache: Map<string, ChargerState>;
  schedules: Schedule[];
  settings: HouseholdSettings;
  learnedPowerKw: number | null;
  capacityKwh: number;
  now: Date;
}): Promise<{ created: Schedule[]; cancelledIds: Set<string> }> {
  const { chargers, stateCache, schedules, settings, now } = input;
  const created: Schedule[] = [];
  const cancelledIds = new Set<string>();
  const mode = effectivePluginMode(settings, now);

  const openSessions = await db
    .select({ chargerId: manualChargeSessions.chargerId })
    .from(manualChargeSessions)
    .where(isNull(manualChargeSessions.endedAt));

  for (const charger of chargers) {
    const state = stateCache.get(charger.id);
    if (!state) continue;
    const connected = state.operationMode !== ChargerOperationMode.Disconnected && state.sessionId != null;
    const smartRows = schedules.filter((s) => s.chargerId === charger.id && isSmart(s));

    // A smart row belongs to one plug-in session: unplugged, or a different
    // car/session now -> it's over. (Its energy so far stays on the row.)
    for (const row of smartRows) {
      // A missing sessionId for a tick is "no reading", not an unplug (see
      // reconcileSessionEnergy) -- only a real disconnect, a different
      // session, or Smart lading being switched off ends the row.
      const unplugged = state.operationMode === ChargerOperationMode.Disconnected;
      const otherSession =
        row.zaptecSessionId != null && state.sessionId != null && row.zaptecSessionId !== state.sessionId;
      if (unplugged || otherSession || mode !== "smart") {
        await db
          .update(chargeSchedules)
          .set({ status: "cancelled", endedAt: now, updatedAt: now })
          .where(eq(chargeSchedules.id, row.id));
        cancelledIds.add(row.id);
      }
    }
    const liveSmart = smartRows.filter((r) => !cancelledIds.has(r.id));

    for (const row of liveSmart) await maybeReplan(row, state, input);

    if (mode !== "smart" || !connected || liveSmart.length > 0) continue;
    if (schedules.some((s) => s.chargerId === charger.id && !isSmart(s))) continue; // a user plan covers it
    if (openSessions.some((s) => s.chargerId === charger.id)) continue; // Lad nå/Forvarm/guest/automatic

    // Once per plug-in session: if anything was planned for this session --
    // a smart row (maybe cancelled by "Avbryt for i natt", Lad nå, …) or a
    // user plan (maybe finished or cancelled) -- don't plan again until the
    // car is unplugged and plugged in.
    const [already] = await db
      .select({ id: chargeSchedules.id })
      .from(chargeSchedules)
      .where(and(eq(chargeSchedules.chargerId, charger.id), eq(chargeSchedules.zaptecSessionId, state.sessionId!)))
      .limit(1);
    if (already) continue;

    // A stale reading is normal (see resolveSocPercent). If the car has never
    // reported, plan from empty: it may start earlier than needed, but the car
    // is ready on time and stops by itself when full; the first reading that
    // arrives re-plans it.
    const soc = await resolveSocPercent(state, input.capacityKwh, now);
    const battery = { percent: soc?.percent ?? 0 };

    const readyBy = nextSmartReadyBy(now, settings.smartReadyByWeekday, settings.smartReadyByWeekend);
    const plan = planFor({
      now,
      socPercent: battery.percent,
      settings,
      capacityKwh: input.capacityKwh,
      powerKw: plannedPowerKw(input.learnedPowerKw, state.maxPowerKw),
      readyBy,
    });
    if (plan.neededKwh <= 0 || plan.blocks.length === 0) continue; // already at the target

    const sessionKwh = state.sessionEnergyKwh ?? 0;
    const [row] = await db
      .insert(chargeSchedules)
      .values({
        createdByUserId: null,
        source: "smart",
        chargerId: charger.id,
        chargerName: charger.name,
        targetEnergyKwh: plan.neededKwh.toString(),
        readyBy,
        status: "pending",
        startPercent: battery.percent,
        targetPercent: settings.smartTargetPercent,
        blocks: stored(plan, now),
        // Count only energy from now on in this session (see createSchedule).
        zaptecSessionId: state.sessionId,
        priorSessionEnergyKwh: (-sessionKwh).toString(),
        lastObservedSessionEnergyKwh: sessionKwh.toString(),
      })
      // One smart row per session even if two ticks overlap (unique index, migration 0018).
      .onConflictDoNothing()
      .returning();
    if (!row) continue;
    created.push(row);

    const first = plan.blocks[0];
    const last = plan.blocks[plan.blocks.length - 1];
    await logActivity(charger.id, charger.name, ActivityType.SmartPlanned, {
      detail: `${settings.smartTargetPercent} % · ${formatTime(first.start)}–${formatTime(last.end)}`,
    });
    await sendPushToAllSubscribers(
      smartPlanned({
        scheduleId: row.id,
        targetPercent: settings.smartTargetPercent,
        start: new Date(first.start),
        end: new Date(last.end),
        costNok: plan.costNok,
      }),
    ).catch(() => undefined);
  }
  return { created, cancelledIds };
}

/** Re-plan a smart row when reality drifts from the plan (HANDOFF §6b). */
async function maybeReplan(
  row: Schedule,
  state: ChargerState,
  input: { settings: HouseholdSettings; capacityKwh: number; learnedPowerKw: number | null; now: Date },
): Promise<void> {
  const { now, capacityKwh, settings } = input;
  const plan = row.blocks as SmartBlocks | null;
  if (!plan || row.startPercent == null) return;
  if (now.getTime() - Date.parse(plan.plannedAt) < REPLAN_MIN_INTERVAL_MS) return;

  const delivered = planDeliveredNow(
    {
      zaptecSessionId: row.zaptecSessionId,
      priorSessionEnergyKwh: Number(row.priorSessionEnergyKwh ?? 0),
      lastObservedSessionEnergyKwh: Number(row.lastObservedSessionEnergyKwh ?? 0),
    },
    state,
  );
  // Drift is measured from the last plan (its SoC and energy at that time), so
  // one corrected reading triggers one re-plan, not one per reading.
  const socAtPlan = plan.socAtPlan ?? row.startPercent;
  const deliveredAtPlan = plan.deliveredAtPlan ?? 0;
  const expectedPercent = socAtPlan + ((delivered - deliveredAtPlan) / capacityKwh) * 100;
  let socPercent = expectedPercent;
  let powerKw = plan.powerKw;
  let reason: string | null = null;

  const reading = await getStateOfCharge().catch(() => null);
  if (reading && reading.oemUpdatedAt.getTime() > Date.parse(plan.plannedAt)) {
    if (Math.abs(reading.percent - expectedPercent) > REPLAN_SOC_POINTS) {
      socPercent = reading.percent;
      reason = "soc";
    }
  }
  const observedKw = state.instantPowerWatts && state.instantPowerWatts > 0 ? state.instantPowerWatts / 1000 : null;
  const chargingLongEnough = (state.chargeDurationSeconds ?? 0) * 1000 >= REPLAN_AFTER_CHARGING_MS;
  if (observedKw && chargingLongEnough && Math.abs(observedKw - plan.powerKw) / plan.powerKw > REPLAN_KW_SHARE) {
    powerKw = observedKw;
    reason ??= "kw";
  }
  if (!reason) return;

  const next = planFor({ now, socPercent, settings, capacityKwh, powerKw, readyBy: row.readyBy });
  await db
    .update(chargeSchedules)
    .set({
      blocks: { ...stored(next, now), socAtPlan: socPercent, deliveredAtPlan: delivered },
      targetEnergyKwh: (delivered + next.neededKwh).toFixed(2),
      updatedAt: now,
    })
    .where(eq(chargeSchedules.id, row.id));
  console.log(`[scheduler] smart row ${row.id} re-planned (${reason}): ${next.neededKwh} kWh left`);
}

/** The per-schedule loop's decision for a smart row, in decideNextAction's shape. */
export function smartDecision(row: Schedule, state: ChargerState, now: Date): SchedulerDecision {
  const plan = row.blocks as SmartBlocks | null;
  const d = decideSmart({
    blocks: plan?.blocks ?? [],
    now,
    deliveredKwh: state.sessionEnergyKwh ?? 0,
    targetKwh: Number(row.targetEnergyKwh),
  });
  if (d === "complete") return { action: "complete" };
  if (!state.isOnline) return { action: "none", reason: "Charger is offline" };
  const charging = isCurrentlyCharging(state);
  if (d === "charge") {
    if (charging) return { action: "none", reason: "Smart: charging in a planned block" };
    // Already released (resume sent, no final stop) but the car isn't drawing:
    // it's full or has decided to stop. Don't resend every minute; past the
    // ready-by time, call it done (our % estimate was simply too low).
    if (row.lastCommand === "resume" && state.finalStopActive === false) {
      return now >= row.readyBy ? { action: "complete" } : { action: "none", reason: "Smart: released, car not drawing" };
    }
    return { action: "resume" };
  }
  return charging ? { action: "pause" } : { action: "none", reason: "Smart: waiting for the planned block" };
}

/** Cancels open smart rows on a charger (a user plan, Lad nå, Forvarm or guest takes over). */
export async function cancelSmartRows(
  chargerId: string,
  chargerName: string,
  userId: string | null,
): Promise<number> {
  const now = new Date();
  const open = await db
    .select({ id: chargeSchedules.id })
    .from(chargeSchedules)
    .where(
      and(
        eq(chargeSchedules.chargerId, chargerId),
        eq(chargeSchedules.source, "smart"),
        inArray(chargeSchedules.status, ["pending", "active"]),
      ),
    );
  for (const row of open) {
    await db
      .update(chargeSchedules)
      .set({ status: "cancelled", endedAt: now, updatedAt: now })
      .where(eq(chargeSchedules.id, row.id));
    await logActivity(chargerId, chargerName, ActivityType.SmartCancelled, { userId: userId ?? undefined });
  }
  return open.length;
}
