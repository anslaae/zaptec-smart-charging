// cron-job.org calls /api/cron/tick every minute; flag as stale past 3
// missed ticks rather than 1, to tolerate an occasional delay. Shared
// between SchedulerStatusBadge (dashboard pill) and /api/health (uptime
// monitoring) so the two never drift apart on what "stale" means.
export const STALE_AFTER_SECONDS = 3 * 60;
