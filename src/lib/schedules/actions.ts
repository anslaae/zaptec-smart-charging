"use server";

import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { chargeSchedules } from "@/lib/db/schema";
import { HOUSEHOLD_TIME_ZONE, zonedDateTimeToUtc } from "@/lib/datetime";

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
  await verifySession();

  try {
    const now = new Date();
    await db
      .update(chargeSchedules)
      .set({ status: "cancelled", endedAt: now, updatedAt: now })
      .where(eq(chargeSchedules.id, scheduleId));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to cancel the schedule." };
  }

  revalidatePath("/");
  return { success: true };
}
