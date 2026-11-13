// Aktivitet and "Siste hendelser": what people and the app did. The charger's
// own start/stop transitions (and the automatic stop right after a plug-in)
// are still logged, but they're noise next to "Bil koblet til", Lad nå or a
// plan -- they're shown only in debug mode. A repeated event within a minute
// (two taps on Lad nå) shows once. Pure.

/** Logged for diagnosis; hidden unless debug mode is on. */
export const TECHNICAL_ACTIVITY: ReadonlySet<string> = new Set([
  "charging_started",
  "charging_stopped",
  "stopped_unplanned",
]);

const REPEAT_WINDOW_MS = 60_000;

// Events whose detail is bookkeeping, not text for people: automation_paused
// keeps the Zaptec session id there (D65).
const INTERNAL_DETAIL: ReadonlySet<string> = new Set(["automation_paused"]);

// D75: these labels carry {placeholders}; the event's detail is a JSON object
// with their values ("Bilen sluttet å lade – 64 %").
const TEMPLATED: ReadonlySet<string> = new Set([
  "car_stopped",
  "start_failed",
  "charger_warning",
  "retry",
  "unplugged_before_target",
]);

function templateValues(detail: string | null): Record<string, string | number> | null {
  if (!detail) return null;
  try {
    const value: unknown = JSON.parse(detail);
    return value && typeof value === "object" ? (value as Record<string, string | number>) : null;
  } catch {
    return null;
  }
}

/** The label for an event, with any {placeholders} filled from its detail. */
export function activityText(event: { type: string; detail: string | null }, labels: Record<string, string>): string {
  const label = labels[event.type] ?? event.type;
  if (!TEMPLATED.has(event.type)) return label;
  const values = templateValues(event.detail) ?? {};
  return label.replace(/\{(\w+)\}/g, (_, key: string) => (values[key] != null ? String(values[key]) : "–"));
}

/** The detail line to show under an event, or null. */
export function shownDetail(event: { type: string; detail: string | null }): string | null {
  return INTERNAL_DETAIL.has(event.type) || TEMPLATED.has(event.type) ? null : event.detail;
}

export interface ActivityLike {
  type: string;
  userId?: string | null;
  createdAt: Date;
}

/**
 * `events` newest first. Returns every event flagged technical or not, with
 * repeats of the same non-technical event (same type and person, within a
 * minute of the one kept) left out; the newest of a run is the one kept.
 */
export function visibleActivity<T extends ActivityLike>(events: T[]): { event: T; technical: boolean }[] {
  const out: { event: T; technical: boolean }[] = [];
  let kept: T | null = null;
  for (const event of events) {
    if (TECHNICAL_ACTIVITY.has(event.type)) {
      out.push({ event, technical: true });
      continue;
    }
    const repeat =
      kept != null &&
      kept.type === event.type &&
      (kept.userId ?? null) === (event.userId ?? null) &&
      Math.abs(kept.createdAt.getTime() - event.createdAt.getTime()) <= REPEAT_WINDOW_MS;
    if (repeat) continue;
    out.push({ event, technical: false });
    kept = event;
  }
  return out;
}
