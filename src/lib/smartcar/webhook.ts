import { createHmac, timingSafeEqual } from "node:crypto";
import { STATE_OF_CHARGE_SIGNAL, ODOMETER_SIGNAL } from "./constants";
import type { SmartcarWebhookSignal } from "./types";

// Deliberately not "server-only" and no DB/fetch calls -- pure functions,
// unit-testable the same way zaptec/state.ts and smartcar/state.ts are.

export function computeHmac(payload: string, managementToken: string): string {
  return createHmac("sha256", managementToken).update(payload).digest("hex");
}

// Smartcar requires comparing against the *raw* body, before any JSON
// parsing -- a framework's own parsing can reorder/reformat the body and
// break the signature, per Smartcar's own docs.
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  managementToken: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = computeHmac(rawBody, managementToken);
  // Lengths must match for timingSafeEqual; a mismatched length is simply not
  // a valid signature.
  if (expected.length !== signatureHeader.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}

export interface ParsedVehicleSignals {
  batteryPercent: number | null;
  batteryReportedAt: Date | null;
  odometerKm: number | null;
  odometerReportedAt: Date | null;
}

function parseOemUpdatedAt(raw: string | number | undefined): Date | null {
  if (raw == null) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Pulls whichever of the two signals this app cares about are present in a
// VEHICLE_STATE delivery's signals[] -- a delivery only includes the
// signal(s) that triggered it plus any configured "always include" data
// signals, so either side (or both) can be absent.
export function parseVehicleStateSignals(signals: SmartcarWebhookSignal[] | undefined): ParsedVehicleSignals {
  const result: ParsedVehicleSignals = {
    batteryPercent: null,
    batteryReportedAt: null,
    odometerKm: null,
    odometerReportedAt: null,
  };
  if (!signals) return result;

  for (const signal of signals) {
    if (signal.status?.value !== "SUCCESS") continue;
    const value = signal.body?.value;
    const reportedAt = parseOemUpdatedAt(signal.meta?.oemUpdatedAt);
    if (reportedAt == null || typeof value !== "number") continue;

    if (signal.code === STATE_OF_CHARGE_SIGNAL) {
      result.batteryPercent = value;
      result.batteryReportedAt = reportedAt;
    } else if (signal.code === ODOMETER_SIGNAL) {
      result.odometerKm = value;
      result.odometerReportedAt = reportedAt;
    }
  }

  return result;
}
