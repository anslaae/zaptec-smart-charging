"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { sendChargerCommand } from "./client";
import { ZaptecCommand } from "./constants";

// Manual override, independent of any schedule -- "just charge now" rather
// than aiming for a target/deadline. Uses the same command pair the
// scheduler itself uses (ResumeCharging/StopChargingFinal), since those are
// already proven to work against this charger. Note: ResumeCharging only
// undoes a previous stop -- if the charger is already auto-charging (never
// stopped), "Start charging" may be a no-op.
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
