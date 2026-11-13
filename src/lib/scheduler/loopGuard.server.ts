import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, notInArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, scheduleActions } from "@/lib/db/schema";
import { ActivityType } from "@/lib/activity/log";
import { GUARD_WINDOW_MS, loopGuardStatus, type AutomatedCommand, type GuardStatus } from "./loopGuard";

// Marker row in schedule_actions (not a command; every other reader filters
// on action = "resume"): the plan's Zaptec session changed, i.e. the car was
// re-plugged -- often between two ticks, so no plugged_in event is logged.
export const NEW_SESSION_ACTION = "new_session";

const PLAN_DIRECTION: Record<string, AutomatedCommand["direction"]> = {
  resume: "start",
  pause: "stop",
  complete: "stop",
};

/**
 * The loop guard's state for one charger (D65), from what is already logged:
 * plan commands (schedule_actions), the tick's own stops (activity events
 * stopped_unplanned / automatic_completed), the guard's automation_paused
 * events, and the resets -- plug-in/unplug, a new Zaptec session, or any
 * event a person triggered (except Forvarm during a charge, D67). Used by the tick and by Hjem, so both agree.
 */
export async function loadLoopGuard(
  chargerId: string,
  now: Date,
  currentSessionId: string | null,
): Promise<GuardStatus> {
  const windowStart = new Date(now.getTime() - GUARD_WINDOW_MS);
  const [planCommands, tickStops, [lastTrip], [lastResetEvent], [lastNewSession]] = await Promise.all([
    db
      .select({ at: scheduleActions.createdAt, action: scheduleActions.action })
      .from(scheduleActions)
      .where(
        and(
          eq(scheduleActions.chargerId, chargerId),
          inArray(scheduleActions.action, Object.keys(PLAN_DIRECTION)),
          gte(scheduleActions.createdAt, windowStart),
        ),
      ),
    db
      .select({ at: activityEvents.createdAt })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.chargerId, chargerId),
          inArray(activityEvents.type, [ActivityType.StoppedUnplanned, ActivityType.AutomaticCompleted]),
          gte(activityEvents.createdAt, windowStart),
        ),
      ),
    db
      .select({ at: activityEvents.createdAt, sessionId: activityEvents.detail })
      .from(activityEvents)
      .where(and(eq(activityEvents.chargerId, chargerId), eq(activityEvents.type, ActivityType.AutomationPaused)))
      .orderBy(desc(activityEvents.createdAt))
      .limit(1),
    db
      .select({ at: activityEvents.createdAt })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.chargerId, chargerId),
          or(
            inArray(activityEvents.type, [ActivityType.PluggedIn, ActivityType.Unplugged]),
            // Forvarm during a charge (D67) changes nothing about control: not a reset.
            and(isNotNull(activityEvents.userId), notInArray(activityEvents.type, [ActivityType.PreheatDuringCharge])),
          ),
        ),
      )
      .orderBy(desc(activityEvents.createdAt))
      .limit(1),
    db
      .select({ at: scheduleActions.createdAt })
      .from(scheduleActions)
      .where(and(eq(scheduleActions.chargerId, chargerId), eq(scheduleActions.action, NEW_SESSION_ACTION)))
      .orderBy(desc(scheduleActions.createdAt))
      .limit(1),
  ]);
  const resets = [lastResetEvent?.at, lastNewSession?.at].filter((d): d is Date => d != null);
  return loopGuardStatus({
    commands: [
      ...planCommands.map((c) => ({ at: c.at, direction: PLAN_DIRECTION[c.action] })),
      ...tickStops.map((c) => ({ at: c.at, direction: "stop" as const })),
    ],
    lastTripAt: lastTrip?.at ?? null,
    // automation_paused keeps the Zaptec session id in detail (not shown in Aktivitet).
    tripSessionId: lastTrip?.sessionId ?? null,
    currentSessionId,
    lastResetAt: resets.length ? new Date(Math.max(...resets.map((d) => d.getTime()))) : null,
    now,
  });
}
