"use client";

import { useActionState, useMemo, useState } from "react";
import { createSchedule, type CreateScheduleState } from "@/lib/schedules/actions";
import { VEHICLE_BATTERY_CAPACITY_KWH } from "@/lib/vehicle";
import { HOUSEHOLD_TIME_ZONE, tomorrowAtLocalValue, zonedDateTimeToUtc } from "@/lib/datetime";
import { estimateChargingPlan } from "@/lib/scheduler/engine";
import type { ChargerState } from "@/lib/zaptec/types";

const initialState: CreateScheduleState = {};
const TARGET_OPTIONS = [80, 100] as const;
const DEFAULT_READY_BY = tomorrowAtLocalValue(HOUSEHOLD_TIME_ZONE, 8, 0);

export function QuickScheduleForm({
  chargers,
  chargerState,
}: {
  chargers: { id: string; name: string }[];
  chargerState: ChargerState | null;
}) {
  const [state, formAction, pending] = useActionState(createSchedule, initialState);
  const [currentPercent, setCurrentPercent] = useState(50);
  const [targetPercent, setTargetPercent] = useState<(typeof TARGET_OPTIONS)[number]>(80);
  const [readyByValue, setReadyByValue] = useState(DEFAULT_READY_BY);

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
            className="rounded-md border border-black/10 bg-transparent px-3 py-2 text-base dark:border-white/15"
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
            step={5}
            value={currentPercent}
            onChange={(event) => setCurrentPercent(Number(event.target.value))}
            className="flex-1"
          />
          <span className="w-12 text-right text-sm font-medium">{currentPercent}%</span>
        </div>
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
              className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
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
        <label htmlFor="quickReadyBy" className="text-sm font-medium">
          Ready by
        </label>
        <input
          id="quickReadyBy"
          name="readyBy"
          type="datetime-local"
          required
          value={readyByValue}
          onChange={(event) => setReadyByValue(event.target.value)}
          className="rounded-md border border-black/10 bg-transparent px-3 py-2 text-base dark:border-white/15"
        />
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

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="simulate"
          className="h-4 w-4 rounded border-black/20 dark:border-white/30"
        />
        Simulate only (don&apos;t actually control the charger)
      </label>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending || chargers.length === 0 || targetEnergyKwh <= 0}
        className="rounded-md bg-foreground px-4 py-2 text-base font-medium text-background disabled:opacity-60"
      >
        {pending ? "Saving…" : "Plan charging"}
      </button>
      {chargers.length === 0 && (
        <p className="text-sm text-red-600">No chargers found on the connected Zaptec account.</p>
      )}
    </form>
  );
}
