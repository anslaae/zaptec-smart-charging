import Link from "next/link";
import { ACTIVITY_LABEL, type ActivityType } from "@/lib/activity/log";
import { formatDayAndTime } from "@/lib/datetime";
import { nb } from "@/lib/i18n/nb";

/** "Siste hendelser" on Hjem: the newest activity_events rows (the page passes 2). */
export function RecentActivity({
  events,
  now,
}: {
  events: { id: string; type: string; detail: string | null; createdAt: Date }[];
  now: Date;
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">{nb.home.recent.title}</h2>
        <Link href="/history" className="flex min-h-11 items-center text-sm font-semibold text-accent">
          {nb.home.recent.seeAll}
        </Link>
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-muted">{nb.home.recent.empty}</p>
      ) : (
        <ul className="divide-y divide-divider">
          {events.map((event) => (
            <li key={event.id} className="flex items-baseline justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[15px]">{ACTIVITY_LABEL[event.type as ActivityType] ?? event.type}</p>
                {event.detail && <p className="truncate text-xs text-muted">{event.detail}</p>}
              </div>
              <span className="shrink-0 text-xs text-muted">{formatDayAndTime(event.createdAt, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
