import Link from "next/link";
import { formatNumber } from "@/lib/datetime";
import { fill, nb } from "@/lib/i18n/nb";

// Pieces shared by the Innsikt month and year views (HANDOFF §5, §6c, §6d).

const t = nb.insights;

export function Kpi({ label, value, sub }: { label: string; value: string; sub: string | null }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-[26px] leading-tight font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function PersonBar({
  name,
  kwh,
  costNok,
  max,
  muted,
}: {
  name: string;
  kwh: number;
  costNok: number;
  max: number;
  muted?: boolean;
}) {
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

/** The kWh and kr each row of Per person shows -- a month's or a year's. */
export interface PersonSplit {
  perPerson: { userId: string; kwh: number; costNok: number }[];
  guestKwh: number;
  guestCostNok: number;
  smartKwh: number;
  smartCostNok: number;
  automaticKwh: number;
  automaticCostNok: number;
  importedKwh: number;
  importedCostNok: number;
}

export function PerPersonCard({ split: m, nameById }: { split: PersonSplit; nameById: Map<string, string> }) {
  const max = Math.max(...m.perPerson.map((p) => p.kwh), m.guestKwh, m.automaticKwh, m.smartKwh, m.importedKwh, 0);
  if (max <= 0) return null;
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">{t.perPerson}</h2>
      <ul className="flex flex-col gap-4">
        {m.perPerson.map((p) => (
          <PersonBar key={p.userId} name={nameById.get(p.userId) ?? "–"} kwh={p.kwh} costNok={p.costNok} max={max} />
        ))}
        {m.guestKwh > 0 && <PersonBar name={t.guest} kwh={m.guestKwh} costNok={m.guestCostNok} max={max} muted />}
        {m.smartKwh > 0 && <PersonBar name={t.smart} kwh={m.smartKwh} costNok={m.smartCostNok} max={max} muted />}
        {m.automaticKwh > 0 && (
          <PersonBar name={t.automatic} kwh={m.automaticKwh} costNok={m.automaticCostNok} max={max} muted />
        )}
        {m.importedKwh > 0 && (
          <PersonBar name={t.imported} kwh={m.importedKwh} costNok={m.importedCostNok} max={max} muted />
        )}
      </ul>
    </section>
  );
}

export function DriveFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** Title, the car label and the Måned | År control (HANDOFF §6c, §6d). */
export function InsightsHeader({
  carName,
  period,
  monthHref,
  yearHref,
}: {
  carName: string | null;
  period: "month" | "year";
  monthHref: string;
  yearHref: string;
}) {
  const segment = (active: boolean) =>
    `flex h-10 items-center justify-center rounded-[10px] text-sm font-semibold ${
      active ? "bg-surface text-text shadow-sm" : "text-muted"
    }`;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-[28px] font-semibold">{t.title}</h1>
        {carName && (
          // With one car a label, not a picker (HANDOFF.md §6c).
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-surface-2 px-3 py-1 text-sm font-semibold">{carName}</span>
            <span className="text-xs text-muted">{t.car.chipNote}</span>
          </p>
        )}
      </div>
      <nav aria-label={t.periodLabel} className="grid grid-cols-2 gap-1 rounded-[var(--radius-chip)] bg-surface-2 p-1">
        <Link href={monthHref} aria-current={period === "month" ? "page" : undefined} className={segment(period === "month")}>
          {t.periodMonth}
        </Link>
        <Link href={yearHref} aria-current={period === "year" ? "page" : undefined} className={segment(period === "year")}>
          {t.periodYear}
        </Link>
      </nav>
    </div>
  );
}

/** ‹ label › -- `next` null at the newest period. */
export function PeriodNav({
  label,
  prevHref,
  prevLabel,
  nextHref,
  nextLabel,
}: {
  label: string;
  prevHref: string;
  prevLabel: string;
  nextHref: string | null;
  nextLabel: string;
}) {
  const arrow = "flex h-11 w-11 items-center justify-center rounded-full text-xl text-text-2";
  return (
    <nav className="flex items-center justify-between">
      <Link href={prevHref} aria-label={prevLabel} className={arrow}>
        ‹
      </Link>
      <span className="text-[17px] font-semibold">{label}</span>
      {nextHref ? (
        <Link href={nextHref} aria-label={nextLabel} className={arrow}>
          ›
        </Link>
      ) : (
        <span className="h-11 w-11" aria-hidden />
      )}
    </nav>
  );
}

export function PriceNote({ grid }: { grid: boolean }) {
  return (
    <p className="px-1 text-xs text-muted">
      {grid ? t.priceNoteGrid : t.priceNoteNoGrid}{" "}
      <Link href="/settings#price" className="font-semibold text-accent">
        {t.changePriceLink}
      </Link>
    </p>
  );
}

/** "+12 %" / "−3 %" / "±0 %", with U+202F before the % (owner, 2026-11-13). */
export function signedPercent(change: number): string {
  return `${change > 0 ? "+" : change < 0 ? "−" : "±"}${Math.abs(change)} %`;
}
