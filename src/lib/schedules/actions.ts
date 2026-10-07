"use server";

import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { chargeSchedules } from "@/lib/db/schema";
import { HOUSEHOLD_TIME_ZONE, zonedDateTimeToUtc } from "@/lib/datetime";
import { sendChargerCommand } from "@/lib/zaptec/client";
import { ZaptecCommand } from "@/lib/zaptec/constants";
import { logActivity, ActivityType } from "@/lib/activity/log";

const CreateScheduleSchema = z.object({
  chargerId: z.string().min(1),
  chargerName: z.string().min(1),
  targetEnergyKwh: z.coerce.number().positive().max(200),
  readyBy: z.string().min(1),
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
  });

  if (!parsed.success) {
    return { error: "Check the amount to charge and the ready-by time." };
  }

  const readyBy = zonedDateTimeToUtc(parsed.data.readyBy, HOUSEHOLD_TIME_ZONE);
  if (Number.isNaN(readyBy.getTime()) || readyBy.getTime() <= Date.now()) {
    return { error: "Ready-by time must be a valid time in the future." };
  }

  // A charger can only run one schedule's charging window at a time, so
  // reject a new one while an existing pending/active schedule would overlap
  // it, rather than letting the scheduler juggle conflicting commands.
  const [overlapping] = await db
    .select({ id: chargeSchedules.id })
    .from(chargeSchedules)
    .where(
      and(
        eq(chargeSchedules.chargerId, parsed.data.chargerId),
        inArray(chargeSchedules.status, ["pending", "active"]),
      ),
    )
    .limit(1);

  if (overlapping) {
    return {
      error: "This charger already has an active or pending schedule. Cancel it first.",
    };
  }

  await db.insert(chargeSchedules).values({
    createdByUserId: session.userId,
    chargerId: parsed.data.chargerId,
    chargerName: parsed.data.chargerName,
    targetEnergyKwh: parsed.data.targetEnergyKwh.toString(),
    readyBy,
    status: "pending",
  });
  await logActivity(parsed.data.chargerId, parsed.data.chargerName, ActivityType.PlanCreated, {
    detail: `${parsed.data.targetEnergyKwh} kWh, ready by ${readyBy.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: HOUSEHOLD_TIME_ZONE, hour12: false })}`,
    userId: session.userId,
  });

  revalidatePath("/");
  // ?created=1 lets the dashboard fire a one-off success toast on arrival --
  // this component is about to unmount (redirect), so it can't show one itself.
  redirect("/?created=1");
}

export interface ActionResult {
  error?: string;
  success?: boolean;
}

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
      await logActivity(schedule.chargerId, schedule.chargerName, ActivityType.PlanCancelled, {
        userId: session.userId,
      });
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to cancel the schedule." };
  }

  revalidatePath("/");
  return { success: true };
}

export async function deleteSchedule(
  scheduleId: string,
  _prevState: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  await verifySession();

  try {
    const [schedule] = await db
      .select({ status: chargeSchedules.status })
      .from(chargeSchedules)
      .where(eq(chargeSchedules.id, scheduleId))
      .limit(1);

    if (!schedule) {
      return { error: "Schedule not found." };
    }
    if (schedule.status === "pending" || schedule.status === "active") {
      return { error: "Cancel the schedule before deleting it." };
    }

    await db.delete(chargeSchedules).where(eq(chargeSchedules.id, scheduleId));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to delete the schedule." };
  }

  revalidatePath("/history");
  return { success: true };
}
