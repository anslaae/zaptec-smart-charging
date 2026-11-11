import { STALE_AFTER_SECONDS } from "@/lib/scheduler/heartbeat";
import { formatTime, osloHour } from "@/lib/datetime";
import { greetingPart } from "@/lib/ui/battery";
import { nb, fill } from "@/lib/i18n/nb";

/**
 * Hjem header: time-of-day greeting above the location title, and the
 * scheduler heartbeat ("Sist sjekket HH:MM") on the right. The heartbeat
 * replaces the old SchedulerStatusBadge; it is written by the cron tick, so
 * stale means cron-job.org isn't calling us and plans won't be acted on.
 */
export function AppHeader({
  userName,
  title,
  lastTickAt,
  now,
}: {
  userName: string;
  title: string;
  lastTickAt: Date | null;
  now: Date;
}) {
  const greeting = fill(nb.app.greeting[greetingPart(osloHour(now))], { name: userName });
  const secondsAgo = lastTickAt ? Math.floor((now.getTime() - lastTickAt.getTime()) / 1000) : null;
  const stale = secondsAgo == null || secondsAgo > STALE_AFTER_SECONDS;
  const heartbeatText = lastTickAt
    ? fill(stale ? nb.heartbeat.stale : nb.heartbeat.ok, { time: formatTime(lastTickAt) })
    : nb.heartbeat.never;

  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-muted">{greeting}</p>
        <h1 className="truncate text-[28px] font-bold leading-tight">{title}</h1>
      </div>
      <p
        className={`mt-1 flex max-w-[45%] items-center gap-1.5 text-right text-xs ${stale ? "text-amber" : "text-muted"}`}
      >
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${stale ? "bg-amber" : "bg-accent"}`} />
        {heartbeatText}
      </p>
    </header>
  );
}
