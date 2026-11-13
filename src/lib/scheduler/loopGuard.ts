// Safety net against on/off loops (DECISIONS D65). Zaptec gives up on a car
// that is stopped and started too often ("stopped too many times, reconnect
// the car") -- on 13 Nov 2026 a plan bug did that in about 40 minutes. The
// specific bug is fixed (D64); this catches the next one of the same shape,
// whatever code path causes it: if the app's own automated commands for a
// charger change direction (start <-> stop) MAX_DIRECTION_CHANGES times
// within GUARD_WINDOW_MS, the app stops sending automated commands to that
// charger until the car is re-plugged or a person does something in the app.
//
// Pure, so the rule can be unit tested; loopGuard.server.ts loads the inputs.

export type CommandDirection = "start" | "stop";

export interface AutomatedCommand {
  at: Date;
  direction: CommandDirection;
}

/** start <-> stop changes within the window that trip the guard. Last night's loop hit 4 within 5 minutes. */
export const MAX_DIRECTION_CHANGES = 4;
export const GUARD_WINDOW_MS = 30 * 60_000;
/** Stored as the plan's lastError while the guard holds its commands back (English, like the engine reasons). */
export const AUTOMATION_PAUSED_REASON = "Automation paused after repeated on/off";

export type GuardStatus = "ok" | "trip" | "paused";

/**
 * - "paused": tripped earlier and nothing has reset it since -- send no automated commands.
 * - "trip": trips now -- log it, push once, and send nothing this tick.
 * - "ok": carry on.
 *
 * lastResetAt: the latest plug-in/unplug, new Zaptec session marker, or
 * event a person triggered in the app. Commands before it don't count.
 *
 * tripSessionId / currentSessionId: the Zaptec session when the guard
 * tripped, and now. A different session means the car was re-plugged --
 * even between two ticks, with no plan open, when no plug-in event is
 * logged -- and clears the guard, so the push's "koble bilen fra og til
 * igjen" always works.
 *
 * Commands from before the last trip never count again: once cleared, the
 * guard starts from zero instead of re-tripping on the loop it caught.
 */
export function loopGuardStatus(input: {
  commands: AutomatedCommand[];
  lastTripAt: Date | null;
  lastResetAt: Date | null;
  tripSessionId?: string | null;
  currentSessionId?: string | null;
  now: Date;
}): GuardStatus {
  const resetAt = input.lastResetAt?.getTime() ?? -Infinity;
  const tripAt = input.lastTripAt?.getTime() ?? -Infinity;
  const replugged =
    input.tripSessionId != null && input.currentSessionId != null && input.tripSessionId !== input.currentSessionId;
  if (tripAt > resetAt && !replugged) return "paused";
  const since = Math.max(input.now.getTime() - GUARD_WINDOW_MS, resetAt, tripAt);
  const recent = input.commands
    .filter((c) => c.at.getTime() > since)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  let changes = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].direction !== recent[i - 1].direction) changes++;
  }
  return changes >= MAX_DIRECTION_CHANGES ? "trip" : "ok";
}
