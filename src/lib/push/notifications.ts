import { fill, nb } from "@/lib/i18n/nb";
import { formatDayAndTime, formatNumber, formatTime } from "@/lib/datetime";
import type { PushPayload } from "./send";

// Builders for every push the app sends (design/redesign/notifications.nb.json).
// Pure functions so the copy and the once-per-plan rules can be unit tested;
// the scheduler tick decides *when* to call them. Never used for manual,
// automatic or guest sessions (the "neverNotify" list).

const t = nb.notifications;

export function pluggedInNoPlan(input: {
  chargerId: string;
  battery: { percent: number; measuredAt: Date } | null;
}): PushPayload {
  return {
    title: t.pluggedIn.title,
    body: input.battery
      ? fill(t.pluggedIn.body, { percent: Math.round(input.battery.percent), time: formatTime(input.battery.measuredAt) })
      : t.pluggedIn.bodyNoBattery,
    tag: `charger-${input.chargerId}`,
    url: "/?sheet=plan",
    actions: [
      { action: "plan", title: t.pluggedIn.plan, url: "/?sheet=plan" },
      { action: "charge-now", title: t.pluggedIn.chargeNow, url: "/?action=charge-now" },
    ],
  };
}

export function pluggedInPlanWaiting(input: { scheduleId: string; startTime: Date }): PushPayload {
  return {
    title: t.planWaiting.title,
    body: fill(t.planWaiting.body, { startTime: formatTime(input.startTime) }),
    tag: `plan-${input.scheduleId}`,
    url: "/",
  };
}

export function planStarted(input: {
  scheduleId: string;
  targetPercent: number | null;
  targetKwh: number;
  finishTime: Date;
}): PushPayload {
  const finishTime = formatTime(input.finishTime);
  return {
    title: t.planStarted.title,
    body:
      input.targetPercent != null
        ? fill(t.planStarted.body, { targetPercent: input.targetPercent, finishTime })
        : fill(t.planStartedKwh, { kwh: formatNumber(input.targetKwh, 1), finishTime }),
    tag: `plan-${input.scheduleId}`,
    url: "/",
  };
}

export function planCompleted(input: {
  scheduleId: string;
  targetPercent: number | null;
  deliveredKwh: number;
  costNok: number;
}): PushPayload {
  const kwh = formatNumber(input.deliveredKwh, 1);
  const cost = formatNumber(Math.round(input.costNok), 0);
  return {
    title: t.planCompleted.title,
    body:
      input.targetPercent != null
        ? fill(t.planCompleted.body, { targetPercent: input.targetPercent, kwh, cost })
        : fill(t.planCompletedKwh, { kwh, cost }),
    tag: `plan-${input.scheduleId}`,
    url: "/history",
  };
}

export function planLate(input: {
  scheduleId: string;
  readyBy: Date;
  now: Date;
  expectedPercent: number | null;
  targetPercent: number | null;
}): PushPayload {
  const readyBy = formatDayAndTime(input.readyBy, input.now);
  return {
    title: t.planLate.title,
    body:
      input.expectedPercent != null && input.targetPercent != null
        ? fill(t.planLate.body, { expectedPercent: input.expectedPercent, readyBy, targetPercent: input.targetPercent })
        : fill(t.planLateKwh, { readyBy }),
    tag: `plan-${input.scheduleId}`,
    url: "/",
  };
}

// (app) D68: the car stopped drawing power during Forvarm, so the cabin
// heater runs on the battery. Once per Forvarm (the tick keeps the flag).
export function preheatOnBattery(input: { chargerId: string; since: Date }): PushPayload {
  return {
    title: t.preheatOnBattery.title,
    body: fill(t.preheatOnBattery.body, { time: formatTime(input.since) }),
    tag: `preheat-${input.chargerId}`,
    url: "/?sheet=preheat",
  };
}


export function planWaitingForCar(input: {
  scheduleId: string;
  latestStart: Date;
  readyBy: Date;
  now: Date;
}): PushPayload {
  return {
    title: t.planWaitingForCar.title,
    body: fill(t.planWaitingForCar.body, {
      latestStart: formatTime(input.latestStart),
      readyBy: formatDayAndTime(input.readyBy, input.now),
    }),
    tag: `plan-${input.scheduleId}`,
    url: "/",
  };
}

export function smartPlanned(input: {
  scheduleId: string;
  targetPercent: number;
  start: Date;
  end: Date;
  costNok: number;
}): PushPayload {
  return {
    title: t.smartPlanned.title,
    body: fill(t.smartPlanned.body, {
      targetPercent: input.targetPercent,
      start: formatTime(input.start),
      end: formatTime(input.end),
      cost: formatNumber(Math.round(input.costNok), 0),
    }),
    tag: `smart-${input.scheduleId}`,
    url: "/",
    actions: [{ action: "charge-now", title: t.smartPlanned.chargeNowInstead, url: "/?action=charge-now" }],
  };
}

/** How long before the latest start a pending plan without a car gets its reminder. */
export const WAITING_FOR_CAR_LEAD_MS = 30 * 60 * 1000;

export function shouldRemindWaitingForCar(input: {
  now: Date;
  latestStart: Date;
  connected: boolean;
  alreadyNotified: boolean;
}): boolean {
  return (
    !input.connected &&
    !input.alreadyNotified &&
    input.now.getTime() >= input.latestStart.getTime() - WAITING_FOR_CAR_LEAD_MS
  );
}

/**
 * Whether a charging plan won't finish by readyBy at the current rate, and
 * the battery % it will reach by then (null without a start %).
 */
export function lateEstimate(input: {
  now: Date;
  readyBy: Date;
  remainingKwh: number;
  powerKw: number;
  deliveredKwh: number;
  startPercent: number | null;
  capacityKwh: number;
}): { late: boolean; expectedPercent: number | null } {
  if (input.powerKw <= 0 || input.remainingKwh <= 0) return { late: false, expectedPercent: null };
  const finishMs = input.now.getTime() + (input.remainingKwh / input.powerKw) * 3_600_000;
  if (finishMs <= input.readyBy.getTime()) return { late: false, expectedPercent: null };
  const hoursLeft = Math.max(0, (input.readyBy.getTime() - input.now.getTime()) / 3_600_000);
  const byReadyKwh = input.deliveredKwh + hoursLeft * input.powerKw;
  const expectedPercent =
    input.startPercent != null
      ? Math.min(100, Math.round(input.startPercent + (byReadyKwh / input.capacityKwh) * 100))
      : null;
  return { late: true, expectedPercent };
}

/** Which battery % a plan ends at: stored target, or start % + delivered energy. */
export function reachedPercent(input: {
  startPercent: number | null;
  targetPercent: number | null;
  deliveredKwh: number;
  capacityKwh: number;
}): number | null {
  if (input.startPercent == null) return input.targetPercent;
  return Math.min(100, Math.round(input.startPercent + (input.deliveredKwh / input.capacityKwh) * 100));
}

// D75: one push per incident (notifications.nb.json charge_now_*,
// car_declined_plan, fault_*). The tag is the incident, so a phone shows one
// notification per incident however it's delivered.
export type IncidentPushInput =
  | { incidentId: string; kind: "car"; carCase: "full" | "stopped" | "idle"; percent: number | null; kwh: number }
  | { incidentId: string; kind: "car"; carCase: "never"; minutes: number }
  | { incidentId: string; kind: "car"; carCase: "declinedPlan"; percent: number | null }
  | { incidentId: string; kind: "start_failed"; time: Date }
  | { incidentId: string; kind: "offline"; since: Date }
  | { incidentId: string; kind: "locked" }
  | { incidentId: string; kind: "charger_warning"; warning: string };

const percentOrDash = (percent: number | null) => (percent != null ? String(Math.round(percent)) : "–");

export function incidentPush(input: IncidentPushInput): PushPayload {
  const base = { tag: `incident-${input.incidentId}`, url: "/" };
  const text = (copy: { title: string; body: string }, values: Record<string, string | number> = {}) => ({
    ...base,
    title: copy.title,
    body: fill(copy.body, values),
  });
  switch (input.kind) {
    case "car":
      switch (input.carCase) {
        case "full":
          return text(t.carFull, { percent: percentOrDash(input.percent), kwh: formatNumber(input.kwh, 1) });
        case "stopped":
        case "idle":
          return text(t.carStopped, { percent: percentOrDash(input.percent) });
        case "never":
          return text(t.carNeverStarted, { minutes: input.minutes });
        case "declinedPlan":
          return text(t.carDeclinedPlan, { percent: percentOrDash(input.percent) });
      }
      break;
    case "start_failed":
      return text(t.faultStartFailed, { time: formatTime(input.time) });
    case "offline":
      return text(t.faultOffline, { time: formatTime(input.since) });
    case "locked":
      return text(t.faultLoopGuard);
    case "charger_warning":
      return text(t.faultWarning, { warning: capitalize(input.warning) });
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
