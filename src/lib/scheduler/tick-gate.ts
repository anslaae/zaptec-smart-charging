import { ChargerOperationMode } from "@/lib/zaptec/constants";

/**
 * How long a "quiet" tick (every charger disconnected, nothing pending) can
 * go without a full database check. Neon auto-suspends the database after a
 * few idle minutes, but a full tick running every single minute -- even one
 * that only reads -- never gives it the chance. This interval has to be
 * comfortably longer than Neon's suspend window for that to matter, so it's
 * also what the scheduler heartbeat (see heartbeat.ts) rides on: a full tick
 * writes it, so the badge is at most this stale while nothing is happening.
 */
export const FULL_TICK_INTERVAL_MS = 10 * 60 * 1000;

export interface QuietTickMemory {
  checkedAt: Date;
  /** Every charger was disconnected, no pending/active schedule existed, and no manual session was left open. */
  allQuiet: boolean;
}

/**
 * Whether this tick can skip the database entirely. Only safe when nothing
 * could possibly need enforcing or recording: every charger is disconnected
 * *right now* (checked live against Zaptec, which costs nothing in Neon
 * terms), and the last tick that actually checked the database found the
 * same and did so recently enough. That makes this self-healing -- a cold
 * start (no memory yet) or a stale/dirty last check always falls through to
 * a real tick, which then re-establishes the memory for next time.
 */
export function canSkipDbTouch(
  chargerModes: (number | null)[],
  now: Date,
  lastFullTick: QuietTickMemory | null,
): boolean {
  if (!lastFullTick || !lastFullTick.allQuiet) return false;
  if (now.getTime() - lastFullTick.checkedAt.getTime() >= FULL_TICK_INTERVAL_MS) return false;
  return chargerModes.every((mode) => mode === ChargerOperationMode.Disconnected);
}
