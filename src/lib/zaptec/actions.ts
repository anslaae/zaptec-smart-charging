"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
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
  _prevState: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  await verifySession();
  try {
    await sendChargerCommand(chargerId, ZaptecCommand.ResumeCharging);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to start charging." };
  }
  revalidatePath("/");
  return { success: true };
}

export async function stopChargingNow(
  chargerId: string,
  _prevState: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  await verifySession();
  try {
    await sendChargerCommand(chargerId, ZaptecCommand.StopChargingFinal);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to stop charging." };
  }
  revalidatePath("/");
  return { success: true };
}
