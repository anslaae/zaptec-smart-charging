"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BottomSheet, useCloseSheet } from "@/components/BottomSheet";
import { SubmitButton } from "@/components/SubmitButton";
import { createSchedule, cancelSchedule, restoreSchedule, type CreateScheduleState } from "@/lib/schedules/actions";
import { cancelPlanDialog, planCancelledToast } from "@/lib/ui/dialogs";
import { ActionButton } from "@/components/ActionButton";
import { endLending } from "@/lib/zaptec/actions";
import { latestStartFor } from "@/lib/scheduler/engine";
import {
  HOUSEHOLD_TIME_ZONE,
  formatDayLabel,
  formatNumber,
  formatTime,
  zonedDateKey,
  zonedDateTimeToUtc,
} from "@/lib/datetime";
import { fill, nb } from "@/lib/i18n/nb";

const t = nb.planSheet;

export interface PlanSheetData {
  chargerId: string;
  chargerName: string;
  nowIso: string;
  connected: boolean;
  /** Best estimate of the battery now (Smartcar reading + energy since). */
  battery: { percent: number; measuredAtIso: string; approx: boolean } | null;
  capacityKwh: number;
  /** kW the estimate uses: learned rate, else the circuit max. */
  powerKw: number;
  /** Set when a pending/active plan exists -- the sheet edits it (cancel + create). */
  plan: { id: string; targetPercent: number | null; targetKwh: number; readyByIso: string } | null;
  /** Default "Klar til" time for a new plan, "HH:MM" (last plan's time, else 07:30). */
  defaultTime: string;
}

type Day = "today" | "tomorrow" | "pick";
const TIME_OPTIONS = t.times as readonly string[];
const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, m) => String(m * 5).padStart(2, "0"));

function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const chip = (selected: boolean) =>
  `flex h-11 items-center justify-center rounded-[var(--radius-chip)] border px-3 text-[15px] font-semibold ${
    selected ? "border-accent bg-accent-tint text-accent" : "border-border bg-surface text-text"
  }`;

// Planlegg / Endre plan (design/redesign/HANDOFF.md §4, use cases UC1-UC3).
// The person picks a battery target in %; the plan is saved as kWh (what the
// scheduler acts on) plus the start/target % (history and notifications).
export function PlanSheet({ data }: { data: PlanSheetData }) {
  const now = useMemo(() => new Date(data.nowIso), [data.nowIso]);
  const todayKey = zonedDateKey(now, HOUSEHOLD_TIME_ZONE);
  const tomorrowKey = addDays(todayKey, 1);

  const initial = useMemo(() => {
    if (data.plan) {
      const readyBy = new Date(data.plan.readyByIso);
      const key = zonedDateKey(readyBy, HOUSEHOLD_TIME_ZONE);
      return {
        day: (key === todayKey ? "today" : key === tomorrowKey ? "tomorrow" : "pick") as Day,
        date: key,
        time: formatTime(readyBy),
        target: data.plan.targetPercent ?? 80,
      };
    }
    return { day: "tomorrow" as Day, date: tomorrowKey, time: data.defaultTime, target: 80 };
  }, [data.plan, data.defaultTime, todayKey, tomorrowKey]);

  const [batteryNow, setBatteryNow] = useState(() => (data.battery ? Math.round(data.battery.percent) : 50));
  const [target, setTarget] = useState(initial.target);
  const [day, setDay] = useState<Day>(initial.day);
  const [pickedDate, setPickedDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [otherTime, setOtherTime] = useState(!TIME_OPTIONS.includes(initial.time));

  const dateKey = day === "today" ? todayKey : day === "tomorrow" ? tomorrowKey : pickedDate;
  const readyByLocal = `${dateKey}T${time}`;
  const readyBy = zonedDateTimeToUtc(readyByLocal, HOUSEHOLD_TIME_ZONE);
  const kwh = Math.max(0, Math.round(((target - batteryNow) / 100) * data.capacityKwh * 10) / 10);
  const start = latestStartFor(kwh, data.powerKw, readyBy);

  const targetTooLow = target <= batteryNow;
  const inPast = Number.isNaN(readyBy.getTime()) || readyBy.getTime() <= now.getTime();
  const tight = !inPast && start.getTime() <= now.getTime();
  const readyByText = formatTime(readyBy);
  const dayText = Number.isNaN(readyBy.getTime()) ? "" : formatDayLabel(readyBy, now);

  const [state, formAction] = useActionState<CreateScheduleState, FormData>(createSchedule, {});
  useEffect(() => {
    if (state.error) toast.error(nb.toasts.planSaveFailed.title, { description: state.error });
  }, [state]);

  const batteryHint = !data.battery
    ? t.batteryHintNoReading
    : fill(data.battery.approx ? t.batteryHintEstimated : t.batteryHint, {
        time: formatTime(data.battery.measuredAtIso),
      });

  return (
    <BottomSheet title={data.plan ? t.titleEdit : t.titleNew}>
      <form action={formAction} className="flex flex-col gap-5">
        <input type="hidden" name="chargerId" value={data.chargerId} />
        <input type="hidden" name="chargerName" value={data.chargerName} />
        <input type="hidden" name="targetEnergyKwh" value={kwh} />
        <input type="hidden" name="readyBy" value={readyByLocal} />
        <input type="hidden" name="startPercent" value={batteryNow} />
        <input type="hidden" name="targetPercent" value={target} />
        {data.plan && <input type="hidden" name="replaceScheduleId" value={data.plan.id} />}

        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="battery-now" className="text-[15px] font-semibold">
              {t.batteryNow}
            </label>
            <span className="text-xl font-semibold tabular-nums">{batteryNow} %</span>
          </div>
          <input
            id="battery-now"
            type="range"
            min={0}
            max={100}
            step={1}
            value={batteryNow}
            onChange={(event) => setBatteryNow(Number(event.target.value))}
            className="battery-slider mt-3 w-full"
            style={{
              background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${batteryNow}%, var(--track) ${batteryNow}%, var(--track) 100%)`,
            }}
          />
          <p className="mt-2 text-xs text-muted">{batteryHint}</p>
        </div>

        <fieldset>
          <legend className="text-[15px] font-semibold">{t.chargeTo}</legend>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {t.targets.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={target === value}
                onClick={() => setTarget(value)}
                className={chip(target === value)}
              >
                {value} %
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-[15px] font-semibold">{t.readyBy}</legend>
          <div className="mt-2 grid grid-cols-3 gap-1 rounded-[var(--radius-chip)] bg-surface-2 p-1">
            {(["today", "tomorrow", "pick"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={day === value}
                onClick={() => setDay(value)}
                className={`flex h-10 items-center justify-center rounded-[10px] text-sm font-semibold ${
                  day === value ? "bg-surface text-text shadow-sm" : "text-muted"
                }`}
              >
                {t.day[value]}
              </button>
            ))}
          </div>
          {day === "pick" && (
            <label className="mt-2 flex items-center justify-between gap-3 text-sm">
              <span className="text-muted">{t.date}</span>
              <input
                type="date"
                value={pickedDate}
                min={todayKey}
                onChange={(event) => setPickedDate(event.target.value)}
                className="h-11 rounded-[var(--radius-chip)] border border-border bg-surface px-3 text-[15px]"
              />
            </label>
          )}
          <div className="mt-2 grid grid-cols-5 gap-2">
            {TIME_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={!otherTime && time === value}
                onClick={() => {
                  setOtherTime(false);
                  setTime(value);
                }}
                className={chip(!otherTime && time === value)}
              >
                {value}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={otherTime}
              onClick={() => setOtherTime(true)}
              className={`${chip(otherTime)} ${otherTime ? "" : "border-dashed"}`}
            >
              {t.otherTime}
            </button>
          </div>
          {otherTime && (
            // Plain selects instead of <input type="time">: the native picker
            // shows AM/PM on some phones and can freeze in an iOS home-screen
            // app (see the note that used to live in QuickScheduleForm).
            <div className="mt-2 flex items-center gap-2">
              <select
                aria-label={t.hour}
                value={time.slice(0, 2)}
                onChange={(event) => setTime(`${event.target.value}:${time.slice(3, 5)}`)}
                className="h-11 flex-1 rounded-[var(--radius-chip)] border border-border bg-surface px-3 text-[15px]"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <span className="font-semibold">:</span>
              <select
                aria-label={t.minute}
                value={MINUTES.includes(time.slice(3, 5)) ? time.slice(3, 5) : "00"}
                onChange={(event) => setTime(`${time.slice(0, 2)}:${event.target.value}`)}
                className="h-11 flex-1 rounded-[var(--radius-chip)] border border-border bg-surface px-3 text-[15px]"
              >
                {MINUTES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}
        </fieldset>

        <div
          className={`rounded-[var(--radius-card)] border p-4 ${
            tight ? "border-amber-border bg-amber-bg" : "border-accent-tint-border bg-accent-tint"
          }`}
          aria-live="polite"
        >
          {targetTooLow ? (
            <p className="text-[15px] font-semibold text-amber">{t.targetTooLow}</p>
          ) : inPast ? (
            <p className="text-[15px] font-semibold text-amber">{t.pastTime}</p>
          ) : (
            <>
              <p className="text-[28px] leading-tight font-semibold tabular-nums">
                {fill(t.summaryKwh, { kwh: formatNumber(kwh, 1) })}
              </p>
              <p className={`mt-1 text-[15px] ${tight ? "font-semibold text-amber" : "text-text-2"}`}>
                {!data.connected
                  ? fill(t.noCarSummary, { readyBy: readyByText, day: dayText })
                  : tight
                    ? fill(t.startsNow, { readyBy: readyByText, day: dayText })
                    : fill(t.summary, { start: formatTime(start), readyBy: readyByText, day: dayText })}
              </p>
              <p className="mt-2 text-xs text-muted">
                {fill(t.basis, { kw: formatNumber(data.powerKw, 1), capacity: formatNumber(data.capacityKwh, 0) })}
              </p>
            </>
          )}
        </div>

        <SaveButton disabled={targetTooLow || inPast} />
      </form>

      {data.plan && <CancelPlanButton plan={data.plan} now={now} />}
    </BottomSheet>
  );
}

function SaveButton({ disabled }: { disabled: boolean }) {
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        className="flex h-[52px] w-full cursor-not-allowed items-center justify-center rounded-[var(--radius-button)] bg-accent px-4 text-base font-semibold text-on-accent opacity-40"
      >
        {t.save}
      </button>
    );
  }
  return (
    <SubmitButton
      pendingLabel={nb.actions.working}
      className="flex h-[52px] w-full items-center justify-center rounded-[var(--radius-button)] bg-accent px-4 text-base font-semibold text-on-accent"
    >
      {t.save}
    </SubmitButton>
  );
}

function CancelPlanButton({ plan, now }: { plan: NonNullable<PlanSheetData["plan"]>; now: Date }) {
  const close = useCloseSheet();
  return (
    <ActionButton
      action={() => cancelSchedule(plan.id, {}, new FormData())}
      label={t.cancel}
      className="mt-1 flex h-11 w-full items-center justify-center text-[15px] font-semibold text-danger"
      success={planCancelledToast(plan, now)}
      errorMessage={nb.actions.planCancelFailed}
      confirm={cancelPlanDialog(plan, now)}
      undo={{ action: () => restoreSchedule(plan.id), success: nb.toasts.planRestored }}
      onSuccess={close}
    />
  );
}

/** ?sheet=plan while the charger is lent out: plans are off until the lending ends (D29). */
export function LentOutSheet({ chargerId, chargerName }: { chargerId: string; chargerName: string }) {
  const close = useCloseSheet();
  return (
    <BottomSheet title={t.lentOutTitle}>
      <p className="text-[15px] text-text-2">{t.lentOut}</p>
      <div className="mt-5">
        <ActionButton
          action={() => endLending(chargerId, chargerName, {}, new FormData())}
          label={t.lentOutEnd}
          className="flex h-[52px] w-full items-center justify-center rounded-[var(--radius-button)] bg-accent px-4 text-base font-semibold text-on-accent"
          success={nb.home.guest.ended}
          errorMessage={nb.home.guest.endFailed}
          onSuccess={close}
        />
      </div>
    </BottomSheet>
  );
}

/** ?sheet=plan while the plan is charging: no editing (D55) -- stop it, then plan again. */
export function PlanInProgressSheet({
  plan,
  nowIso,
}: {
  plan: NonNullable<PlanSheetData["plan"]>;
  nowIso: string;
}) {
  return (
    <BottomSheet title={t.inProgressTitle}>
      <p className="text-[15px] text-text-2">{t.inProgress}</p>
      <div className="mt-4">
        <CancelPlanButton plan={plan} now={new Date(nowIso)} />
      </div>
    </BottomSheet>
  );
}
