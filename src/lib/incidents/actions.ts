"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { chargeIncidents, users } from "@/lib/db/schema";
import { logActivity, ActivityType } from "@/lib/activity/log";
import { readChargerState } from "@/lib/sessions";
import { currentIncident, subjectKey } from "./rules";
import { loadWanted } from "./sync.server";
import { sendChargerCommand } from "@/lib/zaptec/client";
import { ZaptecCommand } from "@/lib/zaptec/constants";
import { nb } from "@/lib/i18n/nb";
import type { ActionResult } from "@/lib/zaptec/actions";

// D75 "Prøv igjen" (owner said yes): one manual try per incident. Re-read the
// charger; online → send one start, nothing automatic after it; still offline
// → say so and send nothing. Either way the try is used up, so the button is
// gone until the incident clears. Never offered for the loop guard / lock.
const RETRYABLE: ReadonlySet<string> = new Set(["start_failed", "offline", "charger_warning"]);

export async function retryIncident(incidentId: string, chargerName: string): Promise<ActionResult> {
  const session = await verifySession();
  // Claim the one try first, so a double tap (or two phones) sends at most one start.
  const [incident] = await db
    .update(chargeIncidents)
    .set({ retriedAt: new Date() })
    .where(and(eq(chargeIncidents.id, incidentId), isNull(chargeIncidents.closedAt), isNull(chargeIncidents.retriedAt)))
    .returning();
  if (!incident || !RETRYABLE.has(incident.kind)) {
    revalidatePath("/");
    return { stale: true };
  }
  const [state, { wanted }] = await Promise.all([readChargerState(incident.chargerId), loadWanted(incident.chargerId)]);
  // A screen from before someone pressed Stopp (or the car drew again) sends nothing.
  // An offline incident whose charger answers again may still retry (that's the point).
  const kindNow = state ? currentIncident({ state, wanted, guardPaused: false }) : incident.kind;
  const current =
    subjectKey(wanted) === incident.subject && (kindNow === incident.kind || incident.kind === "offline");
  if (!current) {
    revalidatePath("/");
    return { stale: true };
  }
  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, session.userId));
  await logActivity(incident.chargerId, chargerName, ActivityType.IncidentRetry, {
    userId: session.userId,
    detail: JSON.stringify({ name: user?.name ?? "–" }),
  });
  if (!state?.isOnline) {
    revalidatePath("/");
    return { error: nb.home.incident.retryStillOffline };
  }
  try {
    await sendChargerCommand(incident.chargerId, ZaptecCommand.ResumeCharging);
  } catch (error) {
    revalidatePath("/");
    return { error: error instanceof Error ? error.message : nb.actions.chargeStartFailed, commandFailed: true };
  }
  revalidatePath("/");
  return { success: true };
}
