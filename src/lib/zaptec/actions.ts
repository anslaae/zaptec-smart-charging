"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { sendChargerCommand } from "./client";
import { ZaptecCommand } from "./constants";

// Manual override, independent of any schedule -- "just charge now" rather
// than aiming for a target/deadline. There's no separate "start" command
// (StartCharging/501 is rejected outright with 519 UnknownCommand);
// ResumeCharging is the only one that applies, matching evcc's production
// Zaptec driver. If the charger was never stopped, Zaptec rejects it with a
// harmless 528 that sendChargerCommand() treats as success -- it just means
// there was nothing to resume.
export async function startChargingNow(chargerId: string): Promise<void> {
  await verifySession();
  await sendChargerCommand(chargerId, ZaptecCommand.ResumeCharging);
  revalidatePath("/");
}

export async function stopChargingNow(chargerId: string): Promise<void> {
  await verifySession();
  await sendChargerCommand(chargerId, ZaptecCommand.StopChargingFinal);
  revalidatePath("/");
}
