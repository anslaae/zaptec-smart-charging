import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { activityEvents, chargeSchedules, users } from "@/lib/db/schema";
import { ACTIVITY_LABEL, type ActivityType } from "@/lib/activity/log";
import { getSettings, pricesOf } from "@/lib/settings";
import { getDefaultCar } from "@/lib/places";
import { loadSessionRecords, planDeliveredKwh } from "@/lib/records";
import {
  capitalize,
  groupSessions,
  monthName,
  type MonthGroup,
  type SessionRecord,
  type WeekGroup,
} from "@/lib/ui/history";
import { formatDayAndTime, formatDayLabel, formatDuration, formatNumber, formatTime } from "@/lib/datetime";
import { fill, nb } from "@/lib/i18n/nb";

const t = nb.history;
type Tab = "sessions" | "plans" | "activity";
const TABS: Tab[] = ["sessions", "plans", "activity"];
const HISTORY_MONTHS = 12;

const kr = (nok: number) => formatNumber(Math.round(nok), 0);

function Segments({ active }: { active: Tab }) {
  return (
    <nav aria-label={t.title} className="grid grid-cols-3 gap-1 rounded-[var(--radius-chip)] bg-surface-2 p-1">
      {TABS.map((tab) => (
        <Link
          key={tab}
          href={tab === "sessions" ? "/history" : `/history?tab=${tab}`}
          aria-current={tab === active ? "page" : undefined}
          className={`flex h-10 items-center justify-center rounded-[10px] text-sm font-semibold ${
            tab === active ? "bg-surface text-text shadow-sm" : "text-muted"
          }`}
        >
          {t.tabs[tab]}
        </Link>
      ))}
    </nav>
  );
}

function Tag({ tag, guestName }: { tag: SessionRecord["tag"]; guestName?: string | null }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
        tag === "plan" || tag === "smart" ? "bg-accent-tag text-accent" : "bg-track text-text-2"
      }`}
    >
      {tag === "guest" && guestName ? `${t.tags.guest} · ${guestName}` : t.tags[tag]}
    </span>
  );
}

function SessionRow({ record, now }: { record: SessionRecord; now: Date }) {
  const duration = record.endedAt ? (record.endedAt.getTime() - record.startedAt.getTime()) / 1000 : null;
  return (
    <li id={`session-${record.id}`} className="flex scroll-mt-4 items-start justify-between gap-3 py-3 target:bg-accent-tint">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold">
            {capitalize(formatDayLabel(record.startedAt, now))} · {formatTime(record.startedAt)}
          </span>
          <Tag tag={record.tag} guestName={record.guestName} />
        </div>
        {record.startPercent != null && record.endPercent != null && (
          <p className="mt-0.5 text-sm text-text-2">
            {record.startPercent} → {record.endPercent} %
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[15px] font-semibold tabular-nums">
          {record.kwh != null ? `${formatNumber(record.kwh, 1)} kWh` : t.unknownKwh}
        </p>
        <p className="text-xs text-muted">
          {[duration != null ? formatDuration(duration) : null, record.costNok != null ? `${kr(record.costNok)} kr` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </li>
  );
}

function automaticLine(count: number, period: string): string | null {
  if (count === 0) return null;
  return fill(count === 1 ? t.automaticSummary : t.automaticSummaryPlural, { count, period });
}

function WeekSection({ group, now }: { group: WeekGroup; now: Date }) {
  const line = automaticLine(group.automaticStops, t.period[group.key]);
  return (
    <section>
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">{t.groups[group.key]}</h2>
        {group.records.length > 0 && (
          <span className="text-xs text-muted">
            {fill(t.groupTotal, { kwh: formatNumber(group.kwh, 1), kr: kr(group.costNok) })}
          </span>
        )}
      </div>
      <div className="mt-2 rounded-[var(--radius-card)] border border-border bg-surface px-4">
        {group.records.length === 0 ? (
          <p className="py-3 text-sm text-muted">{group.key === "thisWeek" ? t.noSessions : t.noSessionsLastWeek}</p>
        ) : (
          <ul className="divide-y divide-divider">
            {group.records.map((record) => (
              <SessionRow key={record.id} record={record} now={now} />
            ))}
          </ul>
        )}
        {line && <p className="border-t border-divider py-2.5 text-xs text-muted">{line}</p>}
      </div>
    </section>
  );
}

function MonthSection({ group, now }: { group: MonthGroup; now: Date }) {
  const name = monthName(group.key);
  const line = automaticLine(group.automaticStops, fill(t.period.month, { month: name }));
  const count = group.records.length;
  return (
    <details className="group rounded-[var(--radius-card)] border border-border bg-surface px-4">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3">
        <span className="text-[15px] font-semibold">{capitalize(name)}</span>
        <span className="flex items-center gap-2 text-sm text-muted">
          {fill(count === 1 ? t.monthRowOne : t.monthRow, { count, kwh: formatNumber(group.kwh, 0) })}
          <span aria-hidden className="transition-transform group-open:rotate-90">
            ›
          </span>
        </span>
      </summary>
      <ul className="divide-y divide-divider border-t border-divider">
        {group.records.map((record) => (
          <SessionRow key={record.id} record={record} now={now} />
        ))}
      </ul>
      {line && <p className="border-t border-divider py-2.5 text-xs text-muted">{line}</p>}
    </details>
  );
}

async function SessionsTab({ now }: { now: Date }) {
  const since = new Date(now.getTime() - HISTORY_MONTHS * 31 * 86_400_000);
  const [settings, car] = await Promise.all([getSettings(), getDefaultCar(null)]);
  const { records, automaticStops } = await loadSessionRecords(since, car?.batteryCapacityKwh ?? 46, pricesOf(settings));
  if (records.length === 0 && automaticStops.length === 0) {
    return <p className="text-sm text-muted">{t.emptySessions}</p>;
  }
  const { weeks, months } = groupSessions(records, automaticStops, now);
  return (
    <div className="flex flex-col gap-5">
      {weeks.map((group) => (
        <WeekSection key={group.key} group={group} now={now} />
      ))}
      {months.length > 0 && (
        <div className="flex flex-col gap-2">
          {months.map((group) => (
            <MonthSection key={group.key} group={group} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

async function PlansTab({ now }: { now: Date }) {
  const [plans, people] = await Promise.all([
    db
      .select()
      .from(chargeSchedules)
      .where(inArray(chargeSchedules.status, ["completed", "cancelled"]))
      .orderBy(desc(chargeSchedules.readyBy))
      .limit(50),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  if (plans.length === 0) return <p className="text-sm text-muted">{t.emptyPlans}</p>;
  return (
    <ul className="divide-y divide-divider rounded-[var(--radius-card)] border border-border bg-surface px-4">
      {plans.map((plan) => {
        const delivered = planDeliveredKwh(plan);
        const target =
          plan.targetPercent != null
            ? `${plan.targetPercent} %`
            : `${formatNumber(Number(plan.targetEnergyKwh), 1)} kWh`;
        return (
          <li key={plan.id} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">
                {fill(t.planReady, { readyBy: formatDayAndTime(plan.readyBy, now) })}
              </p>
              <p className="mt-0.5 text-sm text-muted">
                {fill(t.planBy, { name: (plan.createdByUserId ? nameById.get(plan.createdByUserId) : nb.history.tags.smart) ?? "–", target })}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  plan.status === "completed" ? "bg-accent-tag text-accent" : "bg-track text-text-2"
                }`}
              >
                {t.planStatus[plan.status as "completed" | "cancelled"]}
              </span>
              {delivered != null && delivered > 0 && (
                <p className="mt-1 text-xs text-muted tabular-nums">{formatNumber(delivered, 1)} kWh</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

async function ActivityTab({ now }: { now: Date }) {
  const [events, people] = await Promise.all([
    db.select().from(activityEvents).orderBy(desc(activityEvents.createdAt)).limit(200),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  if (events.length === 0) return <p className="text-sm text-muted">{t.emptyActivity}</p>;
  return (
    <ul className="divide-y divide-divider rounded-[var(--radius-card)] border border-border bg-surface px-4">
      {events.map((event) => {
        const who = event.userId ? nameById.get(event.userId) : null;
        const sub = [who, event.detail].filter(Boolean).join(" · ");
        return (
          <li key={event.id} className="flex items-baseline justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[15px]">{ACTIVITY_LABEL[event.type as ActivityType] ?? event.type}</p>
              {sub && <p className="truncate text-xs text-muted">{sub}</p>}
            </div>
            <span className="shrink-0 text-xs text-muted">{formatDayAndTime(event.createdAt, now)}</span>
          </li>
        );
      })}
    </ul>
  );
}

// Historikk (design/redesign/HANDOFF.md §5): Økter / Planer / Aktivitet,
// one server-rendered segment per ?tab so each loads only its own data.
export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  await verifySession();
  const { tab: tabParam } = await searchParams;
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "sessions";
  const now = new Date();

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 pt-6 pb-4">
      <h1 className="text-[28px] font-semibold">{t.title}</h1>
      <Segments active={tab} />
      {tab === "sessions" && <SessionsTab now={now} />}
      {tab === "plans" && <PlansTab now={now} />}
      {tab === "activity" && <ActivityTab now={now} />}
    </main>
  );
}
