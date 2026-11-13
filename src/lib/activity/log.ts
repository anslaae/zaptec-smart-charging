import "server-only";
import { db } from "@/lib/db";
import { activityEvents } from "@/lib/db/schema";
import { nb } from "@/lib/i18n/nb";

// Free-text keys (not a DB enum) for activityEvents.type -- see the schema
// comment for why. ACTIVITY_LABEL below is the single place that turns one
// of these into user-facing copy.
export const ActivityType = {
  PluggedIn: "plugged_in",
  Unplugged: "unplugged",
  ChargingStarted: "charging_started",
  ChargingStopped: "charging_stopped",
  ManualStart: "manual_start",
  ManualStop: "manual_stop",
  // Same mechanism as ManualStart (ResumeCharging + a manual_charge_sessions
  // row) -- logged separately so the activity feed shows *why* charging
  // started rather than lumping it in with a plain "Charge now" tap.
  PreheatStarted: "preheat_started",
  PreheatDuringCharge: "preheat_during_charge",
  PlanCreated: "plan_created",
  PlanCancelled: "plan_cancelled",
  // "Angre" on the Plan avbrutt toast (within 10 s).
  PlanRestored: "plan_restored",
  PlanChargingStarted: "plan_charging_started",
  PlanCompleted: "plan_completed",
  // The scheduler tick stopped a session with no active plan or manual
  // authorization behind it -- the normal outcome of plugging in with no
  // plan ready, now that the installation uses free charging. Deliberately
  // worded as a plain log line rather than a security alert.
  StoppedUnplanned: "stopped_unplanned",
  // UC15: "Lån ut laderen" opened / the guest unplugged (or it was ended).
  GuestStarted: "guest_started",
  GuestEnded: "guest_ended",
  // UC14: the household switch in Innstillinger.
  AutomaticAllowed: "automatic_allowed",
  AutomaticDisallowed: "automatic_disallowed",
  // "Lad med en gang" reached its target % and stopped.
  AutomaticCompleted: "automatic_completed",
  // UC16 Smart lading: a smart row was planned on plug-in / cancelled for that session.
  SmartPlanned: "smart_planned",
  SmartCancelled: "smart_cancelled",
  // Innstillinger → "Når bilen kobles til" changed (or expired back to "wait").
  OnPluginModeChanged: "on_plugin_mode_changed",
  // D65: the loop guard tripped -- the app stopped sending automated
  // commands to this charger until the car is re-plugged or someone acts.
  AutomationPaused: "automation_paused",
  // D75 incidents: one line per incident (detail = JSON values for the label's
  // {placeholders}, see src/lib/ui/activity.ts), plus "Prøv igjen" and the
  // unplug before a plan's target.
  CarStoppedFull: "car_stopped_full",
  CarStopped: "car_stopped",
  CarNeverStarted: "car_never_started",
  StartFailed: "start_failed",
  ChargerOffline: "charger_offline",
  ChargerBack: "charger_back",
  ChargerWarning: "charger_warning",
  IncidentRetry: "retry",
  UnpluggedBeforeTarget: "unplugged_before_target",
} as const;

export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType];

// The Norwegian copy lives in src/lib/i18n/nb.ts (activity.*), which also
// holds labels for event types later steps add (guest, automatic charging).
export const ACTIVITY_LABEL: Record<ActivityType, string> = nb.activity;

export async function logActivity(
  chargerId: string,
  chargerName: string,
  type: ActivityType,
  options?: { detail?: string; userId?: string },
): Promise<void> {
  await db.insert(activityEvents).values({
    chargerId,
    chargerName,
    type,
    detail: options?.detail ?? null,
    userId: options?.userId ?? null,
  });
}
