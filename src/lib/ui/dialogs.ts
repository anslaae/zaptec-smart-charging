import type { ConfirmOptions } from "@/components/ConfirmDialog";
import { formatDayAndTime, formatDayLabel, formatNumber, formatTime } from "@/lib/datetime";
import { fill, nb } from "@/lib/i18n/nb";

// Every confirm the app asks (HANDOFF §3b "When to confirm"), built from the
// design copy in strings.nb.json → dialogs. Pure, so the wording is tested.
// Not confirmed by design: saving a plan, Lad nå, turning automatic off.

const d = nb.dialogs;

/** "80 %" when the plan has a battery target, else "15,6 kWh" (plans from before the plan sheet). */
function planTarget(plan: { targetPercent: number | null; targetKwh: number }): string {
  return plan.targetPercent != null ? `${plan.targetPercent} %` : `${formatNumber(plan.targetKwh, 1)} kWh`;
}

export function cancelPlanDialog(
  plan: { targetPercent: number | null; targetKwh: number; readyByIso: string },
  now: Date,
): ConfirmOptions {
  return {
    title: d.cancelPlan.title,
    body: fill(d.cancelPlan.body.replace("{percent} %", "{target}"), {
      target: planTarget(plan),
      readyBy: formatTime(plan.readyByIso),
      day: formatDayLabel(plan.readyByIso, now),
    }),
    safeLabel: d.cancelPlan.safe,
    actionLabel: d.cancelPlan.action,
    tone: "danger",
    icon: "warning",
  };
}

/** Toast after a cancel: "Plan avbrutt · 80 % klar i morgen 07:30" (with Angre). */
export function planCancelledToast(
  plan: { targetPercent: number | null; targetKwh: number; readyByIso: string },
  now: Date,
) {
  return {
    title: nb.toasts.planCancelled.title,
    body: fill(nb.toasts.planCancelled.body.replace("{percent} %", "{target}"), {
      target: planTarget(plan),
      readyBy: formatDayAndTime(plan.readyByIso, now),
    }),
  };
}

export function stopChargingDialog(session: { kwh: number; percent: number | null }): ConfirmOptions {
  return {
    title: d.stopCharging.title,
    body:
      session.percent != null
        ? fill(d.stopCharging.body, { kwh: formatNumber(session.kwh, 1), percent: session.percent })
        : fill(d.stopChargingNoPercent, { kwh: formatNumber(session.kwh, 1) }),
    safeLabel: d.stopCharging.safe,
    actionLabel: d.stopCharging.action,
    tone: "danger",
    icon: "stop",
  };
}

export function stopPreheatDialog(): ConfirmOptions {
  return {
    title: d.stopPreheat.title,
    body: d.stopPreheat.body,
    safeLabel: d.stopPreheat.safe,
    actionLabel: d.stopPreheat.action,
    tone: "danger",
    icon: "stop",
  };
}

/** Lad nå / Forvarm while a plan is open: starting cancels it (DECISIONS.md D27). */
export function planConflictDialog(
  text: { title: string; body: string; confirm: string },
  readyBy: string,
): ConfirmOptions {
  return {
    title: text.title,
    body: fill(text.body, { readyBy }),
    safeLabel: d.cancelPlan.safe,
    actionLabel: text.confirm,
    icon: "bolt",
  };
}

export function lendDialog(car: string, planReadyBy: string | null): ConfirmOptions {
  const body = fill(d.lendCharger.body, { car });
  return {
    title: d.lendCharger.title,
    body: planReadyBy ? `${body} ${fill(d.lendCancelsPlan, { readyBy: planReadyBy })}` : body,
    safeLabel: d.lendCharger.safe,
    actionLabel: d.lendCharger.action,
    icon: "guest",
    textField: {
      name: "guestName",
      label: d.lendCharger.nameLabel,
      hint: d.lendCharger.nameOptional,
      placeholder: d.lendCharger.namePlaceholder,
    },
  };
}

export function logoutDialog(): ConfirmOptions {
  return {
    title: d.logout.title,
    body: d.logout.body,
    safeLabel: d.logout.safe,
    actionLabel: d.logout.action,
    tone: "danger",
    icon: "logout",
  };
}
