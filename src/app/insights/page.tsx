import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSettings, pricesOf } from "@/lib/settings";
import { hasGridTariff } from "@/lib/pricing";
import { getDefaultCar } from "@/lib/places";
import { loadDriveReadings, loadSessionRecords } from "@/lib/records";
import { latestOdometer, monthDriving, type MonthDriving } from "@/lib/ui/driving";
import { capitalize, monthName } from "@/lib/ui/history";
import { monthInsights, monthKeyOf, shiftMonth } from "@/lib/ui/insights";
import { formatNumber, formatPastDayAndTime } from "@/lib/datetime";
import { fill, nb } from "@/lib/i18n/nb";

const t = nb.insights;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function Kpi({ label, value, sub }: { label: string; value: string; sub: string | null }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-[26px] leading-tight font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}

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

function PersonBar({ name, kwh, costNok, max, muted }: { name: string; kwh: number; costNok: number; max: number; muted?: boolean }) {
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-semibold">{name}</span>
        <span className="text-sm text-muted tabular-nums">
          {fill(t.personRow, { kwh: formatNumber(kwh, 1), kr: formatNumber(Math.round(costNok), 0) })}
        </span>
      </div>
      <div className="h-2 rounded-full bg-track">
        <div
          className={`h-2 rounded-full ${muted ? "bg-ring-muted" : "bg-accent"}`}
          style={{ width: `${max > 0 ? (kwh / max) * 100 : 0}%` }}
        />
      </div>
    </li>
  );
}

function DriveFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{value}</dd>
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

// Innsikt (design/redesign/HANDOFF.md §5): one month at a time from the
// app's own session records. Cost = energy (Norgespris) + estimated nettleie
// energiledd, both from Innstillinger (src/lib/pricing.ts; DECISIONS.md D30).
export default async function InsightsPage({ searchParams }: PageProps<"/insights">) {
  await verifySession();
  const now = new Date();
  const current = monthKeyOf(now);
  const { month: monthParam } = await searchParams;
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
  const since = new Date(Date.UTC(py, pm - 1, 1) - 86_400_000);
  const [{ records }, readings] = await Promise.all([
    loadSessionRecords(since, capacityKwh, pricesOf(settings), car?.id ?? null),
    // A month further back than the previous one: the baseline reading "before the month".
    loadDriveReadings(car?.id ?? null, new Date(since.getTime() - 31 * 86_400_000)),
  ]);
  const m = monthInsights(records, month, now);
  // Kjøring: home sessions for this car only (a guest's car never counts for ours).
  const carSessions = records.filter((r) => r.carId != null && r.carId === car?.id);
  const avgPrice = (x: { totalKwh: number; totalCostNok: number }) => (x.totalKwh > 0 ? x.totalCostNok / x.totalKwh : null);
  const drive = monthDriving(readings, carSessions, month, capacityKwh, avgPrice(m));
  const drivePrev = monthDriving(readings, carSessions, previous, capacityKwh, avgPrice(monthInsights(records, previous, now)));
  const odometer = latestOdometer(readings, month);
  const grid = hasGridTariff(pricesOf(settings));
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const personMax = Math.max(...m.perPerson.map((p) => p.kwh), m.guestKwh, m.automaticKwh, m.smartKwh, 0);
  const shortPrev = new Intl.DateTimeFormat("nb-NO", { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(py, pm - 1, 15)),
  );
  const change =
    m.changePercent != null
      ? fill(t.vsLastMonth, {
          change: `${m.changePercent > 0 ? "+" : m.changePercent < 0 ? "−" : "±"}${Math.abs(m.changePercent)} %`,
          month: shortPrev,
        })
      : fill(t.noComparison, { month: monthName(previous) });

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 pt-6 pb-4">
      <div>
        <h1 className="text-[28px] font-semibold">{t.title}</h1>
        {car && (
          // With one car a label, not a picker (HANDOFF.md §6c).
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-surface-2 px-3 py-1 text-sm font-semibold">{car.name}</span>
            <span className="text-xs text-muted">{t.car.chipNote}</span>
          </p>
        )}
      </div>

      <nav className="flex items-center justify-between">
        <Link
          href={`/insights?month=${previous}`}
          aria-label={t.prevMonth}
          className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-text-2"
        >
          ‹
        </Link>
        <span className="text-[17px] font-semibold">
          {capitalize(monthName(month))}
          {month.slice(0, 4) !== current.slice(0, 4) ? ` ${month.slice(0, 4)}` : ""}
        </span>
        {month < current ? (
          <Link
            href={shiftMonth(month, 1) === current ? "/insights" : `/insights?month=${shiftMonth(month, 1)}`}
            aria-label={t.nextMonth}
            className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-text-2"
          >
            ›
          </Link>
        ) : (
          <span className="h-11 w-11" aria-hidden />
        )}
      </nav>

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

      {personMax > 0 && (
        <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">{t.perPerson}</h2>
          <ul className="flex flex-col gap-4">
            {m.perPerson.map((p) => (
              <PersonBar key={p.userId} name={nameById.get(p.userId) ?? "–"} kwh={p.kwh} costNok={p.costNok} max={personMax} />
            ))}
            {m.guestKwh > 0 && <PersonBar name={t.guest} kwh={m.guestKwh} costNok={m.guestCostNok} max={personMax} muted />}
            {m.smartKwh > 0 && (
              <PersonBar name={t.smart} kwh={m.smartKwh} costNok={m.smartCostNok} max={personMax} muted />
            )}
            {m.automaticKwh > 0 && (
              <PersonBar name={t.automatic} kwh={m.automaticKwh} costNok={m.automaticCostNok} max={personMax} muted />
            )}
          </ul>
        </section>
      )}

      {(drive.km != null || odometer) && (
        <DriveCard d={drive} prev={drivePrev} monthLabel={monthName(month)} odometer={odometer} now={now} />
      )}

      <p className="px-1 text-xs text-muted">
        {grid ? t.priceNoteGrid : t.priceNoteNoGrid}{" "}
        <Link href="/settings#price" className="font-semibold text-accent">
          {t.changePriceLink}
        </Link>
      </p>
    </main>
  );
}
