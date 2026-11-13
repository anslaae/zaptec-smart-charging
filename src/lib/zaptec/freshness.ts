// Lad nå / Forvarm / Stopp from a screen that may be out of date (HANDOVER
// backlog "Fresh status on app open, and Lad nå from two devices"; D71).
//
// Before a charger command, the server action re-reads the charger and the
// open rows, and compares them with what the tapping device was showing (the
// `seen` field its form carries). Pure, so it's unit tested; the action
// supplies the fresh facts.

import { fill, nb } from "@/lib/i18n/nb";
import { formatTime } from "@/lib/datetime";

/** What the device rendered when the person tapped (the open Lad nå/Forvarm/automatic row and user plan). */
export interface SeenState {
  rowId: string | null;
  planId: string | null;
}

export type CommandIntent = "manual" | "preheat" | "stop";

export interface OpenRowFact {
  id: string;
  kind: string;
  startedAt: Date;
  startedByName: string | null;
}

export type Precheck =
  | { kind: "proceed" }
  /** Nothing to do: it is already as asked. A notice, not an error. */
  | { kind: "already"; message: string }
  /** The device showed something else than what's true now: refuse, refresh. */
  | { kind: "changed"; message: string };

/**
 * A row opened this recently counts as started even if Zaptec doesn't report
 * charging yet: its /state lags a command by some seconds.
 */
export const JUST_STARTED_MS = 60_000;

/** The form field the client sends; tolerant of anything malformed (then: no comparison). */
export function parseSeen(raw: FormDataEntryValue | null): SeenState | null {
  if (typeof raw !== "string" || raw === "") return null;
  try {
    const value = JSON.parse(raw) as { rowId?: unknown; planId?: unknown };
    const id = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
    return { rowId: id(value.rowId), planId: id(value.planId) };
  } catch {
    return null;
  }
}

export function serializeSeen(seen: SeenState): string {
  return JSON.stringify(seen);
}

function startedBy(row: OpenRowFact): string {
  return row.startedByName
    ? fill(nb.freshness.startedBy, { name: row.startedByName, time: formatTime(row.startedAt) })
    : fill(nb.freshness.startedAt, { time: formatTime(row.startedAt) });
}

export function precheckCommand(input: {
  intent: CommandIntent;
  /** null: an old client or a deep link -- only the "already" check applies. */
  seen: SeenState | null;
  /** The charger draws power right now (isCurrentlyCharging on a fresh read). */
  charging: boolean;
  /** The open non-guest row on this charger, if any (D66: at most one). */
  row: OpenRowFact | null;
  /** The open user plan on this charger, if any (Smart lading doesn't count: it steps aside). */
  planId: string | null;
  now: Date;
}): Precheck {
  const { intent, seen, charging, row, planId, now } = input;

  if (intent === "stop") {
    if (!row && !charging) return { kind: "already", message: nb.freshness.alreadyStopped };
  } else if (row && row.kind === intent) {
    const justStarted = now.getTime() - row.startedAt.getTime() < JUST_STARTED_MS;
    if (charging || justStarted) {
      const template = intent === "manual" ? nb.freshness.alreadyCharging : nb.freshness.alreadyPreheating;
      return { kind: "already", message: fill(template, { by: startedBy(row) }) };
    }
  }

  if (seen && (seen.rowId !== (row?.id ?? null) || seen.planId !== planId)) {
    return { kind: "changed", message: nb.freshness.changed };
  }
  return { kind: "proceed" };
}
