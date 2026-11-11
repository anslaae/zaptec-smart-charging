import { HOUSEHOLD_TIME_ZONE, formatNumber, formatTime } from "@/lib/datetime";
import { isNightOrWeekend } from "@/lib/pricing";
import { PEAK_END_HOUR, PEAK_START_HOUR } from "@/lib/scheduler/smart";
import { fill, nb } from "@/lib/i18n/nb";

// Smart lading's night timeline on Hjem (HANDOFF §6b UI): from now to the
// ready-by time, the evening peak (amber), the cheap nettleie window (green
// tint), the planned charging blocks, and markers for now and klar -- plus
// the estimated cost and the saving vs charging straight away.

export interface SmartTimelineData {
  nowIso: string;
  readyByIso: string;
  blocks: { start: string; end: string }[];
  costNok: number;
  nowCostNok: number;
}

type Band = "peak" | "cheap" | "normal";
const STEP_MS = 15 * 60_000;

const osloHour = (ms: number) =>
  Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: HOUSEHOLD_TIME_ZONE }).format(new Date(ms)));

function bands(from: number, to: number): { start: number; end: number; band: Band }[] {
  const out: { start: number; end: number; band: Band }[] = [];
  for (let t = from; t < to; t += STEP_MS) {
    const end = Math.min(t + STEP_MS, to);
    const hour = osloHour(t);
    const band: Band = hour >= PEAK_START_HOUR && hour < PEAK_END_HOUR ? "peak" : isNightOrWeekend(new Date(t)) ? "cheap" : "normal";
    const last = out[out.length - 1];
    if (last && last.band === band) last.end = end;
    else out.push({ start: t, end, band });
  }
  return out;
}

/** Whole hours between `from` and `to` worth labelling (every 3 h on the Oslo clock). */
function hourTicks(from: number, to: number): number[] {
  const ticks: number[] = [];
  for (let t = Math.ceil(from / 3_600_000) * 3_600_000; t < to; t += 3_600_000) {
    if (osloHour(t) % 3 === 0) ticks.push(t);
  }
  return ticks;
}

const BAND_CLASS: Record<Band, string> = {
  peak: "bg-amber-bg",
  cheap: "bg-accent-tint",
  normal: "bg-surface",
};

export function SmartTimeline({ data }: { data: SmartTimelineData }) {
  const s = nb.home.smart;
  const from = Date.parse(data.nowIso);
  const to = Date.parse(data.readyByIso);
  const span = Math.max(1, to - from);
  const pct = (t: number) => `${(((Math.min(Math.max(t, from), to) - from) / span) * 100).toFixed(2)}%`;
  const width = (a: number, b: number) => `${((Math.max(0, Math.min(b, to) - Math.max(a, from)) / span) * 100).toFixed(2)}%`;
  const saving = Math.round(data.nowCostNok - data.costNok);

  return (
    <section className="rounded-[var(--radius-card)] bg-surface-2 px-4 py-3" aria-label={s.pill}>
      <div className="relative mt-1 h-9 overflow-hidden rounded-[10px] border border-border">
        {bands(from, to).map((b) => (
          <div
            key={b.start}
            className={`absolute inset-y-0 ${BAND_CLASS[b.band]}`}
            style={{ left: pct(b.start), width: width(b.start, b.end) }}
          />
        ))}
        {data.blocks.map((b) => (
          <div
            key={b.start}
            className="absolute inset-y-2 rounded-[6px] bg-accent"
            style={{ left: pct(Date.parse(b.start)), width: width(Date.parse(b.start), Date.parse(b.end)) }}
            title={`${formatTime(b.start)}–${formatTime(b.end)}`}
          />
        ))}
        <div className="absolute inset-y-0 left-0 w-0.5 bg-text" aria-hidden />
        <div className="absolute inset-y-0 right-0 w-0.5 bg-text" aria-hidden />
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-muted" aria-hidden>
        {hourTicks(from, to).map((t) => (
          <span key={t} className="absolute -translate-x-1/2 tabular-nums" style={{ left: pct(t) }}>
            {formatTime(new Date(t)).slice(0, 2)}
          </span>
        ))}
      </div>

      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-amber-border bg-amber-bg" aria-hidden />
          {s.legendPeak}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-accent-tint-border bg-accent-tint" aria-hidden />
          {s.legendCheap}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" aria-hidden />
          {s.legendCharge}
        </li>
        <li>{fill(s.legendMarkers, { readyBy: formatTime(data.readyByIso) })}</li>
      </ul>

      <p className="mt-2 text-sm">
        <span className="font-semibold">{fill(s.cost, { cost: formatNumber(Math.round(data.costNok), 0) })}</span>
        {saving > 0 && <span className="text-muted"> · {fill(s.saving, { saving: formatNumber(saving, 0) })}</span>}
      </p>
    </section>
  );
}
