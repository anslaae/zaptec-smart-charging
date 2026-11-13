"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { verifySession } from "@/lib/auth/dal";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { chargeSchedules, manualChargeSessions } from "@/lib/db/schema";
import { fill, nb } from "@/lib/i18n/nb";
import { formatTime } from "@/lib/datetime";
import { preheatHoldEnd } from "@/lib/scheduler/preheatHold";
import {
  bindOpenSessions,
  closeSession,
  closeSessions,
  finalizeSessionEnergy,
  openSession,
  readChargerState,
} from "@/lib/sessions";
import { chargeToRideAlong, type RunningCharge } from "@/lib/preheat";
import { cancelSmartRows } from "@/lib/scheduler/smartRun";
import { logActivity, ActivityType } from "@/lib/activity/log";
import { getChargerState, isCurrentlyCharging, listChargers, sendChargerCommand } from "./client";
import { ChargerOperationMode, ZaptecCommand } from "./constants";

export interface ActionResult {
  error?: string;
  success?: boolean;
  /** The Zaptec command itself failed; nothing else was changed (UI offers "Prøv igjen"). */
  commandFailed?: boolean;
}

// Lad nå and Forvarm can't run next to an open plan: while a plan waits for
// its start time the scheduler pauses any charging it finds, so the session
// would be stopped again within a minute. The UI asks first and sends
// cancelPlan=1; without it the action refuses instead of silently cancelling
// someone's plan (DECISIONS.md D27).
async function clearOpenPlan(
  chargerId: string,
  chargerName: string,
  formData: FormData,
  userId: string,
): Promise<ActionResult | null> {
  // Smart lading steps aside without asking (HANDOFF §6b): it's the
  // automatic fallback, not someone's plan.
  await cancelSmartRows(chargerId, chargerName, userId);
  const open = await db
    .select({ id: chargeSchedules.id })
    .from(chargeSchedules)
    .where(
      and(
        eq(chargeSchedules.chargerId, chargerId),
        eq(chargeSchedules.source, "user"),
        inArray(chargeSchedules.status, ["pending", "active"]),
      ),
    );
  if (open.length === 0) return null;
  if (formData.get("cancelPlan") !== "1") return { error: nb.actions.planInTheWay };
  const now = new Date();
  for (const plan of open) {
    await db
      .update(chargeSchedules)
      .set({ status: "cancelled", endedAt: now, updatedAt: now })
      .where(eq(chargeSchedules.id, plan.id));
    await logActivity(chargerId, chargerName, ActivityType.PlanCancelled, { userId });
  }
  return null;
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
  formData: FormData,
): Promise<ActionResult> {
  const session = await verifySession();
  const blocked = await clearOpenPlan(chargerId, chargerName, formData, session.userId);
  if (blocked) return blocked;
  try {
    await sendChargerCommand(chargerId, ZaptecCommand.ResumeCharging);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to start charging.", commandFailed: true };
  }
  // Opens a manual authorization so the scheduler tick's enforcement doesn't
  // treat this as an unrecognized session and stop it again.
  await openSession(chargerId, "manual", session.userId);
  after(() => bindOpenSessions(chargerId));
  await logActivity(chargerId, chargerName, ActivityType.ManualStart, { userId: session.userId });
  revalidatePath("/");
  return { success: true };
}

// Winter preheat: Smartcar has no climate command for this Opel (confirmed
// against its Compatibility API -- the only commands it exposes for any
// Opel model are charge-start/charge-stop, nothing climate-related), so
// there's no way to trigger the car's climate control from here. What this
// *can* do is make sure the car draws preheat power from the grid rather
// than its own battery: Zaptec has no distinct "allow power but don't
// charge" mode either -- ResumeCharging is the only lever, identical to
// startChargingNow above -- so this just authorizes the same way and lets
// the car's own firmware decide how to use the available power. Climate
// control itself still has to be started by hand in the myOpel app.
export async function startPreheat(
  chargerId: string,
  chargerName: string,
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await verifySession();
  // D67: already charging? Leave it running -- no plan cancelled, no
  // command, no new row. Under a plan or Smart lading the power gets a hold
  // (the earlier of 60 min and readyBy) so the tick won't pause or stop it
  // meanwhile; under Lad nå / a guest window / automatic it stays on anyway.
  const running = await runningCharge(chargerId);
  if (running) {
    let detail: string | undefined;
    if (running.kind === "plan" || running.kind === "smart") {
      const now = new Date();
      for (const schedule of running.schedules) {
        const until = preheatHoldEnd(now, schedule.readyBy);
        if (!until) continue;
        await db.update(chargeSchedules).set({ preheatHoldUntil: until, preheatPowerLostAt: null, preheatPowerLostNotifiedAt: null, updatedAt: now }).where(eq(chargeSchedules.id, schedule.id));
        detail = fill(nb.preheatSheet.holdDetail, { time: formatTime(until) });
      }
    }
    await logActivity(chargerId, chargerName, ActivityType.PreheatDuringCharge, { userId: session.userId, detail });
    revalidatePath("/");
    return { success: true };
  }
  const blocked = await clearOpenPlan(chargerId, chargerName, formData, session.userId);
  if (blocked) return blocked;
  try {
    await sendChargerCommand(chargerId, ZaptecCommand.ResumeCharging);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to start charging.", commandFailed: true };
  }
  await openSession(chargerId, "preheat", session.userId);
  after(() => bindOpenSessions(chargerId));
  await logActivity(chargerId, chargerName, ActivityType.PreheatStarted, { userId: session.userId });
  revalidatePath("/");
  return { success: true };
}

/** What's charging the car right now and keeps it charging, if anything (D67). */
async function runningCharge(
  chargerId: string,
): Promise<{ kind: RunningCharge; schedules: { id: string; readyBy: Date }[] } | null> {
  const state = await readChargerState(chargerId);
  if (!state || !isCurrentlyCharging(state)) return null;
  const open = await db
    .select({ kind: manualChargeSessions.kind })
    .from(manualChargeSessions)
    .where(and(eq(manualChargeSessions.chargerId, chargerId), isNull(manualChargeSessions.endedAt)));
  const schedules = await db
    .select({ id: chargeSchedules.id, source: chargeSchedules.source, readyBy: chargeSchedules.readyBy })
    .from(chargeSchedules)
    .where(and(eq(chargeSchedules.chargerId, chargerId), inArray(chargeSchedules.status, ["pending", "active"])));
  const kind = chargeToRideAlong({
    charging: true,
    openKinds: open.map((r) => r.kind),
    scheduleSources: schedules.map((r) => r.source),
  });
  return kind ? { kind, schedules } : null;
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
    return { error: error instanceof Error ? error.message : "Failed to stop charging.", commandFailed: true };
  }
  // A guest window stays open (it ends on unplug or "Avslutt utlån"); only
  // the Lad nå / Forvarm / automatic authorisations end here.
  const closed = await closeSessions(chargerId, { keepGuest: true });
  after(() => finalizeSessionEnergy(chargerId, closed.map((row) => row.id)));
  // A Forvarm hold (D67) ends with Stopp too.
  await db
    .update(chargeSchedules)
    .set({ preheatHoldUntil: null, preheatPowerLostAt: null, preheatPowerLostNotifiedAt: null })
    .where(and(eq(chargeSchedules.chargerId, chargerId), isNotNull(chargeSchedules.preheatHoldUntil)));
  // …and Smart lading for this plug-in, or the next tick would resume it.
  await cancelSmartRows(chargerId, chargerName, session.userId);
  await logActivity(chargerId, chargerName, ActivityType.ManualStop, { userId: session.userId });
  revalidatePath("/");
  return { success: true };
}

// UC15 "Lån ut laderen": a guest window that lasts until the guest's car is
// unplugged. The scheduler tick treats it as authorised, starts the car once
// when the guest plugs in, holds plans back meanwhile and sends no pushes.
export async function lendCharger(
  chargerId: string,
  chargerName: string,
  _prevState: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await verifySession();
  // Lending and plans are mutually exclusive (owner decision, D29): an open
  // plan is cancelled only when the person confirmed it.
  const blocked = await clearOpenPlan(chargerId, chargerName, formData, session.userId);
  if (blocked) return blocked;
  const [open] = await db
    .select({ id: manualChargeSessions.id })
    .from(manualChargeSessions)
    .where(
      and(
        eq(manualChargeSessions.chargerId, chargerId),
        eq(manualChargeSessions.kind, "guest"),
        isNull(manualChargeSessions.endedAt),
      ),
    )
    .limit(1);
  if (!open) {
    // A car already plugged in is taken to be the guest's (the usual case:
    // the guest plugged in, enforcement stopped it, then someone tapped Lån
    // ut). Binding now, from the counter as it is, keeps energy delivered
    // before the window out of the guest's total. With no car, the window
    // binds to the next car that plugs in.
    const charger = (await listChargers().catch(() => [])).find((c) => c.id === chargerId);
    const state = charger
      ? await getChargerState(charger.id, charger.isOnline, charger.circuitId, charger.installationId).catch(() => undefined)
      : undefined;
    const connected = state != null && state.operationMode !== ChargerOperationMode.Disconnected;
    const guestName = String(formData.get("guestName") ?? "").trim().slice(0, 60) || null;
    await openSession(chargerId, "guest", session.userId, connected ? state : undefined, guestName);
    if (connected && !isCurrentlyCharging(state) && state.finalStopActive) {
      await sendChargerCommand(chargerId, ZaptecCommand.ResumeCharging).catch(() => undefined);
    }
    await logActivity(chargerId, chargerName, ActivityType.GuestStarted, {
      userId: session.userId,
      detail: String(formData.get("guestName") ?? "").trim().slice(0, 60) || undefined,
    });
  }
  revalidatePath("/");
  revalidatePath("/settings");
  return { success: true };
}

export async function endLending(
  chargerId: string,
  chargerName: string,
  _prevState: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const session = await verifySession();
  const guests = await db
    .select()
    .from(manualChargeSessions)
    .where(
      and(
        eq(manualChargeSessions.chargerId, chargerId),
        eq(manualChargeSessions.kind, "guest"),
        isNull(manualChargeSessions.endedAt),
      ),
    );
  for (const row of guests) await closeSession(row);
  // A guest car still drawing power would be stopped by the next tick anyway;
  // stopping now matches what the button says. Rejected harmlessly if idle.
  if (guests.some((row) => row.zaptecSessionId != null)) {
    await sendChargerCommand(chargerId, ZaptecCommand.StopChargingFinal).catch(() => undefined);
  }
  if (guests.length > 0) {
    await logActivity(chargerId, chargerName, ActivityType.GuestEnded, { userId: session.userId });
  }
  revalidatePath("/");
  revalidatePath("/settings");
  return { success: true };
}
