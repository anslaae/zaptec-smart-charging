"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createSchedule, type CreateScheduleState } from "@/lib/schedules/actions";
import { VEHICLE_BATTERY_CAPACITY_KWH } from "@/lib/vehicle";
import {
  HOUSEHOLD_TIME_ZONE,
  formatOsloDateTime,
  tomorrowAtLocalValue,
  zonedDateTimeToUtc,
} from "@/lib/datetime";
import { estimateChargingPlan } from "@/lib/scheduler/engine";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import type { ChargerState } from "@/lib/zaptec/types";
import type { StateOfCharge } from "@/lib/smartcar/types";

const initialState: CreateScheduleState = {};
const TARGET_OPTIONS = [80, 100] as const;
const DEFAULT_READY_BY = tomorrowAtLocalValue(HOUSEHOLD_TIME_ZONE, 8, 0);
const [DEFAULT_READY_BY_DATE, DEFAULT_READY_BY_TIME] = DEFAULT_READY_BY.split("T");
const [DEFAULT_READY_BY_HOUR, DEFAULT_READY_BY_MINUTE] = DEFAULT_READY_BY_TIME.split(":");

// input type="datetime-local" has two real problems on this app's own
// household phones: its displayed time follows the OS region setting (shows
// AM/PM regardless of this app's 24h convention everywhere else), and iOS
// has a known WebKit bug where the native picker for date/time inputs (and
// selects) stops responding in a home-screen-installed web app, especially
// after it's been backgrounded -- see
// https://developer.apple.com/forums/thread/705685. A plain <input
// type="date"> plus two explicit <select>s sidesteps the locale issue
// entirely (we spell out 24h ourselves) and is a simpler, more robust
// control than the compound widget, though it can't fully rule out that same
// OS-level bug -- closing and reopening the app from the home screen (or
// just using it in Safari) is the workaround if a picker ever goes unresponsive.
const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, m) => String(m * 5).padStart(2, "0"));

// The "Battery now" slider's track is a 3-stop gradient rather than a plain
// fill: the portion up to the live Smartcar reading (if any) is distinct
// from any further manual adjustment away from it, since the reading can be
// several hours stale (see HANDOVER.md's "Smartcar API reality") and the
// household member dragging the slider is the one who actually knows better
// right now.
const SLIDER_COLOR_REPORTED = "#22c55e"; // green-500
const SLIDER_COLOR_ADJUSTED = "#3b82f6"; // blue-500
const SLIDER_COLOR_REMAINING = "var(--slider-track-remaining)";

function batterySliderBackground(reportedPercent: number | null, sliderPercent: number): string {
  if (reportedPercent == null) {
    return `linear-gradient(to right, ${SLIDER_COLOR_REPORTED} 0%, ${SLIDER_COLOR_REPORTED} ${sliderPercent}%, ${SLIDER_COLOR_REMAINING} ${sliderPercent}%, ${SLIDER_COLOR_REMAINING} 100%)`;
  }
  const lower = Math.min(reportedPercent, sliderPercent);
  const upper = Math.max(reportedPercent, sliderPercent);
  return `linear-gradient(to right, ${SLIDER_COLOR_REPORTED} 0%, ${SLIDER_COLOR_REPORTED} ${lower}%, ${SLIDER_COLOR_ADJUSTED} ${lower}%, ${SLIDER_COLOR_ADJUSTED} ${upper}%, ${SLIDER_COLOR_REMAINING} ${upper}%, ${SLIDER_COLOR_REMAINING} 100%)`;
}

export function QuickScheduleForm({
  chargers,
  chargerState,
  stateOfCharge,
}: {
  chargers: { id: string; name: string }[];
  chargerState: ChargerState | null;
  stateOfCharge: StateOfCharge | null;
}) {
  const [state, formAction, pending] = useActionState(createSchedule, initialState);
  // Prefilled from the live Smartcar reading when available (still just a
  // default -- the slider below stays fully editable, since the reading can
  // be stale).
  const [currentPercent, setCurrentPercent] = useState(() =>
    stateOfCharge ? Math.min(100, Math.max(0, Math.round(stateOfCharge.percent))) : 50,
  );
  const [targetPercent, setTargetPercent] = useState<(typeof TARGET_OPTIONS)[number]>(80);
  const [readyByDate, setReadyByDate] = useState(DEFAULT_READY_BY_DATE);
  const [readyByHour, setReadyByHour] = useState(DEFAULT_READY_BY_HOUR);
  const [readyByMinute, setReadyByMinute] = useState(DEFAULT_READY_BY_MINUTE);
  const readyByValue = `${readyByDate}T${readyByHour}:${readyByMinute}`;

  const targetEnergyKwh = useMemo(() => {
    const kwh = ((targetPercent - currentPercent) / 100) * VEHICLE_BATTERY_CAPACITY_KWH;
    return Math.max(0, Math.round(kwh * 10) / 10);
  }, [currentPercent, targetPercent]);

  // Live estimate using the same math the scheduler itself uses, so this
  // reflects your current battery/target/deadline inputs before you even
  // submit -- not just once a schedule already exists.
  const estimatedStartTime = useMemo(() => {
    if (!chargerState || targetEnergyKwh <= 0) return null;
    const readyBy = zonedDateTimeToUtc(readyByValue, HOUSEHOLD_TIME_ZONE);
    if (Number.isNaN(readyBy.getTime())) return null;
    return estimateChargingPlan({ targetEnergyKwh, readyBy }, chargerState).latestStartTime;
  }, [chargerState, targetEnergyKwh, readyByValue]);

  const noCarConnected = chargerState?.operationMode === ChargerOperationMode.Disconnected;

  useEffect(() => {
    if (state.error) toast.error("Couldn't plan charging", { description: state.error });
  }, [state.error]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {chargers.length > 1 && (
        <div className="flex flex-col gap-1">
          <label htmlFor="quickChargerId" className="text-sm font-medium">
            Charger
          </label>
          <select
            id="quickChargerId"
            name="chargerId"
            required
            className="cursor-pointer rounded-md border border-black/10 bg-transparent px-3 py-2 text-base dark:border-white/15"
            onChange={(event) => {
              const form = event.currentTarget.form;
              if (!form) return;
              const nameInput = form.elements.namedItem("chargerName") as HTMLInputElement | null;
              const selected = chargers.find((c) => c.id === event.currentTarget.value);
              if (nameInput && selected) nameInput.value = selected.name;
            }}
          >
            {chargers.map((charger) => (
              <option key={charger.id} value={charger.id}>
                {charger.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {chargers.length <= 1 && (
        <input type="hidden" name="chargerId" value={chargers[0]?.id ?? ""} />
      )}
      <input type="hidden" name="chargerName" value={chargers[0]?.name ?? ""} />
      <input type="hidden" name="targetEnergyKwh" value={targetEnergyKwh} />

      <div className="flex flex-col gap-1">
        <label htmlFor="currentPercent" className="text-sm font-medium">
          Battery now
        </label>
        <div className="flex items-center gap-3">
          <input
            id="currentPercent"
            type="range"
            min={0}
            max={100}
            step={1}
            value={currentPercent}
            onChange={(event) => setCurrentPercent(Number(event.target.value))}
            className="battery-slider flex-1 cursor-pointer"
            style={{ background: batterySliderBackground(stateOfCharge?.percent ?? null, currentPercent) }}
          />
          <span className="w-12 text-right text-sm font-medium">{currentPercent}%</span>
        </div>
        {stateOfCharge && (
          <p className="text-xs text-black/50 dark:text-white/50">
            Car reported {stateOfCharge.percent}% as of {formatOsloDateTime(stateOfCharge.oemUpdatedAt)}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Charge to</span>
        <div className="flex gap-2">
          {TARGET_OPTIONS.map((percent) => (
            <button
              key={percent}
              type="button"
              onClick={() => setTargetPercent(percent)}
              aria-pressed={targetPercent === percent}
              className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-sm font-medium ${
                targetPercent === percent
                  ? "border-foreground bg-foreground text-background"
                  : "border-black/10 dark:border-white/15"
              }`}
            >
              {percent}%
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="quickReadyByDate" className="text-sm font-medium">
          Ready by
        </label>
        <div className="flex gap-2">
          <input
            id="quickReadyByDate"
            type="date"
            required
            value={readyByDate}
            onChange={(event) => setReadyByDate(event.target.value)}
            // Browsers only treat the small calendar-icon area as reliably
            // clickable to open the picker; tapping the date digits
            // themselves just focuses that segment for manual entry, which
            // reads as "nothing happened" on a touchscreen. Forcing the
            // picker open on any click/tap makes the whole box behave the
            // same way. showPicker() needs a direct user gesture, so this is
            // only called from onClick, never onFocus (which also fires from
            // keyboard tab navigation).
            onClick={(event) => {
              try {
                event.currentTarget.showPicker?.();
              } catch {
                // Unsupported or disallowed in this state -- the field still
                // works as a normal date input either way.
              }
            }}
            className="flex-1 cursor-pointer rounded-md border border-black/10 bg-transparent px-3 py-2 text-base dark:border-white/15"
          />
          <select
            aria-label="Hour"
            value={readyByHour}
            onChange={(event) => setReadyByHour(event.target.value)}
            className="cursor-pointer rounded-md border border-black/10 bg-transparent px-2 py-2 text-base dark:border-white/15"
          >
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {hour}
              </option>
            ))}
          </select>
          <span className="flex items-center text-base text-black/50 dark:text-white/50">:</span>
          <select
            aria-label="Minute"
            value={readyByMinute}
            onChange={(event) => setReadyByMinute(event.target.value)}
            className="cursor-pointer rounded-md border border-black/10 bg-transparent px-2 py-2 text-base dark:border-white/15"
          >
            {MINUTES.map((minute) => (
              <option key={minute} value={minute}>
                {minute}
              </option>
            ))}
          </select>
        </div>
        <input type="hidden" name="readyBy" value={readyByValue} />
      </div>

      <p className="text-xs text-black/50 dark:text-white/50">
        {targetEnergyKwh > 0
          ? `≈ ${targetEnergyKwh.toFixed(1)} kWh, assuming a ${VEHICLE_BATTERY_CAPACITY_KWH} kWh battery.`
          : "Target must be above the current battery level."}
      </p>

      {estimatedStartTime && (
        <p className="rounded-md bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-700 dark:text-blue-400">
          Would start charging around{" "}
          {estimatedStartTime.toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: HOUSEHOLD_TIME_ZONE,
            hour12: false,
          })}
        </p>
      )}

      {noCarConnected && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
          No car appears to be connected right now. You can still plan charging — it just
          won&apos;t be able to start until the car is plugged in.
        </p>
      )}

      <button
        type="submit"
        disabled={pending || chargers.length === 0 || targetEnergyKwh <= 0}
        className="cursor-pointer rounded-md bg-foreground px-4 py-2 text-base font-medium text-background disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Saving…" : "Plan charging"}
      </button>
      {chargers.length === 0 && (
        <p className="text-sm text-red-600">No chargers found on the connected Zaptec account.</p>
      )}
    </form>
  );
}
