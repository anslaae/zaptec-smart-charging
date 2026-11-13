// D75: what Hjem shows for an open, visible incident (HANDOFF §6e) -- the
// status / sub lines, the one warning card under the ring, the ring badge and
// the primary button's label. Pure; the rules live in src/lib/incidents/rules.ts.

import { fill, nb } from "@/lib/i18n/nb";
import { formatDuration, formatTime } from "@/lib/datetime";
import type { CarCase, IncidentKind } from "@/lib/incidents/rules";

export interface IncidentData {
  id: string;
  kind: IncidentKind;
  carCase: CarCase | null;
  sinceIso: string;
  /** "session" = Lad nå / automatic row, "schedule" = plan / Smart lading, "charger" = the loop guard. */
  subject: "session" | "schedule" | "charger";
  /** When charging was asked for (Lad nå tap / last plan start). */
  requestedAtIso: string | null;
  /** Values saved with the push (start_failed: count/from/to; warnings: warning). */
  detail: Record<string, unknown> | null;
  retried: boolean;
  autoEndAtIso: string | null;
}

export type IncidentTone = "fault" | "declined" | "calm";
export type IncidentBadge = "fault" | "warning" | "pause" | "check";

export interface IncidentCardView {
  tone: IncidentTone;
  title: string | null;
  body: string;
  checklist: boolean;
  retry: boolean;
  myOpel: boolean;
}

export interface IncidentView {
  status: string;
  sub: string | null;
  card: IncidentCardView | null;
  badge: IncidentBadge | null;
  hint: string | null;
  /** The filled button's label when it stops a Lad nå / automatic session. */
  stopLabel: string | null;
}

const t = nb.home.incident;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function incidentView(input: {
  incident: IncidentData;
  now: Date;
  /** Zaptec's charge time this session (seconds), for "etter {duration} lading". */
  chargeSeconds: number | null;
  /** Time still needed for the plan at the learned rate (seconds), for start_failed. */
  remainingSeconds: number | null;
}): IncidentView {
  const { incident, now } = input;
  const since = new Date(incident.sinceIso);
  const time = formatTime(since);
  const minutesSince = Math.max(0, Math.round((now.getTime() - since.getTime()) / 60_000));
  const duration = input.chargeSeconds != null && input.chargeSeconds > 0 ? formatDuration(input.chargeSeconds) : null;
  const afterCharging = (template: string) => (duration ? fill(template, { time, duration }) : null);
  const retry = !incident.retried;
  const fault = (card: Omit<IncidentCardView, "tone" | "myOpel">): IncidentCardView => ({ ...card, tone: "fault", myOpel: false });
  const declined = (title: string, body: string): IncidentCardView => ({
    tone: "declined",
    title,
    body,
    checklist: false,
    retry: false,
    myOpel: true,
  });
  const none = { hint: null, stopLabel: null };

  switch (incident.kind) {
    case "start_failed": {
      const d = incident.detail ?? {};
      const remaining = input.remainingSeconds != null ? formatDuration(input.remainingSeconds) : null;
      return {
        ...none,
        status: t.startFailed.status,
        sub: remaining ? fill(t.startFailed.sub, { time, duration: remaining }) : null,
        card: fault({
          title: t.startFailed.title,
          body: fill(t.startFailed.body, {
            count: String(d.count ?? "–"),
            from: String(d.from ?? time),
            to: String(d.to ?? time),
          }),
          checklist: true,
          retry,
        }),
        badge: "fault",
      };
    }
    case "offline":
      return {
        ...none,
        status: t.offline.status,
        sub: fill(incident.subject === "session" ? t.offline.subManual : t.offline.sub, { time }),
        card: fault({
          title: t.offline.title,
          body: fill(t.offline.body, { duration: formatDuration(minutesSince * 60) }),
          checklist: true,
          retry,
        }),
        badge: "fault",
      };
    case "locked":
      return {
        ...none,
        status: t.locked.status,
        sub: fill(t.locked.sub, { time }),
        card: fault({ title: t.locked.title, body: t.locked.body, checklist: false, retry: false }),
        badge: "fault",
      };
    case "charger_warning": {
      const warning = typeof incident.detail?.warning === "string" ? capitalize(incident.detail.warning) : "–";
      return {
        ...none,
        status: t.chargerWarning.status,
        sub: null,
        card: fault({ title: t.chargerWarning.title, body: fill(t.chargerWarning.body, { warning }), checklist: true, retry }),
        badge: "fault",
      };
    }
    case "car":
      break;
  }

  const c = t.chargeNow;
  switch (incident.carCase) {
    case "full": {
      const sub = duration ? fill(c.full.sub, { time, duration }) : null;
      return {
        status: c.full.status,
        sub,
        card: null,
        badge: "check",
        hint: incident.autoEndAtIso ? fill(c.full.hint, { time: formatTime(incident.autoEndAtIso) }) : null,
        stopLabel: c.primary,
      };
    }
    case "stopped":
      return {
        status: c.stopped.status,
        sub: afterCharging(c.stopped.sub),
        card: declined(c.stopped.title, c.stopped.body),
        badge: "warning",
        hint: c.hintOpen,
        stopLabel: c.primary,
      };
    case "idle":
      return {
        status: c.idle.status,
        sub: fill(c.idle.sub, { time, minutes: minutesSince }),
        card: { tone: "calm", title: null, body: c.idle.body, checklist: false, retry: false, myOpel: false },
        badge: "pause",
        hint: c.idle.hint,
        stopLabel: c.primary,
      };
    case "never": {
      const requested = incident.requestedAtIso ? new Date(incident.requestedAtIso) : since;
      return {
        status: c.never.status,
        sub: fill(c.never.sub, {
          time: formatTime(requested),
          minutes: Math.max(0, Math.round((now.getTime() - requested.getTime()) / 60_000)),
        }),
        card: declined(c.never.title, c.never.body),
        badge: "warning",
        hint: c.hintOpen,
        stopLabel: c.primary,
      };
    }
    case "declinedPlan":
    default:
      return {
        status: t.declinedPlan.status,
        sub: afterCharging(t.declinedPlan.sub),
        card: declined(t.declinedPlan.title, t.declinedPlan.body),
        badge: "warning",
        hint: null,
        stopLabel: incident.subject === "session" ? c.primary : null,
      };
  }
}
