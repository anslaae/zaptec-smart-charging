import Link from "next/link";
import type { HomeCardData } from "@/lib/ui/homeData";
import { formatDuration, formatKr, formatNumber, formatPastDayAndTime } from "@/lib/datetime";
import { fill, nb } from "@/lib/i18n/nb";

// The secondary cards on Hjem (HANDOFF §3): "Koblet fra" in noCar and
// "Siste lading" in ready. Presentational; data comes from page.tsx.

const W = 300;
const H = 64;
const PAD = 6;

/** Since the last unplug: battery change, km driven, and the battery line with midnights marked. */
export function SinceUnplugCard({ data, now }: { data: NonNullable<HomeCardData["sinceUnplug"]>; now: Date }) {
  const t = nb.home.noCar;
  const from = Date.parse(data.fromIso);
  const span = Math.max(1, Date.parse(data.toIso) - from);
  const values = data.points.map((p) => p.percent);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const range = Math.max(10, hi - lo);
  const mid = (hi + lo) / 2;
  const x = (iso: string) => PAD + ((Date.parse(iso) - from) / span) * (W - 2 * PAD);
  const y = (percent: number) => H / 2 - ((percent - mid) / range) * (H - 2 * PAD);
  const path = data.points.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.percent).toFixed(1)}`).join(" ");
  const first = data.points[0];
  const last = data.points[data.points.length - 1];
  const sign = data.change > 0 ? "+" : data.change < 0 ? "−" : "±";

  return (
    <section aria-label={t.sinceTitle} className="rounded-[var(--radius-card)] bg-surface-2 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.04em] text-muted">{t.sinceTitle}</h3>
        <span className="text-xs text-muted">{formatPastDayAndTime(data.unpluggedAtIso, now)}</span>
      </div>
      <dl className="mt-1 flex gap-6">
        <div>
          <dt className="text-xs text-muted">{t.sinceBattery}</dt>
          <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">
            {fill(t.sinceBatteryValue, { change: `${sign}${Math.abs(data.change)}` })}
          </dd>
        </div>
        {data.drivenKm != null && (
          <div>
            <dt className="text-xs text-muted">{t.sinceDriven}</dt>
            <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">
              {fill(t.sinceDrivenValue, { km: formatNumber(data.drivenKm, 0) })}
            </dd>
          </div>
        )}
      </dl>
      {data.points.length > 1 && (
        <>
          <div className="relative mt-2">
            <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full" preserveAspectRatio="none" role="img" aria-label={t.sinceTitle}>
              {data.midnightsIso.map((iso) => (
                <line
                  key={iso}
                  x1={x(iso)}
                  x2={x(iso)}
                  y1={0}
                  y2={H}
                  stroke="var(--subtle)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              <circle cx={x(last.at)} cy={y(last.percent)} r={3.5} fill="var(--accent)" />
            </svg>
            {data.midnightsIso.length === 1 && (
              <span
                className="absolute top-full mt-0.5 -translate-x-1/2 text-[10px] leading-none text-muted"
                style={{ left: `${(x(data.midnightsIso[0]) / W) * 100}%` }}
              >
                {t.sinceMidnight}
              </span>
            )}
          </div>
          <div className={`${data.midnightsIso.length === 1 ? "mt-4" : "mt-1"} flex justify-between gap-3 text-xs text-muted tabular-nums`}>
            <span>{fill(t.sinceEndLabel, { when: formatPastDayAndTime(first.at, now), percent: first.percent })}</span>
            <span>{fill(t.sinceEndLabel, { when: formatPastDayAndTime(last.at, now), percent: last.percent })}</span>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** What the plan that just finished did; links to the session in Historikk. */
export function LastSessionCard({ plan }: { plan: NonNullable<HomeCardData["lastPlan"]> }) {
  const r = nb.home.ready;
  const seconds =
    plan.startedAtIso && plan.endedAtIso ? (Date.parse(plan.endedAtIso) - Date.parse(plan.startedAtIso)) / 1000 : null;
  return (
    <section className="rounded-[var(--radius-card)] bg-surface-2 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.04em] text-muted">{r.lastSession}</h3>
        <Link href={`/history#session-${plan.id}`} className="flex min-h-11 items-center text-sm font-semibold text-accent">
          {r.details}
        </Link>
      </div>
      <dl className="grid grid-cols-4 gap-2">
        <Stat label={r.from} value={plan.startPercent != null ? `${plan.startPercent}\u202F%` : "–"} />
        <Stat label={r.delivered} value={plan.deliveredKwh != null ? `${formatNumber(plan.deliveredKwh, 1)} kWh` : "–"} />
        <Stat label={r.duration} value={seconds != null ? formatDuration(seconds) : "–"} />
        <Stat label={r.cost} value={plan.costNok != null ? formatKr(plan.costNok) : "–"} />
      </dl>
      {(plan.carName || plan.byName) && (
        <p className="mt-2 text-xs text-muted">
          {plan.carName && plan.byName
            ? fill(r.byUser, { car: plan.carName, name: plan.byName })
            : plan.carName
              ? fill(r.byCar, { car: plan.carName })
              : plan.byName}
        </p>
      )}
      <p className="mt-1 text-xs text-muted">{r.persistNote}</p>
    </section>
  );
}
