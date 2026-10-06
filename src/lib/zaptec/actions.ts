"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { sendChargerCommand } from "./client";
import { ZaptecCommand } from "./constants";

// Manual override, independent of any schedule -- "just charge now" rather
// than aiming for a target/deadline. Uses StartCharging, not ResumeCharging:
// confirmed live that ResumeCharging only undoes a previous
// StopChargingFinal and fails outright (HTTP 500, "Charging is not Paused
// nor Scheduled") against a charger that's simply plugged in and idle,
// which is the state this button is meant for.
export async function startChargingNow(chargerId: string): Promise<void> {
  await verifySession();
  await sendChargerCommand(chargerId, ZaptecCommand.StartCharging);
  revalidatePath("/");
}

export async function stopChargingNow(chargerId: string): Promise<void> {
  await verifySession();
  await sendChargerCommand(chargerId, ZaptecCommand.StopChargingFinal);
  revalidatePath("/");
}
