"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BatteryRing, type RingBadge, type RingMode } from "@/components/BatteryRing";
import { MyOpelLink } from "@/components/MyOpelLink";
import { SubmitButton } from "@/components/SubmitButton";
import { ActionButton } from "@/components/ActionButton";
import { BatteryTodayCard, LastSessionCard } from "@/components/HomeExtraCards";
import { SmartTimeline } from "@/components/SmartTimeline";

/** Smart lading says "Lader i natt 03:46–06:00" for a night window, "Lader 13:00–15:00" otherwise. */
const isDaytime = (iso: string) => {
  const hour = osloHour(new Date(iso));
  return hour >= 6 && hour < 22;
};
import { useDebugScenario } from "@/components/DebugProvider";
import { DEBUG_SCENARIOS } from "@/lib/debug/scenarios";
import { homeState, type HomeState } from "@/lib/ui/homeState";
import { estimateBattery } from "@/lib/ui/battery";
import { planDeliveredNow } from "@/lib/scheduler/engine";
import { sessionCost } from "@/lib/pricing";
import type { HomeCardData } from "@/lib/ui/homeData";
import { isCurrentlyCharging } from "@/lib/zaptec/state";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import { relativeDay, osloHour, formatDayLabel, formatDayAndTime, formatDuration, formatKr, formatKwh, formatNumber, formatTime } from "@/lib/datetime";
import { nb, fill } from "@/lib/i18n/nb";
import { endLending, startChargingNow, startPreheat, stopChargingNow } from "@/lib/zaptec/actions";
import { cancelSchedule, createSchedule, restoreSchedule, type CreateScheduleState } from "@/lib/schedules/actions";
import {
  cancelPlanDialog,
  planCancelledToast,
  planConflictDialog,
  stopChargingDialog,
  stopPreheatDialog,
} from "@/lib/ui/dialogs";

const primaryClass =
  "flex h-[52px] w-full items-center justify-center rounded-[var(--radius-button)] bg-accent px-4 text-base font-semibold text-on-accent";
const secondaryClass =
  "flex h-12 w-full items-center justify-center rounded-[var(--radius-button)] border border-border bg-surface px-4 text-[15px] font-semibold text-text";

// Engine reasons are stored in English (they double as log text); the one a
// household member can see on Hjem gets a Norwegian line.
const LAST_ERROR_NB: Record<string, string> = {
  "Needs to charge but no car is connected": nb.home.lastErrorNoCar,
};

const kwNumber = (kw: number | null) => (kw != null ? formatNumber(kw, 1) : "–");

// "Bruk" on the suggestion card: creates last time's plan for tomorrow
// straight away (createSchedule redirects back with a toast on success).
function UseSuggestionButton({
  chargerId,
  chargerName,
  suggestion,
}: {
  chargerId: string;
  chargerName: string;
  suggestion: NonNullable<HomeCardData["suggestion"]>;
}) {
  const [state, formAction] = useActionState<CreateScheduleState, FormData>(createSchedule, {});
  useEffect(() => {
    if (state.error) toast.error(nb.toasts.planSaveFailed.title, { description: state.error });
  }, [state]);
  return (
    <form action={formAction}>
      <input type="hidden" name="chargerId" value={chargerId} />
      <input type="hidden" name="chargerName" value={chargerName} />
      <input type="hidden" name="targetEnergyKwh" value={suggestion.targetKwh} />
      <input type="hidden" name="readyBy" value={suggestion.readyByLocal} />
      {suggestion.targetPercent != null && suggestion.startPercent != null && (
        <>
          <input type="hidden" name="startPercent" value={suggestion.startPercent} />
          <input type="hidden" name="targetPercent" value={suggestion.targetPercent} />
        </>
      )}
      <SubmitButton
        pendingLabel={nb.actions.working}
        className="flex h-11 min-w-16 items-center justify-center rounded-[var(--radius-chip)] border border-accent-tint-border bg-accent-tint px-4 text-sm font-semibold text-accent"
      >
        {nb.home.connected.useSuggestion}
      </SubmitButton>
    </form>
  );
}

interface View {
  homeState: HomeState;
  status: string;
  statusAmber: boolean;
  sub: string | null;
  note: string | null;
  ring: RingMode;
  ringLabel: string;
  stats: { delivered: string; time: string; cost: string } | null;
  planRow: string | null;
  /** Battery estimate now (for the stop dialog); null without a reading. */
  batteryPercent: number | null;
  ringBadge?: RingBadge;
  /** Smart lading pill above the status line. */
  pill?: string;
}

function buildView(data: HomeCardData): View {
  const now = new Date(data.nowIso);
  const { state, schedule } = data;
  const state_ = homeState({
    state,
    schedule,
    openSession: data.openSession,
    lastCompletedPlanSessionId: data.lastCompletedPlanSessionId,
  });

  const charging = isCurrentlyCharging(state);
  const kw = state.instantPowerWatts != null && state.instantPowerWatts > 0 ? state.instantPowerWatts / 1000 : null;
  const sessionKwh = state.sessionEnergyKwh ?? 0;
  const planDeliveredKwh = schedule ? schedule.deliveredKwh : 0;
  const remainingPlanKwh =
    schedule && (schedule.status === "pending" || schedule.status === "active")
      ? Math.max(0, schedule.targetEnergyKwh - planDeliveredKwh)
      : null;

  const battery = estimateBattery({
    reading: data.stateOfCharge
      ? { percent: data.stateOfCharge.percent, oemUpdatedAt: new Date(data.stateOfCharge.oemUpdatedAtIso) }
      : null,
    capacityKwh: data.capacityKwh,
    now,
    charging,
    sessionEnergyKwh: state.sessionEnergyKwh,
    chargeDurationSeconds: state.chargeDurationSeconds,
    remainingPlanKwh,
  });
  const measuredCaption = battery.measuredAt ? fill(nb.battery.measured, { time: formatTime(battery.measuredAt) }) : null;

  const percentRing = (): RingMode => {
    if (battery.percent != null) {
      const caption =
        battery.targetPercent != null && battery.targetPercent > battery.percent
          ? fill(nb.battery.target, { percent: battery.targetPercent })
          : measuredCaption;
      return { kind: "percent", percent: battery.percent, targetPercent: battery.targetPercent, approx: battery.approx, caption };
    }
    // No Smartcar reading: show plan progress in kWh instead.
    if (schedule && remainingPlanKwh != null) {
      return {
        kind: "kwh",
        deliveredKwh: planDeliveredKwh,
        targetKwh: schedule.targetEnergyKwh,
        caption: fill(nb.home.ringOf, { kwh: formatKwh(schedule.targetEnergyKwh) }),
      };
    }
    return { kind: "empty" };
  };
  const ringLabel =
    battery.percent != null
      ? `${battery.approx ? `${nb.battery.approx} ` : ""}${battery.percent} %`
      : schedule
        ? `${formatKwh(planDeliveredKwh)} av ${formatKwh(schedule.targetEnergyKwh)}`
        : nb.home.noCar.status;

  const readyBy = schedule ? formatDayAndTime(schedule.readyByIso, now) : "";
  // All three figures are for the current charging session (handoff: "Levert
  // (session kWh), Tid, Kostnad"), so they always describe the same thing.
  const stats =
    charging && (state_ === "chargingPlan" || state_ === "chargingManual")
      ? {
          delivered: formatKwh(sessionKwh),
          time: state.chargeDurationSeconds != null ? formatDuration(state.chargeDurationSeconds) : "–",
          // The session so far, from when charging started (Zaptec's duration).
          cost: formatKr(
            sessionCost(
              sessionKwh,
              new Date(now.getTime() - (state.chargeDurationSeconds ?? 0) * 1000),
              now,
              data.prices,
            ).totalNok,
          ),
        }
      : null;

  const base = {
    homeState: state_,
    statusAmber: false,
    sub: null,
    note: null,
    stats,
    planRow: null,
    ringLabel,
    batteryPercent: battery.percent,
  };

  switch (state_) {
    case "noControl":
      return {
        ...base,
        status: state.operationMode === ChargerOperationMode.Disconnected ? nb.home.noControlNoCar : nb.home.noControl.status,
        statusAmber: true,
        sub: nb.home.noControl.sub,
        ring: percentRing(),
      };
    case "noCar": {
      // HANDOFF §3: the car's battery is known even unplugged (Smartcar), so the
      // ring shows the last reading with "målt" and an unplugged badge, and the
      // status says only that it's not plugged in. The % appears once, in the ring.
      const last = state.lastCompletedSession?.endedAt;
      const reading = data.stateOfCharge;
      if (battery.percent == null || !reading) {
        return {
          ...base,
          status: nb.home.noCar.statusNoBattery,
          sub: last ? fill(nb.home.noCar.subNoBattery, { when: formatDayAndTime(last, now) }) : null,
          note: nb.home.noCar.hint,
          ring: { kind: "noCar", caption: null },
          ringLabel: nb.home.noCar.statusNoBattery,
        };
      }
      const measured = relativeDay(reading.oemUpdatedAtIso, now) === "i dag"
        ? formatTime(reading.oemUpdatedAtIso)
        : formatDayAndTime(reading.oemUpdatedAtIso, now);
      return {
        ...base,
        status: nb.home.noCar.status,
        sub: fill(nb.home.noCar.sub, { kwh: formatNumber((battery.percent / 100) * data.capacityKwh, 0) }),
        note: nb.home.noCar.hint,
        ring: { kind: "noCar", percent: battery.percent, caption: fill(nb.battery.measured, { time: measured }) },
        ringBadge: "unplugged",
        ringLabel: fill(nb.battery.lastMeasuredLabel, { percent: battery.percent, when: measured }),
      };
    }
    case "planWaiting": {
      const lateError = schedule?.lastError ? (LAST_ERROR_NB[schedule.lastError] ?? schedule.lastError) : null;
      return {
        ...base,
        status: nb.home.planWaiting.status,
        statusAmber: Boolean(lateError) || data.startsImmediately,
        sub: lateError
          ? lateError
          : data.startTimeIso
            ? fill(nb.home.planWaiting.sub, { time: formatTime(data.startTimeIso), readyBy })
            : null,
        ring: percentRing(),
      };
    }
    case "connected":
      return { ...base, status: nb.home.connected.status, sub: nb.home.connected.sub, ring: percentRing() };
    case "planned": {
      const kwh = remainingPlanKwh != null ? formatNumber(remainingPlanKwh, 1) : "–";
      return {
        ...base,
        status: data.startsImmediately
          ? nb.home.planned.tooTight
          : data.startTimeIso
            ? fill(nb.home.planned.status, { time: formatTime(data.startTimeIso) })
            : nb.home.plannedNoTime,
        statusAmber: data.startsImmediately,
        sub: schedule ? fill(nb.home.planned.sub, { readyBy, kwh }) : null,
        note:
          data.learnedPowerKw != null
            ? fill(nb.home.planned.timelineNote, { kw: kwNumber(data.learnedPowerKw) })
            : null,
        ring: percentRing(),
      };
    }
    case "chargingPlan": {
      const finish =
        kw != null && remainingPlanKwh != null ? new Date(now.getTime() + (remainingPlanKwh / kw) * 3_600_000) : null;
      return {
        ...base,
        status: finish ? fill(nb.home.chargingPlan.status, { time: formatTime(finish) }) : nb.home.chargingPlanNoTime,
        sub: fill(nb.home.chargingPlan.sub, { readyBy, kw: kwNumber(kw) }),
        planRow:
          (schedule?.targetPercent ?? battery.targetPercent) != null
            ? fill(nb.home.chargingPlan.planRow, { percent: (schedule?.targetPercent ?? battery.targetPercent)!, readyBy })
            : schedule
              ? fill(nb.home.planRowKwh, { kwh: formatKwh(schedule.targetEnergyKwh), readyBy })
              : null,
        ring: percentRing(),
      };
    }
    case "chargingManual": {
      const automatic = data.openSession?.kind === "automatic";
      return {
        ...base,
        status: !charging
          ? nb.home.chargingManualIdle
          : automatic
            ? kw != null
              ? fill(nb.home.chargingAutomatic, { kw: kwNumber(kw) })
              : nb.home.chargingAutomaticNoKw
            : kw != null
              ? fill(nb.home.chargingManual.status, { kw: kwNumber(kw) })
              : nb.home.chargingManualNoKw,
        ring: percentRing(),
      };
    }
    case "smartWaiting":
    case "smartCharging": {
      // Smart lading (UC16, HANDOFF §6b): the planned window, or charging in it.
      const blocks = schedule?.smart?.blocks ?? [];
      const first = blocks[0];
      const last = blocks[blocks.length - 1];
      const finish =
        kw != null && remainingPlanKwh != null ? new Date(now.getTime() + (remainingPlanKwh / kw) * 3_600_000) : null;
      const night = first ? !isDaytime(first.start) : true;
      return {
        ...base,
        pill: nb.home.smart.pill,
        status:
          state_ === "smartCharging"
            ? finish
              ? fill(nb.home.smart.charging, { time: formatTime(finish) })
              : nb.home.chargingPlanNoTime
            : first && last
              ? fill(night ? nb.home.smart.status : nb.home.smart.statusDay, {
                  start: formatTime(first.start),
                  end: formatTime(last.end),
                })
              : nb.home.plannedNoTime,
        sub: schedule
          ? fill(nb.home.smart.sub, {
              readyBy: formatTime(schedule.readyByIso),
              day: formatDayLabel(schedule.readyByIso, now),
              kwh: formatNumber(remainingPlanKwh ?? schedule.targetEnergyKwh, 1),
            })
          : null,
        ring: percentRing(),
      };
    }
    case "guest": {
      // UC15: the guest's car, not ours -- no battery, no plan, no stats.
      const connected = state.operationMode !== ChargerOperationMode.Disconnected;
      return {
        ...base,
        stats: null,
        status: !connected
          ? nb.home.guest.statusWaiting
          : charging
            ? fill(nb.home.guest.statusCharging, { kw: kwNumber(kw) })
            : nb.home.guest.statusConnected,
        sub: [
          data.openSession?.guestName ? fill(nb.home.guest.lentTo, { name: data.openSession.guestName }) : null,
          connected && sessionKwh > 0 ? formatKwh(sessionKwh) : null,
          nb.home.guest.sub,
        ]
          .filter(Boolean)
          .join(" · "),
        ring: connected ? { kind: "empty" } : { kind: "noCar", caption: null },
        ringLabel: nb.home.guest.statusWaiting,
      };
    }
    case "preheating": {
      const startedAt = data.openSession ? new Date(data.openSession.startedAtIso) : null;
      return {
        ...base,
        status: nb.home.preheating.status,
        sub: startedAt
          ? fill(nb.home.preheating.sub, {
              time: formatTime(startedAt),
              kw: kwNumber(kw),
              duration: formatDuration((now.getTime() - startedAt.getTime()) / 1000),
            })
          : null,
        note: nb.home.preheating.autoStopNote,
        ring: { kind: "preheat", percent: battery.percent, caption: battery.percent != null ? `${battery.percent} %` : null },
        ringLabel: nb.home.preheating.status,
      };
    }
    case "ready": {
      // HANDOFF §3: "Bilen er klar" + when it finished vs the deadline; the
      // ring sits at the reached % with the target tick and a check badge.
      const plan = data.lastPlan;
      let sub: string | null = null;
      let late = false;
      if (plan?.endedAtIso) {
        const minutesEarly = Math.round((Date.parse(plan.readyByIso) - Date.parse(plan.endedAtIso)) / 60_000);
        late = minutesEarly < 0;
        sub = fill((late ? nb.home.ready.subLate : nb.home.ready.sub).replace("{minutes} min", "{duration}"), {
          time: formatTime(plan.endedAtIso),
          duration: formatDuration(Math.abs(minutesEarly) * 60),
          readyBy: formatTime(plan.readyByIso),
        });
      }
      const reached = plan?.reachedPercent ?? battery.percent;
      return {
        ...base,
        status: nb.home.ready.status,
        sub,
        statusAmber: late,
        ring:
          reached != null
            ? {
                kind: "percent",
                percent: reached,
                targetPercent: plan?.targetPercent ?? null,
                approx: plan?.reachedPercent == null && battery.approx,
                caption: nb.home.ready.targetReached,
              }
            : percentRing(),
        ringBadge: "check",
        ringLabel: reached != null ? `${nb.home.ready.status}, ${reached} %` : nb.home.ready.status,
      };
    }
  }
}

/** The Hjem hero card for one charger: ring, status, and the one primary action for its state. */
export function HomeCard({ data }: { data: HomeCardData }) {
  // A debug scenario is a pure front-end preview: it replaces the displayed
  // data, and every real action is swapped for a note so a click can't send a
  // Zaptec command based on fake state.
  const debug = useDebugScenario();
  const scenario = debug.enabled && debug.scenario !== "real" ? DEBUG_SCENARIOS[debug.scenario] : null;
  const effective: HomeCardData = scenario
    ? {
        ...data,
        state: scenario.state,
        schedule: scenario.schedule
          ? {
              id: scenario.schedule.id,
              status: scenario.schedule.status,
              targetEnergyKwh: Number(scenario.schedule.targetEnergyKwh),
              readyByIso: scenario.schedule.readyBy.toISOString(),
              lastError: scenario.schedule.lastError,
              deliveredKwh: planDeliveredNow(
                {
                  zaptecSessionId: scenario.schedule.zaptecSessionId,
                  priorSessionEnergyKwh: Number(scenario.schedule.priorSessionEnergyKwh ?? 0),
                  lastObservedSessionEnergyKwh: Number(scenario.schedule.lastObservedSessionEnergyKwh ?? 0),
                },
                scenario.state,
              ),
              targetPercent: scenario.schedule.targetPercent,
              source: scenario.schedule.source,
              smart: (scenario.schedule.blocks as NonNullable<HomeCardData["schedule"]>["smart"]) ?? null,
            }
          : null,
        startTimeIso: scenario.startTime,
        startsImmediately: scenario.startsImmediately ?? false,
        openSession: scenario.openSession
          ? { kind: scenario.openSession.kind, startedAtIso: scenario.openSession.startedAt }
          : null,
        lastCompletedPlanSessionId: scenario.lastCompletedPlanSessionId,
        stateOfCharge: scenario.stateOfCharge
          ? { percent: scenario.stateOfCharge.percent, oemUpdatedAtIso: scenario.stateOfCharge.oemUpdatedAt.toISOString() }
          : null,
        // Preview-only; the "Bruk" button is hidden in preview, so readyByLocal is never submitted.
        suggestion: {
          targetKwh: 15.6,
          targetPercent: 80,
          startPercent: 46,
          readyByLocal: "",
          readyByIso: new Date(new Date(data.nowIso).getTime() + 10 * 3_600_000).toISOString(),
        },
      }
    : data;

  const view = buildView(effective);
  const { chargerId, chargerName, schedule } = effective;
  const router = useRouter();
  const planHref = "/?sheet=plan";
  const now = new Date(effective.nowIso);
  const scheduleForDialog = schedule
    ? { targetPercent: schedule.targetPercent, targetKwh: schedule.targetEnergyKwh, readyByIso: schedule.readyByIso }
    : null;

  // With an open plan, Lad nå / Forvarm cancel it (after asking) -- the
  // scheduler would otherwise pause them again within a minute.
  // Smart lading steps aside without asking (HANDOFF §6b); only a user plan asks.
  const openPlan =
    schedule && (schedule.status === "pending" || schedule.status === "active") && schedule.source !== "smart"
      ? schedule
      : null;
  const startForm = () => {
    const fd = new FormData();
    if (openPlan) fd.set("cancelPlan", "1");
    return fd;
  };
  const planReadyBy = openPlan ? formatDayAndTime(openPlan.readyByIso, new Date(effective.nowIso)) : "";
  const chargeNow = (
    <ActionButton
      action={() => startChargingNow(chargerId, chargerName, {}, startForm())}
      confirm={openPlan ? planConflictDialog(nb.actions.chargeNowCancelsPlan, planReadyBy) : undefined}
      label={nb.home.connected.chargeNow}
      className={secondaryClass}
      success={nb.toasts.chargingStarted.title}
      errorMessage={nb.actions.chargeStartFailed}
    />
  );
  const preheat = (
    <ActionButton
      action={() => startPreheat(chargerId, chargerName, {}, startForm())}
      confirm={openPlan ? planConflictDialog(nb.actions.preheatCancelsPlan, planReadyBy) : undefined}
      label={nb.home.connected.preheat}
      pendingLabel={nb.preheatSheet.starting}
      className={secondaryClass}
      success={nb.actions.preheatStarted}
      errorMessage={nb.actions.preheatFailed}
      onSuccess={() => router.push("/?sheet=preheat", { scroll: false })}
    />
  );
  const cancelPlan = (className: string, label: string = nb.planSheet.cancel) =>
    schedule && (
      <ActionButton
        action={() => cancelSchedule(schedule.id, {}, new FormData())}
        label={label}
        className={className}
        success={planCancelledToast(scheduleForDialog!, now)}
        errorMessage={nb.actions.planCancelFailed}
        confirm={cancelPlanDialog(scheduleForDialog!, now)}
        undo={{ action: () => restoreSchedule(schedule.id), success: nb.toasts.planRestored }}
      />
    );
  const stop = (label: string, preheat = false, className = primaryClass) => (
    <ActionButton
      action={() => stopChargingNow(chargerId, chargerName, {}, new FormData())}
      label={label}
      className={className}
      confirm={
        preheat
          ? stopPreheatDialog()
          : stopChargingDialog({
              kwh: effective.state.sessionEnergyKwh ?? 0,
              percent: view.homeState === "guest" ? null : view.batteryPercent,
            })
      }
      success={nb.toasts.chargingStopped.title}
      errorMessage={nb.actions.chargeStopFailed}
    />
  );
  const planLink = (label: string) => (
    <Link href={planHref} scroll={false} className={primaryClass}>
      {label}
    </Link>
  );

  let actions: React.ReactNode = null;
  switch (view.homeState) {
    case "noCar":
      actions = planLink(nb.home.noCar.primary);
      break;
    case "planWaiting":
      actions = (
        <>
          {planLink(nb.home.planWaiting.primary)}
          {cancelPlan("flex h-11 w-full items-center justify-center text-[15px] font-semibold text-red")}
        </>
      );
      break;
    case "connected":
      actions = (
        <>
          {planLink(nb.home.connected.primary)}
          <div className="grid grid-cols-2 gap-2">
            {chargeNow}
            {preheat}
          </div>
        </>
      );
      break;
    case "planned":
      actions = (
        <>
          {planLink(nb.home.planned.primary)}
          <div className="grid grid-cols-2 gap-2">
            {chargeNow}
            {preheat}
          </div>
        </>
      );
      break;
    case "smartWaiting":
      actions = (
        <>
          {planLink(nb.home.smart.primary)}
          <div className="grid grid-cols-2 gap-2">
            {chargeNow}
            {preheat}
          </div>
        </>
      );
      break;
    case "smartCharging":
      actions = cancelPlan(primaryClass, nb.home.smart.primaryCharging);
      break;
    case "chargingPlan":
      actions = cancelPlan(primaryClass);
      break;
    case "chargingManual":
      actions = stop(nb.home.chargingManual.primary);
      break;
    case "preheating":
      actions = stop(nb.home.preheating.primary, true);
      break;
    case "ready":
      actions = (
        <>
          {planLink(nb.home.ready.primary)}
          <div className="grid grid-cols-2 gap-2">
            {chargeNow}
            {preheat}
          </div>
        </>
      );
      break;
    case "guest":
      // Lending only rules out plans (D29); Lad nå and Stopp work as usual.
      actions = (
        <>
          {isCurrentlyCharging(effective.state)
            ? stop(nb.home.chargingManual.primary)
            : effective.state.operationMode !== ChargerOperationMode.Disconnected && chargeNow}
          <ActionButton
            action={() => endLending(chargerId, chargerName, {}, new FormData())}
            label={nb.home.guest.primary}
            className={secondaryClass}
            success={nb.home.guest.ended}
            errorMessage={nb.home.guest.endFailed}
          />
        </>
      );
      break;
    case "noControl":
      actions = null;
      break;
  }

  return (
    <div className="flex flex-col gap-3">
      {view.homeState === "noControl" && (
        <div className="rounded-[var(--radius-card)] border border-amber-border bg-amber-bg p-4">
          <p className="text-[15px] font-semibold text-amber">{nb.home.noControl.title}</p>
          <p className="mt-1 text-sm text-text-2">{nb.home.noControl.body}</p>
          <Link href="/settings" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-amber">
            {nb.home.noControl.link}
          </Link>
        </div>
      )}

      <section className="flex flex-col gap-4 rounded-[var(--radius-hero)] border border-border bg-surface p-5">
        {scenario && (
          <p className="rounded-[var(--radius-chip)] bg-amber-bg px-3 py-1.5 text-xs font-semibold text-amber">
            {fill(nb.debug.preview, { label: scenario.label })}
          </p>
        )}
        {!effective.state.isOnline && <p className="text-sm font-semibold text-amber">{nb.home.offline}</p>}

        <BatteryRing
          mode={view.ring}
          label={view.ringLabel}
          charging={isCurrentlyCharging(effective.state)}
          badge={view.ringBadge}
        />

        <div className="text-center">
          {view.pill && (
            <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-accent-tag px-2.5 py-0.5 text-xs font-semibold text-accent">
              {view.pill}
            </span>
          )}
          <p className={`text-xl font-semibold ${view.statusAmber ? "text-amber" : "text-text"}`}>{view.status}</p>
          {view.sub && <p className="mt-1 text-[15px] text-muted">{view.sub}</p>}
        </div>

        {view.stats && (
          <dl className="grid grid-cols-3 divide-x divide-divider rounded-[var(--radius-card)] bg-surface-2 py-3 text-center">
            <div>
              <dt className="text-xs text-muted">{nb.home.stats.delivered}</dt>
              <dd className="mt-0.5 text-[15px] font-semibold">{view.stats.delivered}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{nb.home.stats.time}</dt>
              <dd className="mt-0.5 text-[15px] font-semibold">{view.stats.time}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{nb.home.stats.cost}</dt>
              <dd className="mt-0.5 text-[15px] font-semibold">{view.stats.cost}</dd>
            </div>
          </dl>
        )}

        {/* Secondary cards (HANDOFF §3); hidden in debug previews, whose data is made up. */}
        {!scenario && view.homeState === "noCar" && effective.batteryToday && (
          <BatteryTodayCard data={effective.batteryToday} now={new Date(effective.nowIso)} />
        )}
        {!scenario && view.homeState === "ready" && effective.lastPlan && <LastSessionCard plan={effective.lastPlan} />}
        {view.homeState === "smartWaiting" && schedule?.smart && (
          <SmartTimeline
            data={{
              nowIso: effective.nowIso,
              readyByIso: schedule.readyByIso,
              blocks: schedule.smart.blocks,
              costNok: schedule.smart.costNok,
              nowCostNok: schedule.smart.nowCostNok,
            }}
          />
        )}

        {view.planRow && (
          <div className="flex items-center justify-between gap-2 rounded-[var(--radius-card)] bg-surface-2 px-4 py-3">
            {/* No "Endre" while it charges (D55): stop it and plan again. */}
            <span className="text-sm text-text-2">{view.planRow}</span>
          </div>
        )}

        {view.homeState === "connected" && effective.suggestion && (
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-accent-tint-border bg-accent-tint px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.04em] text-accent">{nb.home.connected.suggestion}</p>
              <p className="mt-0.5 text-sm text-text-2">
                {fill(effective.suggestion.targetPercent != null ? nb.home.suggestionDetailPercent : nb.home.suggestionDetail, {
                  percent: effective.suggestion.targetPercent ?? "",
                  kwh: formatNumber(effective.suggestion.targetKwh, 1),
                  time: formatTime(effective.suggestion.readyByIso),
                })}
              </p>
            </div>
            {!scenario && (
              <UseSuggestionButton chargerId={chargerId} chargerName={chargerName} suggestion={effective.suggestion} />
            )}
          </div>
        )}

        {view.homeState === "preheating" && (
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-surface-2 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{nb.home.preheating.climatePrompt}</p>
              <p className="text-xs text-muted">{nb.home.preheating.climateSub}</p>
            </div>
            <MyOpelLink
              label={nb.home.preheating.openMyOpel}
              className="flex h-11 shrink-0 items-center justify-center rounded-[var(--radius-chip)] border border-border bg-surface px-3 text-sm font-semibold"
            />
          </div>
        )}

        {view.note && <p className="text-center text-xs text-muted">{view.note}</p>}

        {scenario ? (
          <p className="text-center text-xs text-muted">{nb.actions.previewNote}</p>
        ) : (
          actions && <div className="flex flex-col gap-2">{actions}</div>
        )}
      </section>
    </div>
  );
}
