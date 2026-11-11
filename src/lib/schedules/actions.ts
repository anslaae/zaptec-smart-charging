"use server";

import { z } from "zod";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { chargeSchedules, manualChargeSessions } from "@/lib/db/schema";
import { nb } from "@/lib/i18n/nb";
import {
  HOUSEHOLD_TIME_ZONE,
  zonedDateTimeToUtc,
  formatDayAndTime,
  formatKwh,
  formatOsloDateTime,
  formatTime,
} from "@/lib/datetime";
import { listChargers, getChargerState, sendChargerCommand } from "@/lib/zaptec/client";
import { ZaptecCommand } from "@/lib/zaptec/constants";
import { logActivity, ActivityType } from "@/lib/activity/log";
import { estimateChargingPlan } from "@/lib/scheduler/engine";
import { getLearnedPowerKw } from "@/lib/scheduler/powerHistory.server";
import { getDefaultCar } from "@/lib/places";

/** Thrown inside the createSchedule transaction to roll it back on an overlapping plan. */
class OverlapError extends Error {}
import type { ChargerState } from "@/lib/zaptec/types";
import { isCurrentlyCharging } from "@/lib/zaptec/state";

const CreateScheduleSchema = z.object({
  chargerId: z.string().min(1),
  chargerName: z.string().min(1),
  targetEnergyKwh: z.coerce.number().positive().max(200),
  readyBy: z.string().min(1),
  // Editing a plan = cancel the old one + create the new one, in this single
  // action (design/redesign/HANDOFF.md §4).
  replaceScheduleId: z.string().uuid().optional(),
  // Battery % the plan was made from and aims for (plan sheet). Optional: kWh is what the scheduler uses.
  startPercent: z.coerce.number().int().min(0).max(100).optional(),
  targetPercent: z.coerce.number().int().min(1).max(100).optional(),
});

export interface CreateScheduleState {
  error?: string;
}

export async function createSchedule(
  _prevState: CreateScheduleState,
  formData: FormData,
): Promise<CreateScheduleState> {
  const session = await verifySession();

  const parsed = CreateScheduleSchema.safeParse({
    chargerId: formData.get("chargerId"),
    chargerName: formData.get("chargerName"),
    targetEnergyKwh: formData.get("targetEnergyKwh"),
    readyBy: formData.get("readyBy"),
    replaceScheduleId: formData.get("replaceScheduleId") || undefined,
    startPercent: formData.get("startPercent") || undefined,
    targetPercent: formData.get("targetPercent") || undefined,
  });

  if (!parsed.success) {
    return { error: "Sjekk hvor mye som skal lades og når bilen skal være klar." };
  }

  // Lending and plans are mutually exclusive (D29).
  const [lent] = await db
    .select({ id: manualChargeSessions.id })
    .from(manualChargeSessions)
    .where(
      and(
        eq(manualChargeSessions.chargerId, parsed.data.chargerId),
        eq(manualChargeSessions.kind, "guest"),
        isNull(manualChargeSessions.endedAt),
      ),
    )
    .limit(1);
  if (lent) return { error: nb.planSheet.lentOut };

  const readyBy = zonedDateTimeToUtc(parsed.data.readyBy, HOUSEHOLD_TIME_ZONE);
  if (Number.isNaN(readyBy.getTime()) || readyBy.getTime() <= Date.now()) {
    return { error: "Klar-tidspunktet må være et gyldig tidspunkt fram i tid." };
  }

  // The charger right now: a plan counts only energy delivered after it was
  // made, so when the car is already part-way through a session (Lad nå, an
  // edited plan) that session's energy so far becomes a negative baseline in
  // the reconcileSessionEnergy tracker (see engine.ts). Also tells the
  // person whether charging must start at once.
  const [chargerState, learnedPowerKw, car] = await Promise.all([
    listChargers()
      .then((chargers) => chargers.find((c) => c.id === parsed.data.chargerId))
      .then((c) => (c ? getChargerState(c.id, c.isOnline, c.circuitId, c.installationId) : null))
      .catch((): ChargerState | null => null),
    getLearnedPowerKw(),
    getDefaultCar(null),
  ]);
  const sessionKwh = chargerState?.sessionId != null ? (chargerState.sessionEnergyKwh ?? 0) : 0;
  const baseline =
    chargerState?.sessionId != null && sessionKwh > 0
      ? {
          zaptecSessionId: chargerState.sessionId,
          priorSessionEnergyKwh: (-sessionKwh).toString(),
          lastObservedSessionEnergyKwh: sessionKwh.toString(),
        }
      : {};

  // Replacing (editing) a plan and creating the new one happen in one
  // transaction: either the old plan is cancelled AND the new one saved, or
  // nothing changes -- an edit that fails never silently turns into a cancel.
  // Side effects (stopping the charger, activity log) only run after commit.
  const replaceId = parsed.data.replaceScheduleId;
  const outcome = await db.transaction(async (tx) => {
    let replaced: { id: string; chargerId: string; chargerName: string; status: string; source: string } | null = null;
    if (replaceId) {
      const [old] = await tx
        .select({
          id: chargeSchedules.id,
          chargerId: chargeSchedules.chargerId,
          chargerName: chargeSchedules.chargerName,
          status: chargeSchedules.status,
          source: chargeSchedules.source,
        })
        .from(chargeSchedules)
        .where(eq(chargeSchedules.id, replaceId))
        .for("update")
        .limit(1);
      if (!old || (old.status !== "pending" && old.status !== "active")) {
        return { error: "Planen du endret er ikke aktiv lenger. Lag en ny plan." } as const;
      }
      // A plan that's charging isn't edited (D55): stop it and make a new one.
      if (old.status === "active" && chargerState && isCurrentlyCharging(chargerState)) {
        return { error: nb.planSheet.inProgressError } as const;
      }
      if (old.chargerId !== parsed.data.chargerId) {
        return { error: "Planen du endret hører til en annen lader." } as const;
      }
      replaced = old;
    }

    // A user plan takes over from Smart lading for this session (HANDOFF
    // §6b) -- in this transaction, so a failed save leaves Smart lading alone.
    // Editing the smart row itself ("Endre for i natt") is the replace above.
    const smartCancelled = await tx
      .update(chargeSchedules)
      .set({ status: "cancelled", endedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(chargeSchedules.chargerId, parsed.data.chargerId),
          eq(chargeSchedules.source, "smart"),
          inArray(chargeSchedules.status, ["pending", "active"]),
          replaced ? ne(chargeSchedules.id, replaced.id) : undefined,
        ),
      )
      .returning({ id: chargeSchedules.id });

    // A charger can only run one schedule's charging window at a time, so
    // reject a new one while another pending/active schedule exists (the one
    // being replaced doesn't count), rather than letting the scheduler juggle
    // conflicting commands.
    const [overlapping] = await tx
      .select({ id: chargeSchedules.id })
      .from(chargeSchedules)
      .where(
        and(
          eq(chargeSchedules.chargerId, parsed.data.chargerId),
          inArray(chargeSchedules.status, ["pending", "active"]),
          replaced ? ne(chargeSchedules.id, replaced.id) : undefined,
        ),
      )
      .limit(1);
    if (overlapping) {
      // Throwing rolls back the smart cancel above.
      throw new OverlapError();
    }

    if (replaced) {
      const now = new Date();
      await tx
        .update(chargeSchedules)
        .set({ status: "cancelled", endedAt: now, updatedAt: now })
        .where(eq(chargeSchedules.id, replaced.id));
    }
    await tx.insert(chargeSchedules).values({
      createdByUserId: session.userId,
      chargerId: parsed.data.chargerId,
      chargerName: parsed.data.chargerName,
      targetEnergyKwh: parsed.data.targetEnergyKwh.toString(),
      readyBy,
      status: "pending",
      startPercent: parsed.data.startPercent ?? null,
      targetPercent: parsed.data.targetPercent ?? null,
      carId: car?.id ?? null,
      ...baseline,
    });
    return { replaced, smartCancelled: smartCancelled.length } as const;
  }).catch((error: unknown) => {
    if (error instanceof OverlapError) return { error: nb.toasts.planSaveFailed.overlap } as const;
    throw error;
  });

  if ("error" in outcome) {
    return { error: outcome.error };
  }

  if (outcome.replaced) {
    // Same as cancelSchedule: an active plan may be charging right now --
    // stop it so the new plan starts from a known state. The scheduler
    // resumes as soon as the new plan needs it.
    if (outcome.replaced.status === "active") {
      await sendChargerCommand(outcome.replaced.chargerId, ZaptecCommand.StopChargingFinal).catch(() => undefined);
    }
    await logActivity(
      outcome.replaced.chargerId,
      outcome.replaced.chargerName,
      outcome.replaced.source === "smart" ? ActivityType.SmartCancelled : ActivityType.PlanCancelled,
      { userId: session.userId },
    );
  }
  if (outcome.smartCancelled > 0) {
    await logActivity(parsed.data.chargerId, parsed.data.chargerName, ActivityType.SmartCancelled, {
      userId: session.userId,
    });
  }
  await logActivity(parsed.data.chargerId, parsed.data.chargerName, ActivityType.PlanCreated, {
    detail: `${formatKwh(parsed.data.targetEnergyKwh)}, klar ${formatOsloDateTime(readyBy)}`,
    userId: session.userId,
  });

  // Mirrors decideNextAction's own math: the scheduler starts charging
  // immediately regardless (never blocks or delays on a tight deadline), but
  // the person creating the plan should know upfront that's what's about to
  // happen rather than finding out later from a silent immediate start.
  const startsImmediately = chargerState
    ? estimateChargingPlan(
        { targetEnergyKwh: parsed.data.targetEnergyKwh, readyBy },
        { ...chargerState, sessionEnergyKwh: 0 },
        learnedPowerKw,
      ).latestStartTime <= new Date()
    : false;

  revalidatePath("/");
  // ?created=1 lets the dashboard fire a one-off success toast on arrival --
  // this component is about to unmount (redirect), so it can't show one
  // itself. &tight=1 additionally flags that there wasn't enough time to
  // finish comfortably, so charging will start right away.
  // start/ready feed the "Plan lagret · Starter ca. 04:48 · klar i morgen 07:30" toast.
  const params = new URLSearchParams({ created: "1", ready: formatDayAndTime(readyBy) });
  if (startsImmediately) params.set("tight", "1");
  else if (chargerState) {
    params.set(
      "start",
      formatTime(
        estimateChargingPlan(
          { targetEnergyKwh: parsed.data.targetEnergyKwh, readyBy },
          { ...chargerState, sessionEnergyKwh: 0 },
          learnedPowerKw,
        ).latestStartTime,
      ),
    );
  }
  redirect(`/?${params.toString()}`);
}

export interface ActionResult {
  error?: string;
  success?: boolean;
}

/** How long after a cancel "Angre" still restores the plan (toast shows 10 s). */
const UNDO_WINDOW_MS = 30_000;

export async function cancelSchedule(
  scheduleId: string,
  _prevState: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const session = await verifySession();

  try {
    const [schedule] = await db
      .select({
        chargerId: chargeSchedules.chargerId,
        chargerName: chargeSchedules.chargerName,
        status: chargeSchedules.status,
        source: chargeSchedules.source,
      })
      .from(chargeSchedules)
      .where(eq(chargeSchedules.id, scheduleId))
      .limit(1);

    // An active schedule may currently be charging -- cancelling it should
    // stop that right away rather than leaving the car running until the
    // scheduler tick's unauthorized-charging check catches it later.
    if (schedule?.status === "active") {
      await sendChargerCommand(schedule.chargerId, ZaptecCommand.StopChargingFinal).catch(
        () => undefined,
      );
    }

    const now = new Date();
    await db
      .update(chargeSchedules)
      .set({ status: "cancelled", endedAt: now, updatedAt: now })
      .where(eq(chargeSchedules.id, scheduleId));
    if (schedule) {
      await logActivity(
        schedule.chargerId,
        schedule.chargerName,
        schedule.source === "smart" ? ActivityType.SmartCancelled : ActivityType.PlanCancelled,
        { userId: session.userId },
      );
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to cancel the schedule." };
  }

  revalidatePath("/");
  return { success: true };
}

// "Angre" on the "Plan avbrutt" toast (HANDOFF §3b): puts a just-cancelled
// plan back as pending -- the scheduler resumes it when it needs to. Refused
// if the undo window has passed, the ready time is gone, or another plan was
// made meanwhile.
export async function restoreSchedule(scheduleId: string): Promise<ActionResult> {
  const session = await verifySession();
  const [plan] = await db.select().from(chargeSchedules).where(eq(chargeSchedules.id, scheduleId)).limit(1);
  const now = new Date();
  if (
    !plan ||
    plan.status !== "cancelled" ||
    !plan.endedAt ||
    now.getTime() - plan.endedAt.getTime() > UNDO_WINDOW_MS ||
    plan.readyBy.getTime() <= now.getTime()
  ) {
    return { error: nb.toasts.undoExpired };
  }
  const [other] = await db
    .select({ id: chargeSchedules.id })
    .from(chargeSchedules)
    .where(and(eq(chargeSchedules.chargerId, plan.chargerId), inArray(chargeSchedules.status, ["pending", "active"])))
    .limit(1);
  if (other) return { error: nb.toasts.planSaveFailed.overlap };
  await db
    .update(chargeSchedules)
    .set({ status: "pending", endedAt: null, updatedAt: now })
    .where(eq(chargeSchedules.id, scheduleId));
  await logActivity(plan.chargerId, plan.chargerName, ActivityType.PlanRestored, { userId: session.userId });
  revalidatePath("/");
  return { success: true };
}
