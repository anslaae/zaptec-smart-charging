import "server-only";
import { db } from "@/lib/db";
import { activityEvents } from "@/lib/db/schema";

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
  PlanCreated: "plan_created",
  PlanCancelled: "plan_cancelled",
  PlanCompleted: "plan_completed",
  // The scheduler tick stopped a session with no active plan or manual
  // authorization behind it -- the normal outcome of plugging in with no
  // plan ready, now that the installation uses free charging. Deliberately
  // worded as a plain log line rather than a security alert.
  StoppedUnplanned: "stopped_unplanned",
} as const;

export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType];

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  plugged_in: "Car plugged in",
  unplugged: "Car unplugged",
  charging_started: "Charging started",
  charging_stopped: "Charging stopped",
  manual_start: "Started manually",
  manual_stop: "Stopped manually",
  plan_created: "Charging plan created",
  plan_cancelled: "Charging plan cancelled",
  plan_completed: "Charging plan completed",
  stopped_unplanned: "Stopped automatically (no plan or manual start running)",
};

export async function logActivity(
  chargerId: string,
  chargerName: string,
  type: ActivityType,
  detail?: string,
): Promise<void> {
  await db.insert(activityEvents).values({ chargerId, chargerName, type, detail: detail ?? null });
}
