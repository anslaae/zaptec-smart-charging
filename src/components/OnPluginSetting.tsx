"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BottomSheet } from "@/components/BottomSheet";
import { setOnPluginMode } from "@/lib/settingsActions";
import type { OnPluginMode } from "@/lib/settings";
import { formatDayLabel, formatNumber, formatPercent, formatTime } from "@/lib/datetime";
import { fill, nb } from "@/lib/i18n/nb";

const o = nb.onPlugin;
const TARGETS = [70, 80, 90, 100] as const;
// Ready-by choices: every 15 minutes 05:00–12:00 covers weekday and weekend mornings.
const TIMES = Array.from({ length: 29 }, (_, i) => {
  const minutes = 5 * 60 + i * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

export interface OnPluginSettingData {
  mode: OnPluginMode;
  untilIso: string | null;
  smartTargetPercent: number;
  smartReadyByWeekday: string;
  smartReadyByWeekend: string;
  location: string;
  /** kr/kWh energy + grid, for the "Billigst / Dyrest" lines; null without grid rates. */
  cheapestNokPerKwh: number | null;
  dearestNokPerKwh: number | null;
}

const untilText = (iso: string | null) =>
  iso ? `${formatDayLabel(iso)} kl. ${formatTime(iso)}` : nb.toasts.automaticOnIndefinitely;

/**
 * Innstillinger → Lading → "Når bilen kobles til" (HANDOFF §6b, UC14 +
 * UC16): a row showing the current choice, opening a sheet with three radio
 * cards. Smart lading's settings expand under its card. Choosing "now" or
 * "smart" asks first (anyone at the charger can then charge), with how long.
 */
export function OnPluginSetting({ data }: { data: OnPluginSettingData }) {
  const [open, setOpen] = useState(false);
  const rowValue =
    data.mode === "smart"
      ? fill(o.settingsRowSmart, { percent: data.smartTargetPercent, time: data.smartReadyByWeekday })
      : data.mode === "now"
        ? fill(o.settingsRowNow, { percent: data.smartTargetPercent })
        : o.wait.title;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-11 items-center justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold">{o.settingsRow}</span>
          {data.mode !== "wait" && data.untilIso && (
            <span className="block text-xs text-muted">{fill(o.untilLabel, { until: untilText(data.untilIso) })}</span>
          )}
        </span>
        <span className="shrink-0 text-right text-sm text-muted">{rowValue} ›</span>
      </button>
      {data.mode !== "wait" && (
        <p className="rounded-[var(--radius-chip)] bg-amber-bg px-3 py-2 text-xs text-amber">
          {nb.settings.charging.allowAutomaticWarning}
        </p>
      )}
      {open && <OnPluginSheet data={data} onClose={() => setOpen(false)} />}
    </>
  );
}

function OnPluginSheet({ data, onClose }: { data: OnPluginSettingData; onClose: () => void }) {
  const [mode, setMode] = useState<OnPluginMode>(data.mode);
  const [target, setTarget] = useState(data.smartTargetPercent);
  const [weekday, setWeekday] = useState(data.smartReadyByWeekday);
  const [weekend, setWeekend] = useState(data.smartReadyByWeekend);
  const [pending, startTransition] = useTransition();

  // No confirm or "Hvor lenge?" (owner decision D51): the choice applies to
  // the registered car and stays until someone changes it here.
  const save = () => {
    const duration = "off" as const;
    startTransition(async () => {
      const result = await setOnPluginMode({
        mode,
        duration,
        smartTargetPercent: target as (typeof TARGETS)[number],
        smartReadyByWeekday: weekday,
        smartReadyByWeekend: weekend,
      });
      if (result.error) {
        toast.error(nb.settings.charging.saveFailed, { description: result.error });
        return;
      }
      toast.success(o.saved, {
        description:
          mode === "wait" ? o.wait.title : `${o[mode].title} · ${target}\u202F%`,
      });
      onClose();
    });
  };

  const card = (value: OnPluginMode, sub: string) => (
    <label
      key={value}
      className={`flex cursor-pointer gap-3 rounded-[var(--radius-card)] border p-4 ${
        mode === value ? "border-accent bg-accent-tint" : "border-border bg-surface"
      }`}
    >
      <input
        type="radio"
        name="on-plugin-mode"
        value={value}
        checked={mode === value}
        onChange={() => setMode(value)}
        className="mt-1 accent-[var(--accent)]"
      />
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">{o[value].title}</span>
        <span className="block text-sm text-muted">{sub}</span>
      </span>
    </label>
  );

  const select = (id: string, label: string, value: string, onChange: (v: string) => void) => (
    <label htmlFor={id} className="flex items-center justify-between gap-3 text-[15px]">
      {label}
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-[var(--radius-chip)] border border-border bg-surface px-3 text-[15px]"
      >
        {(TIMES.includes(value) ? TIMES : [value, ...TIMES]).map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );

  const ore = (nok: number) => formatNumber(nok * 100, 0);

  return (
    <BottomSheet title={o.title} onClose={onClose} labelledBy="on-plugin-title">
      <p className="text-[15px] text-text-2">{o.intro}</p>
      <div role="radiogroup" aria-label={o.title} className="mt-4 flex flex-col gap-2">
        {card("wait", o.wait.sub)}
        {card("now", fill(o.nowSubTarget, { percent: target }))}
        {card("smart", fill(o.smart.sub, { percent: target }))}
      </div>

      {mode !== "wait" && (
        <div className="mt-3 flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface-2 p-4">
          <fieldset>
            <legend className="text-[15px] font-semibold">{o.target}</legend>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {TARGETS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={target === value}
                  onClick={() => setTarget(value)}
                  className={`flex h-11 items-center justify-center rounded-[var(--radius-chip)] border text-[15px] font-semibold ${
                    target === value ? "border-accent bg-accent-tint text-accent" : "border-border bg-surface"
                  }`}
                >
                  {formatPercent(value)}
                </button>
              ))}
            </div>
          </fieldset>
          {mode === "smart" && select("ready-weekday", o.readyWeekday, weekday, setWeekday)}
          {mode === "smart" && select("ready-weekend", o.readyWeekend, weekend, setWeekend)}
          <p className="text-xs text-muted">{o.targetNote}</p>
          {mode === "smart" && data.cheapestNokPerKwh != null && data.dearestNokPerKwh != null && (
            <div className="text-xs text-muted">
              <p>{fill(o.cheapest, { price: ore(data.cheapestNokPerKwh) })}</p>
              <p>{fill(o.dearest, { price: ore(data.dearestNokPerKwh) })}</p>
              <p className="mt-1">{o.priceNote}</p>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="mt-5 flex h-[52px] w-full cursor-pointer items-center justify-center rounded-[var(--radius-button)] bg-accent px-4 text-base font-semibold text-on-accent disabled:opacity-60"
      >
        {pending ? nb.actions.working : o.save}
      </button>
    </BottomSheet>
  );
}
