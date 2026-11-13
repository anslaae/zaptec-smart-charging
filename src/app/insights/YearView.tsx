import Link from "next/link";
import type { YearDriving } from "@/lib/ui/driving";
import type { YearInsights } from "@/lib/ui/insights";
import { capitalize, monthName } from "@/lib/ui/history";
import { formatNumber, formatPastDayAndTime } from "@/lib/datetime";
import { fill, nb } from "@/lib/i18n/nb";
import { DriveFigure, Kpi, PerPersonCard, signedPercent } from "./parts";

// Innsikt year view (design/redesign/HANDOFF.md §6d): the month view's cards
// over Jan–Dec of one year, up to today for the current year.

const t = nb.insights;
const ty = t.year;
const td = t.drive;

const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;
// Spelled out: ICU builds differ on the period ("jan" vs "jan."); design writes "jan.–nov.".
const SHORT_MONTHS = ["jan.", "feb.", "mar.", "apr.", "mai", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "des."];
const shortMonth = (month: number) => SHORT_MONTHS[month - 1];
const narrowMonth = (month: number) =>
  new Intl.DateTimeFormat("nb-NO", { month: "narrow", timeZone: "UTC" }).format(new Date(Date.UTC(2026, month - 1, 15)));

/** 12 bars; the unfinished month dashed, later months empty; a bar opens its month. */
function MonthBars({ y, currentMonthKey }: { y: YearInsights; currentMonthKey: string }) {
  const kwh = y.months.map((m) => m?.totalKwh ?? 0);
  const max = Math.max(...kwh, 1);
  return (
    <div role="list" aria-label={fill(ty.chartLabel, { year: y.year })} className="flex h-44 items-stretch gap-[3px]">
      {y.months.map((m, i) => {
        const key = monthKey(y.year, i + 1);
        const value = kwh[i];
        const label = formatNumber(value, 0);
        const partial = y.partialMonth === i + 1;
        const bar = (
          <>
            <div className="flex w-full flex-1 flex-col items-center justify-end gap-1">
              {/* Value labels only when they fit (≤ 3 digits in a twelfth of the card). */}
              {value > 0 && label.length <= 3 && <span className="text-[10px] text-muted tabular-nums">{label}</span>}
              <div
                className={`w-full rounded-t-[3px] ${
                  partial ? "border border-b-0 border-dashed border-accent bg-accent-tint" : "bg-bar-muted"
                }`}
                style={{ height: value > 0 ? `${Math.max(4, (value / max) * 100)}%` : partial ? "4px" : 0 }}
              />
            </div>
            <span aria-hidden className={`text-[11px] ${m ? "text-muted" : "text-divider"}`}>
              {narrowMonth(i + 1)}
            </span>
          </>
        );
        const cell = "flex min-w-0 flex-1 flex-col items-center gap-1";
        return m ? (
          <div key={key} role="listitem" className="flex min-w-0 flex-1">
            <Link
              href={key === currentMonthKey ? "/insights" : `/insights?month=${key}`}
              aria-label={fill(ty.barLabel, { month: capitalize(monthName(key)), kwh: formatNumber(value, 1) })}
              className={`${cell} rounded-[4px]`}
            >
              {bar}
            </Link>
          </div>
        ) : (
          <div key={key} role="listitem" aria-label={capitalize(monthName(key))} className={cell}>
            {bar}
          </div>
        );
      })}
    </div>
  );
}

/** km/kWh per month: points for months with enough data, joined in order. */
function EfficiencyLine({ perMonth, year }: { perMonth: (number | null)[]; year: number }) {
  const points = perMonth.flatMap((v, i) => (v == null ? [] : [{ i, v }]));
  if (points.length === 0) return null;
  const W = 300;
  const H = 90;
  const pad = 10;
  const lo = Math.min(...points.map((p) => p.v));
  const hi = Math.max(...points.map((p) => p.v));
  // At least 2 km/kWh tall, so a few hundredths don't look like a season.
  const floor = Math.max(0, Math.min(lo, hi - 2));
  const span = hi - floor || 1;
  const x = (i: number) => pad + (i / 11) * (W - 2 * pad);
  const yPos = (v: number) => pad + (1 - (v - floor) / span) * (H - 2 * pad);
  const lowest = points.reduce((a, b) => (b.v < a.v ? b : a));
  const highest = points.reduce((a, b) => (b.v > a.v ? b : a));
  // Only when the shown values differ ("Lavest 6,2 · Høyest 6,2" says nothing).
  const marked = points.length > 1 && formatNumber(lowest.v, 1) !== formatNumber(highest.v, 1);
  return (
    <div className="mt-3 border-t border-divider pt-3">
      <h3 className="text-xs text-muted">{ty.effPerMonth}</h3>
      <svg
        viewBox={`0 0 ${W} ${H + 16}`}
        role="img"
        aria-label={fill(ty.effChartLabel, { year })}
        className="mt-2 h-auto w-full"
      >
        <polyline
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeLinejoin="round"
          points={points.map((p) => `${x(p.i)},${yPos(p.v)}`).join(" ")}
        />
        {points.map((p) => (
          <circle
            key={p.i}
            cx={x(p.i)}
            cy={yPos(p.v)}
            r={marked && (p === lowest || p === highest) ? 4 : 2.5}
            fill="var(--accent)"
          />
        ))}
        {Array.from({ length: 12 }, (_, i) => (
          <text key={i} x={x(i)} y={H + 12} textAnchor="middle" fontSize={9} fill="var(--muted)">
            {narrowMonth(i + 1)}
          </text>
        ))}
      </svg>
      {marked && (
        <p className="mt-1 flex justify-between gap-3 text-xs text-muted tabular-nums">
          <span>{fill(ty.effLowest, { month: shortMonth(lowest.i + 1), value: formatNumber(lowest.v, 1) })}</span>
          <span>{fill(ty.effHighest, { month: shortMonth(highest.i + 1), value: formatNumber(highest.v, 1) })}</span>
        </p>
      )}
      <p className="mt-2 text-xs text-muted">{ty.effNote}</p>
    </div>
  );
}

function YearDriveCard({
  d,
  isCurrentYear,
  odometer,
  now,
}: {
  d: YearDriving;
  isCurrentYear: boolean;
  odometer: { km: number; at: Date } | null;
  now: Date;
}) {
  return (
    <section aria-label={td.title} className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">{td.title}</h2>
        {odometer && (
          <span className="text-right text-xs text-muted">
            {fill(td.odometer, { km: formatNumber(odometer.km, 0), when: formatPastDayAndTime(odometer.at, now) })}
          </span>
        )}
      </div>
      <p className="mt-2 text-[26px] leading-tight font-semibold tabular-nums">
        {formatNumber(d.km ?? 0, 0)} km{" "}
        <span className="text-sm font-normal text-muted">
          {isCurrentYear ? ty.drivenYear : fill(ty.drivenIn, { year: d.year })}
        </span>
      </p>
      {d.enough ? (
        <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-divider pt-3">
          <DriveFigure label={td.efficiency} value={fill(td.efficiencyValue, { value: formatNumber(d.kmPerKwh!, 1) })} />
          <DriveFigure label={td.consumption} value={fill(td.consumptionValue, { value: formatNumber(d.kwhPerMil!, 2) })} />
          <DriveFigure
            label={td.cost}
            value={d.nokPerMil != null ? fill(td.costValue, { value: formatNumber(d.nokPerMil, 2) }) : "–"}
          />
        </dl>
      ) : (
        <p className="mt-2 text-sm text-muted">{td.notEnough}</p>
      )}
      <EfficiencyLine perMonth={d.perMonth} year={d.year} />
      <p className="mt-3 text-xs text-muted">
        {td.footnote}
        {d.awayCharges > 0 && (
          <> {fill(d.awayCharges === 1 ? td.awayCharges : td.awayChargesPlural, { count: d.awayCharges })}</>
        )}
      </p>
    </section>
  );
}

export function YearView({
  y,
  drive,
  odometer,
  nameById,
  currentMonthKey,
  fallbackPrice,
  now,
}: {
  y: YearInsights;
  drive: YearDriving;
  odometer: { km: number; at: Date } | null;
  nameById: Map<string, string>;
  currentMonthKey: string;
  fallbackPrice: number;
  now: Date;
}) {
  const isCurrentYear = y.partialMonth != null;
  const range = y.lastMonth === 1 ? shortMonth(1) : `${shortMonth(1)}–${shortMonth(y.lastMonth)}`;
  const change =
    y.changePercent != null
      ? fill(ty.vsLastYear, { change: signedPercent(y.changePercent), range, year: y.year - 1 })
      : null;
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Kpi
          label={isCurrentYear ? ty.energy : fill(ty.energyIn, { year: y.year })}
          value={`${formatNumber(y.totalKwh, 0)} kWh`}
          sub={change}
        />
        <Kpi
          label={isCurrentYear ? ty.cost : fill(ty.costIn, { year: y.year })}
          value={`${formatNumber(Math.round(y.totalCostNok), 0)} kr`}
          sub={fill(t.avgPrice, {
            price: formatNumber(y.totalKwh > 0 ? y.totalCostNok / y.totalKwh : fallbackPrice, 2),
          })}
        />
      </div>

      <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">{ty.perMonth}</h2>
          <span className="text-right text-xs text-muted">{ty.perMonthHint}</span>
        </div>
        <MonthBars y={y} currentMonthKey={currentMonthKey} />
        {y.partialMonth != null && (
          <p className="mt-3 text-xs text-muted">
            {fill(ty.partialMonth, { month: capitalize(monthName(monthKey(y.year, y.partialMonth))) })}
          </p>
        )}
      </section>

      <PerPersonCard split={y} nameById={nameById} />

      {(drive.km != null || odometer) && (
        <YearDriveCard d={drive} isCurrentYear={isCurrentYear} odometer={odometer} now={now} />
      )}
    </>
  );
}
