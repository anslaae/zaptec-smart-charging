// cron-job.org calls /api/cron/tick every minute, but a "quiet" tick (every
// charger disconnected, nothing pending) skips writing the heartbeat
// entirely -- it only gets refreshed once per FULL_TICK_INTERVAL_MS (see
// tick-gate.ts), specifically so the database can actually go idle between
// writes instead of being kept awake by them. This has to tolerate at least
// one full such gap plus a missed tick on top, or the badge would flip to
// "stale" every time nothing's happening -- exactly the normal case this
// gate is designed for. Shared between SchedulerStatusBadge (dashboard pill)
// and /api/health (uptime monitoring) so the two never drift apart on what
// "stale" means.
export const STALE_AFTER_SECONDS = 20 * 60;
