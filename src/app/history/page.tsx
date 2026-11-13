import Link from "next/link";
import { and, desc, gte, inArray } from "drizzle-orm";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { activityEvents, chargeSchedules, users } from "@/lib/db/schema";
import { ACTIVITY_LABEL, type ActivityType } from "@/lib/activity/log";
import { getSettings, pricesOf } from "@/lib/settings";
import { getDefaultCar } from "@/lib/places";
import { loadSessionRecords, planDeliveredKwh } from "@/lib/records";
import {
  capitalize,
  groupByPeriod,
  groupSessions,
  monthName,
  type PeriodGroups,
  type SessionRecord,
  type WeekKey,
} from "@/lib/ui/history";
import { formatDayAndTime, formatDayLabel, formatDuration, formatNumber, formatTime } from "@/lib/datetime";
import { fill, nb } from "@/lib/i18n/nb";
import { carShortName } from "@/lib/ui/cars";
import { shownDetail, visibleActivity } from "@/lib/ui/activity";
import { DebugOnly } from "@/components/DebugOnly";

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

function Tag({ tag }: { tag: SessionRecord["tag"] }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
        tag === "plan" || tag === "smart" ? "bg-accent-tag text-accent" : "bg-track text-text-2"
      }`}
    >
      {t.tags[tag]}
    </span>
  );
}

/** "Mokka-e · 41 → 80 %"; guest rows "Gjest · {name}" -- a guest's car is never ours (HANDOFF.md §6c). */
function sessionDetail(record: SessionRecord, carName: string | null): string | null {
  if (record.tag === "guest") return record.guestName ? `${t.tags.guest} · ${record.guestName}` : null;
  const percent =
    record.startPercent != null && record.endPercent != null ? `${record.startPercent} → ${record.endPercent} %` : null;
  const car = record.carId != null ? carName : null;
  if (record.tag === "imported") return car ? fill(t.carPrefix, { car, detail: t.importedDetail }) : t.importedDetail;
  if (car && percent) return fill(t.carPrefix, { car, detail: percent });
  return car ?? percent;
}

function SessionRow({ record, now, carName }: { record: SessionRecord; now: Date; carName: string | null }) {
  const detail = sessionDetail(record, carName);
  const duration = record.endedAt ? (record.endedAt.getTime() - record.startedAt.getTime()) / 1000 : null;
  return (
    <li id={`session-${record.id}`} className="flex scroll-mt-4 items-start justify-between gap-3 py-3 target:bg-accent-tint">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold">
            {capitalize(formatDayLabel(record.startedAt, now))} · {formatTime(record.startedAt)}
          </span>
          <Tag tag={record.tag} />
        </div>
        {detail && <p className="mt-0.5 text-sm text-text-2">{detail}</p>}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[15px] font-semibold tabular-nums">
          {record.kwh != null ? `${formatNumber(record.kwh, 1)} kWh` : t.unknownKwh}
        </p>
        <p className="text-xs text-muted">
          {[
            duration != null ? formatDuration(duration) : null,
            // No price to work it out from: "–", not a made-up 0 kr (D70).
            record.costNok != null ? `${kr(record.costNok)} kr` : record.kwh != null ? "– kr" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </li>
  );
}

// The Økter layout for all three tabs: this week and last week as cards with
// a summary on the right, older months as rows that open.
function WeekSection({
  title,
  summary,
  empty,
  children,
}: {
  title: string;
  summary: string | null;
  /** Shown instead of the list when the week has nothing. */
  empty: string | null;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">{title}</h2>
        {summary && <span className="text-xs text-muted">{summary}</span>}
      </div>
      <div className="mt-2 rounded-[var(--radius-card)] border border-border bg-surface px-4">
        {empty && <p className="py-3 text-sm text-muted">{empty}</p>}
        <ul className="divide-y divide-divider">{children}</ul>
      </div>
    </section>
  );
}

function MonthSection({ monthKey, summary, children }: { monthKey: string; summary: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-[var(--radius-card)] border border-border bg-surface px-4">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3">
        <span className="text-[15px] font-semibold">{capitalize(monthName(monthKey))}</span>
        <span className="flex items-center gap-2 text-sm text-muted">
          {summary}
          <span aria-hidden className="transition-transform group-open:rotate-90">
            ›
          </span>
        </span>
      </summary>
      <ul className="divide-y divide-divider border-t border-divider">{children}</ul>
    </details>
  );
}

function PeriodList<T>({
  groups,
  render,
  weekSummary,
  monthSummary,
  emptyWeek,
}: {
  groups: PeriodGroups<T>;
  render: (item: T) => React.ReactNode;
  weekSummary: (items: T[], key: WeekKey) => string | null;
  monthSummary: (items: T[], key: string) => string;
  emptyWeek: (key: WeekKey, items: T[]) => string | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      {groups.weeks.map(({ key, items }) => (
        <WeekSection key={key} title={t.groups[key]} summary={weekSummary(items, key)} empty={emptyWeek(key, items)}>
          {items.map(render)}
        </WeekSection>
      ))}
      {groups.months.length > 0 && (
        <div className="flex flex-col gap-2">
          {groups.months.map(({ key, items }) => (
            <MonthSection key={key} monthKey={key} summary={monthSummary(items, key)}>
              {items.map(render)}
            </MonthSection>
          ))}
        </div>
      )}
    </div>
  );
}

const count = (n: number, one: string, many: string) => fill(n === 1 ? one : many, { count: n });

async function SessionsTab({ now }: { now: Date }) {
  const since = new Date(now.getTime() - HISTORY_MONTHS * 31 * 86_400_000);
  const [settings, car] = await Promise.all([getSettings(), getDefaultCar(null)]);
  const { records } = await loadSessionRecords(since, car?.batteryCapacityKwh ?? 46, pricesOf(settings), car?.id ?? null);
  if (records.length === 0) {
    return <p className="text-sm text-muted">{t.emptySessions}</p>;
  }
  // Automatic stops after a plug-in aren't summarised here any more: "Bil
  // koblet til" in Aktivitet says enough (owner decision, DECISIONS.md D63).
  const { weeks, months } = groupSessions(records, now);
  const carName = car ? carShortName(car.name) : null;
  const totals = new Map<string, { kwh: number; costNok: number }>([...weeks, ...months].map((g) => [g.key, g]));
  return (
    <PeriodList
      groups={{
        weeks: weeks.map((g) => ({ key: g.key, items: g.records })),
        months: months.map((g) => ({ key: g.key, items: g.records })),
      }}
      render={(record) => <SessionRow key={record.id} record={record} now={now} carName={carName} />}
      weekSummary={(items, key) =>
        items.length === 0
          ? null
          : fill(t.groupTotal, { kwh: formatNumber(totals.get(key)!.kwh, 1), kr: kr(totals.get(key)!.costNok) })
      }
      monthSummary={(items, key) =>
        fill(items.length === 1 ? t.monthRowOne : t.monthRow, { count: items.length, kwh: formatNumber(totals.get(key)!.kwh, 0) })
      }
      emptyWeek={(key, items) => (items.length > 0 ? null : key === "thisWeek" ? t.noSessions : t.noSessionsLastWeek)}
    />
  );
}

async function PlansTab({ now }: { now: Date }) {
  const since = new Date(now.getTime() - HISTORY_MONTHS * 31 * 86_400_000);
  const [plans, people] = await Promise.all([
    db
      .select()
      .from(chargeSchedules)
      .where(and(inArray(chargeSchedules.status, ["completed", "cancelled"]), gte(chargeSchedules.readyBy, since)))
      .orderBy(desc(chargeSchedules.readyBy))
      .limit(300),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  if (plans.length === 0) return <p className="text-sm text-muted">{t.emptyPlans}</p>;
  const render = (plan: (typeof plans)[number]) => {
    const delivered = planDeliveredKwh(plan);
    const target =
      plan.targetPercent != null ? `${plan.targetPercent} %` : `${formatNumber(Number(plan.targetEnergyKwh), 1)} kWh`;
    return (
      <li key={plan.id} className="flex items-start justify-between gap-3 py-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">{fill(t.planReady, { readyBy: formatDayAndTime(plan.readyBy, now) })}</p>
          <p className="mt-0.5 text-sm text-muted">
            {fill(t.planBy, {
              name: (plan.createdByUserId ? nameById.get(plan.createdByUserId) : nb.history.tags.smart) ?? "–",
              target,
            })}
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
  };
  return (
    <PeriodList
      groups={groupByPeriod(plans, (plan) => plan.readyBy, now)}
      render={render}
      weekSummary={(items) => (items.length > 0 ? count(items.length, t.plansCountOne, t.plansCount) : null)}
      monthSummary={(items) => count(items.length, t.plansCountOne, t.plansCount)}
      emptyWeek={(key, items) => (items.length > 0 ? null : key === "thisWeek" ? t.noPlans : t.noPlansLastWeek)}
    />
  );
}

async function ActivityTab({ now }: { now: Date }) {
  const since = new Date(now.getTime() - HISTORY_MONTHS * 31 * 86_400_000);
  const [events, people] = await Promise.all([
    db
      .select()
      .from(activityEvents)
      .where(gte(activityEvents.createdAt, since))
      .orderBy(desc(activityEvents.createdAt))
      .limit(1000),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  // What people and the app did; the charger's own start/stop only in debug mode (D63).
  const rows = visibleActivity(events);
  if (!rows.some((r) => !r.technical)) return <p className="text-sm text-muted">{t.emptyActivity}</p>;
  const shown = (items: typeof rows) => items.filter((r) => !r.technical).length;
  const groups = groupByPeriod(rows, (r) => r.event.createdAt, now);
  // A month with only debug-mode events would read "0 hendelser": left out.
  groups.months = groups.months.filter((m) => shown(m.items) > 0);
  const render = ({ event, technical }: (typeof rows)[number]) => {
    const who = event.userId ? nameById.get(event.userId) : null;
    const sub = [who, shownDetail(event)].filter(Boolean).join(" · ");
    const item = (
      <li key={event.id} className="flex items-baseline justify-between gap-3 py-2.5">
        <div className="min-w-0">
          <p className={`text-[15px] ${technical ? "text-muted" : ""}`}>{ACTIVITY_LABEL[event.type as ActivityType] ?? event.type}</p>
          {sub && <p className="truncate text-xs text-muted">{sub}</p>}
        </div>
        <span className="shrink-0 text-xs text-muted">{formatDayAndTime(event.createdAt, now)}</span>
      </li>
    );
    return technical ? <DebugOnly key={event.id}>{item}</DebugOnly> : item;
  };
  return (
    <PeriodList
      groups={groups}
      render={render}
      weekSummary={(items) => (shown(items) > 0 ? count(shown(items), t.eventsCountOne, t.eventsCount) : null)}
      monthSummary={(items) => count(shown(items), t.eventsCountOne, t.eventsCount)}
      emptyWeek={(key, items) => (shown(items) > 0 ? null : key === "thisWeek" ? t.noEvents : t.noEventsLastWeek)}
    />
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
