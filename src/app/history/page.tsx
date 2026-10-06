import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { chargeSchedules } from "@/lib/db/schema";
import { listChargers, getChargeHistory } from "@/lib/zaptec/client";
import { ChargingStats } from "@/components/ChargingStats";
import { HOUSEHOLD_TIME_ZONE } from "@/lib/datetime";

const SCHEDULE_STATUS_LABEL: Record<string, string> = {
  completed: "Completed",
  cancelled: "Cancelled",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: HOUSEHOLD_TIME_ZONE,
    hour12: false,
  });
}

function formatDuration(durationMs: number): string {
  const totalMinutes = Math.round(durationMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// Outlook-style recency buckets, increasing in scope so only the most recent
// (and usually smallest) group needs to be open by default.
const RECENCY_BUCKETS = [
  { label: "Last 7 days", maxDays: 7 },
  { label: "Last 30 days", maxDays: 30 },
  { label: "Last 3 months", maxDays: 90 },
  { label: "Older", maxDays: Infinity },
];

function groupByRecency<T>(items: T[], getDate: (item: T) => Date, now: Date) {
  const buckets = RECENCY_BUCKETS.map((b) => ({ ...b, items: [] as T[] }));
  for (const item of items) {
    const ageDays = (now.getTime() - getDate(item).getTime()) / 86_400_000;
    const bucket = buckets.find((b) => ageDays <= b.maxDays) ?? buckets[buckets.length - 1];
    bucket.items.push(item);
  }
  return buckets.filter((b) => b.items.length > 0);
}

export default async function HistoryPage() {
  await getCurrentUser();

  const [pastSchedules, chargers] = await Promise.all([
    db
      .select()
      .from(chargeSchedules)
      .where(inArray(chargeSchedules.status, ["completed", "cancelled"]))
      .orderBy(desc(chargeSchedules.updatedAt))
      .limit(20),
    listChargers(),
  ]);

  const sessionsByCharger = await Promise.all(
    chargers.map((charger) => getChargeHistory(charger.id)),
  );
  const sessions = sessionsByCharger
    .flat()
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const now = new Date();
  const scheduleGroups = groupByRecency(pastSchedules, (s) => s.updatedAt, now);
  const sessionGroups = groupByRecency(sessions, (s) => new Date(s.startedAt), now);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-8">
      <div>
        <Link href="/" className="text-sm text-black/50 underline underline-offset-2 dark:text-white/50">
          ← Back
        </Link>
        <h1 className="mt-2 text-xl font-semibold">History</h1>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Past schedules</h2>
        {pastSchedules.length === 0 && (
          <p className="text-sm text-black/50 dark:text-white/50">No past schedules yet.</p>
        )}
        {scheduleGroups.map((group, index) => (
          <RecencyGroup key={group.label} label={group.label} count={group.items.length} defaultOpen={index === 0}>
            {group.items.map((schedule) => {
              // The schedule's own startedAt/endedAt mark when *the
              // schedule* was actively charging. The linked real session's
              // own StartDateTime/EndDateTime span the whole plug-in period
              // (idle time included), so only its delivered energy is used
              // here -- not its timestamps.
              const realSession = schedule.zaptecSessionId
                ? sessionById.get(schedule.zaptecSessionId)
                : undefined;
              return (
                <HistoryCard
                  key={schedule.id}
                  title={`${Number(schedule.targetEnergyKwh).toFixed(1)} kWh on ${schedule.chargerName}`}
                  startedAt={schedule.startedAt?.toISOString() ?? null}
                  endedAt={schedule.endedAt?.toISOString() ?? null}
                  badges={<Badge>{SCHEDULE_STATUS_LABEL[schedule.status] ?? schedule.status}</Badge>}
                >
                  <p>Ready by {formatTime(schedule.readyBy.toISOString())}</p>
                  {realSession && <p>{realSession.energyKwh.toFixed(1)} kWh actually delivered</p>}
                </HistoryCard>
              );
            })}
          </RecencyGroup>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Charging activity</h2>
        <ChargingStats sessions={sessions} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">All sessions</h2>
        {sessions.length === 0 && (
          <p className="text-sm text-black/50 dark:text-white/50">No sessions recorded yet.</p>
        )}
        {sessionGroups.map((group, index) => (
          <RecencyGroup key={group.label} label={group.label} count={group.items.length} defaultOpen={index === 0}>
            {group.items.map((session) => (
              <HistoryCard
                key={session.id}
                title={`${session.energyKwh.toFixed(1)} kWh`}
                startedAt={session.startedAt}
                endedAt={session.endedAt}
                badges={!session.endedAt && <Badge tone="blue">In progress</Badge>}
              >
                {session.userFullName && <p>{session.userFullName}</p>}
              </HistoryCard>
            ))}
          </RecencyGroup>
        ))}
      </section>
    </main>
  );
}

// Outlook-style collapsible section header, one per recency bucket. Only the
// first (most recent, usually smallest) group is open by default.
function RecencyGroup({
  label,
  count,
  defaultOpen,
  children,
}: {
  label: string;
  count: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-xs font-medium text-black/50 uppercase tracking-wide dark:text-white/50 [&::-webkit-details-marker]:hidden">
        <ChevronIcon />
        {label} ({count})
      </summary>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </details>
  );
}

// Shared collapsible card for both "Past schedules" and "All sessions", so
// the two lists read as one consistent pattern: kWh, status and the key
// times/duration visible collapsed, full Started/Stopped plus any extra
// detail (children) revealed on expand.
function HistoryCard({
  title,
  badges,
  startedAt,
  endedAt,
  children,
}: {
  title: string;
  badges?: React.ReactNode;
  startedAt: string | null;
  endedAt: string | null;
  children?: React.ReactNode;
}) {
  const durationMs =
    startedAt && endedAt ? new Date(endedAt).getTime() - new Date(startedAt).getTime() : null;
  const durationLabel =
    durationMs != null ? formatDuration(durationMs) : startedAt ? "in progress" : "—";

  return (
    <details className="group rounded-xl border border-black/10 open:bg-black/[0.02] dark:border-white/15 dark:open:bg-white/[0.03]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{title}</span>
          {badges}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-black/50 dark:text-white/50">
          <span>{startedAt ? formatTime(startedAt) : "—"}</span>
          <span>{durationLabel}</span>
          <ChevronIcon />
        </div>
      </summary>
      <div className="flex flex-col gap-2 border-t border-black/10 px-4 py-3 text-xs text-black/60 dark:border-white/15 dark:text-white/60">
        <dl className="grid grid-cols-3 gap-2">
          <MiniStat label="Started" value={startedAt ? formatTime(startedAt) : "—"} />
          <MiniStat
            label="Stopped"
            value={endedAt ? formatTime(endedAt) : startedAt ? "In progress" : "—"}
          />
          <MiniStat label="Duration" value={durationLabel} />
        </dl>
        {children}
      </div>
    </details>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-black/50 dark:text-white/50">{label}</dt>
      <dd className="font-medium text-black/80 dark:text-white/80">{value}</dd>
    </div>
  );
}

function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "amber" | "blue";
  children: React.ReactNode;
}) {
  const toneClasses = {
    neutral: "bg-black/5 text-black/60 dark:bg-white/10 dark:text-white/60",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    blue: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  }[tone];
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${toneClasses}`}>
      {children}
    </span>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0 transition-transform duration-150 group-open:rotate-180"
      aria-hidden="true"
    >
      <path d="M5 7.5 10 12.5 15 7.5" />
    </svg>
  );
}
