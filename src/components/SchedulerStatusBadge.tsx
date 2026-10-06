const STALE_AFTER_SECONDS = 10 * 60;

function formatAgo(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s ago`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s ago`;
}

// Reflects the scheduler_heartbeat row, updated on every tick regardless of
// whether there were schedules to act on -- so this is specifically "is the
// external cron (cron-job.org) actually calling us", not "is a schedule
// progressing".
export function SchedulerStatusBadge({ lastTickAt }: { lastTickAt: Date | null }) {
  const secondsAgo = lastTickAt
    ? Math.floor((new Date().getTime() - lastTickAt.getTime()) / 1000)
    : null;
  const isStale = secondsAgo == null || secondsAgo > STALE_AFTER_SECONDS;

  return (
    <span
      title={secondsAgo != null ? `Last tick ${formatAgo(secondsAgo)}` : "No tick recorded yet"}
      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        isStale
          ? "bg-red-500/15 text-red-700 dark:text-red-400"
          : "bg-green-500/15 text-green-700 dark:text-green-400"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isStale ? "bg-red-500" : "bg-green-500"}`} />
      {isStale ? "Schedule deactivated" : "Scheduler active"}
    </span>
  );
}
