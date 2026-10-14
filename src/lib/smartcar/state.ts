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
