import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSettings, pricesOf } from "@/lib/settings";
import { hasGridTariff } from "@/lib/pricing";
import { getDefaultCar } from "@/lib/places";
import { loadDriveReadings, loadSessionRecords } from "@/lib/records";
import { latestOdometer, monthDriving, yearDriving, type MonthDriving } from "@/lib/ui/driving";
import { capitalize, monthName } from "@/lib/ui/history";
import { monthInsights, monthKeyOf, shiftMonth, yearInsights, yearOf } from "@/lib/ui/insights";
import { formatNumber, formatPastDayAndTime } from "@/lib/datetime";
import { fill, nb } from "@/lib/i18n/nb";
import { DriveFigure, InsightsHeader, Kpi, PerPersonCard, PeriodNav, PriceNote, signedPercent } from "./parts";
import { YearView } from "./YearView";

const t = nb.insights;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_RE = /^\d{4}$/;
const DAY = 86_400_000;

function DayBars({ perDay, label }: { perDay: number[]; label: string }) {
  const max = Math.max(...perDay, 1);
  const last = perDay.findLastIndex((kwh) => kwh > 0);
  return (
    <div role="img" aria-label={label} className="flex h-40 items-end gap-[3px]">
      {perDay.map((kwh, i) => (
        <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
          {kwh > 0 && perDay.length <= 16 && (
            <span className="text-[10px] text-muted tabular-nums">{formatNumber(kwh, 0)}</span>
          )}
          <div
            className={`w-full rounded-t-[3px] ${i === last ? "bg-accent" : "bg-bar-muted"}`}
            style={{ height: `${kwh > 0 ? Math.max(4, (kwh / max) * 100) : 0}%` }}
            title={`${i + 1}.: ${formatNumber(kwh, 1)} kWh`}
          />
        </div>
      ))}
    </div>
  );
}

// Kjøring (HANDOFF.md §6c): km, efficiency and cost per mil for the month and car.
function DriveCard({
  d,
  prev,
  monthLabel,
  odometer,
  now,
}: {
  d: MonthDriving;
  prev: MonthDriving;
  monthLabel: string;
  odometer: { km: number; at: Date } | null;
  now: Date;
}) {
  const td = t.drive;
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
        <span className="text-sm font-normal text-muted">{fill(td.driven, { month: monthLabel })}</span>
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
      {prev.enough && (
        <p className="mt-3 text-xs text-muted">
          {t.prevMonthShort}:{" "}
          {fill(td.previous, {
            km: formatNumber(prev.km ?? 0, 0),
            eff: formatNumber(prev.kmPerKwh!, 1),
            cost: prev.nokPerMil != null ? formatNumber(prev.nokPerMil, 2) : "–",
          })}
        </p>
      )}
      <p className="mt-3 text-xs text-muted">
        {td.footnote}
        {d.awayCharges > 0 && (
          <> {fill(d.awayCharges === 1 ? td.awayCharges : td.awayChargesPlural, { count: d.awayCharges })}</>
        )}
      </p>
    </section>
  );
}

const avgPrice = (x: { totalKwh: number; totalCostNok: number }) => (x.totalKwh > 0 ? x.totalCostNok / x.totalKwh : null);

// Innsikt (design/redesign/HANDOFF.md §5): one month at a time from the
// app's own session records, or one year (§6d, `?year=`). Cost = energy
// (Norgespris) + estimated nettleie energiledd, both from Innstillinger
// (src/lib/pricing.ts; DECISIONS.md D30).
export default async function InsightsPage({ searchParams }: PageProps<"/insights">) {
  await verifySession();
  const now = new Date();
  const current = monthKeyOf(now);
  const currentYear = yearOf(now);
  const { month: monthParam, year: yearParam } = await searchParams;
  const year =
    typeof yearParam === "string" && YEAR_RE.test(yearParam) ? Math.min(Number(yearParam), currentYear) : null;
  const month =
    typeof monthParam === "string" && MONTH_RE.test(monthParam) && monthParam <= current ? monthParam : current;
  const previous = shiftMonth(month, -1);
  const [py, pm] = previous.split("-").map(Number);

  const [settings, car, people] = await Promise.all([
    getSettings(),
    getDefaultCar(null),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);
  const capacityKwh = car?.batteryCapacityKwh ?? 46;
  // Month: from the previous month (its comparison). Year: from 1 Jan of the year before.
  const since = year != null ? new Date(Date.UTC(year - 1, 0, 1) - DAY) : new Date(Date.UTC(py, pm - 1, 1) - DAY);
  // Readings from a month further back: the baseline reading "before the month/year".
  const readingsSince = year != null ? new Date(Date.UTC(year, 0, 1) - 31 * DAY) : new Date(since.getTime() - 31 * DAY);
  const [{ records }, readings] = await Promise.all([
    loadSessionRecords(since, capacityKwh, pricesOf(settings), car?.id ?? null),
    loadDriveReadings(car?.id ?? null, readingsSince),
  ]);
  // Kjøring: home sessions for this car only (a guest's car never counts for ours).
  const carSessions = records.filter((r) => r.carId != null && r.carId === car?.id);
  const grid = hasGridTariff(pricesOf(settings));
  const nameById = new Map(people.map((p) => [p.id, p.name]));

  if (year != null) {
    const y = yearInsights(records, year, now);
    const drive = yearDriving(readings, carSessions, year, capacityKwh, avgPrice(y), y.lastMonth);
    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 pt-6 pb-4">
        <InsightsHeader
          carName={car?.name ?? null}
          period="year"
          monthHref={year === currentYear ? "/insights" : `/insights?month=${year}-12`}
          yearHref={`/insights?year=${year}`}
        />
        <PeriodNav
          label={String(year)}
          prevHref={`/insights?year=${year - 1}`}
          prevLabel={t.year.prevYear}
          nextHref={year < currentYear ? `/insights?year=${year + 1}` : null}
          nextLabel={t.year.nextYear}
        />
        <YearView
          y={y}
          drive={drive}
          odometer={latestOdometer(readings, `${year}-12`)}
          nameById={nameById}
          currentMonthKey={current}
          fallbackPrice={settings.energyPriceNokPerKwh}
          now={now}
        />
        <PriceNote grid={grid} />
      </main>
    );
  }

  const m = monthInsights(records, month, now);
  const drive = monthDriving(readings, carSessions, month, capacityKwh, avgPrice(m));
  const drivePrev = monthDriving(readings, carSessions, previous, capacityKwh, avgPrice(monthInsights(records, previous, now)));
  const odometer = latestOdometer(readings, month);
  const shortPrev = new Intl.DateTimeFormat("nb-NO", { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(py, pm - 1, 15)),
  );
  const change =
    m.changePercent != null
      ? fill(t.vsLastMonth, { change: signedPercent(m.changePercent), month: shortPrev })
      : fill(t.noComparison, { month: monthName(previous) });

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 pt-6 pb-4">
      <InsightsHeader
        carName={car?.name ?? null}
        period="month"
        monthHref={month === current ? "/insights" : `/insights?month=${month}`}
        yearHref={`/insights?year=${month.slice(0, 4)}`}
      />

      <PeriodNav
        label={`${capitalize(monthName(month))}${month.slice(0, 4) !== current.slice(0, 4) ? ` ${month.slice(0, 4)}` : ""}`}
        prevHref={`/insights?month=${previous}`}
        prevLabel={t.prevMonth}
        nextHref={
          month < current
            ? shiftMonth(month, 1) === current
              ? "/insights"
              : `/insights?month=${shiftMonth(month, 1)}`
            : null
        }
        nextLabel={t.nextMonth}
      />

      <div className="grid grid-cols-2 gap-3">
        <Kpi label={t.energySoFar} value={`${formatNumber(m.totalKwh, 1)} kWh`} sub={change} />
        <Kpi
          label={t.costSoFar}
          value={`${formatNumber(Math.round(m.totalCostNok), 0)} kr`}
          sub={
            m.gridNok != null && m.totalKwh > 0
              ? fill(t.costSplit, {
                  energy: formatNumber(Math.round(m.totalCostNok - m.gridNok), 0),
                  grid: formatNumber(Math.round(m.gridNok), 0),
                })
              : fill(t.avgPrice, {
                  price: formatNumber(m.totalKwh > 0 ? m.totalCostNok / m.totalKwh : settings.energyPriceNokPerKwh, 2),
                })
          }
        />
      </div>

      <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">{t.perDay}</h2>
        {m.totalKwh > 0 ? (
          <DayBars perDay={m.perDay} label={fill(t.chartLabel, { month: monthName(month) })} />
        ) : (
          <p className="text-sm text-muted">{t.empty}</p>
        )}
      </section>

      <PerPersonCard split={m} nameById={nameById} />

      {(drive.km != null || odometer) && (
        <DriveCard d={drive} prev={drivePrev} monthLabel={monthName(month)} odometer={odometer} now={now} />
      )}

      <PriceNote grid={grid} />
    </main>
  );
}
