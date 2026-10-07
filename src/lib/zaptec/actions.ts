"use server";

import { isNull, eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { manualChargeSessions } from "@/lib/db/schema";
import { logActivity, ActivityType } from "@/lib/activity/log";
import { sendChargerCommand } from "./client";
import { ZaptecCommand } from "./constants";

export interface ActionResult {
  error?: string;
  success?: boolean;
}

// Manual override, independent of any schedule -- "just charge now" rather
// than aiming for a target/deadline. There's no separate "start" command
// (StartCharging/501 is rejected outright with 519 UnknownCommand);
// ResumeCharging is the only one that applies, matching evcc's production
// Zaptec driver. If the charger was never stopped, Zaptec rejects it with a
// harmless 528 that sendChargerCommand() treats as success -- it just means
// there was nothing to resume.
export async function startChargingNow(
  chargerId: string,
  chargerName: string,
  _prevState: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const session = await verifySession();
  try {
    await sendChargerCommand(chargerId, ZaptecCommand.ResumeCharging);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to start charging." };
  }
  // Opens a manual authorization so the scheduler tick's enforcement doesn't
  // treat this as an unrecognized session and stop it again.
  await db.insert(manualChargeSessions).values({ chargerId, startedByUserId: session.userId });
  await logActivity(chargerId, chargerName, ActivityType.ManualStart, { userId: session.userId });
  revalidatePath("/");
  return { success: true };
}

export async function stopChargingNow(
  chargerId: string,
  chargerName: string,
  _prevState: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const session = await verifySession();
  try {
    await sendChargerCommand(chargerId, ZaptecCommand.StopChargingFinal);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to stop charging." };
  }
  await db
    .update(manualChargeSessions)
    .set({ endedAt: new Date() })
    .where(and(eq(manualChargeSessions.chargerId, chargerId), isNull(manualChargeSessions.endedAt)));
  await logActivity(chargerId, chargerName, ActivityType.ManualStop, { userId: session.userId });
  revalidatePath("/");
  return { success: true };
}
