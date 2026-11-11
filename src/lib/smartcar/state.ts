import type { SmartcarSignalApiResponse, StateOfCharge } from "./types";

// Pure parsing, deliberately not "server-only" -- unit-testable without a
// real request, same reasoning as zaptec/state.ts. Returns null for any
// unexpected shape rather than throwing: a malformed/unsupported signal
// response should just mean "no reading," never break the dashboard.
export function parseStateOfCharge(raw: SmartcarSignalApiResponse): StateOfCharge | null {
  const attributes = raw.data?.attributes;
  if (!attributes || attributes.status.value !== "SUCCESS") return null;

  const body = attributes.body;
  if (!body || body.unit !== "percent" || typeof body.value !== "number") return null;

  const oemUpdatedAtRaw = raw.data.meta?.oemUpdatedAt;
  if (!oemUpdatedAtRaw) return null;
  const oemUpdatedAt = new Date(oemUpdatedAtRaw);
  if (Number.isNaN(oemUpdatedAt.getTime())) return null;

  return { percent: body.value, oemUpdatedAt };
}

/**
 * The newer of two battery readings: the live signals API and the latest
 * webhook row in vehicle_telemetry carry the same OEM value, but either can
 * be missing (the API call fails now and then) or behind (the API response is
 * cached for 30 minutes). Ties go to the first.
 */
export function newerReading(a: StateOfCharge | null, b: StateOfCharge | null): StateOfCharge | null {
  if (!a) return b;
  if (!b) return a;
  return b.oemUpdatedAt.getTime() > a.oemUpdatedAt.getTime() ? b : a;
}
