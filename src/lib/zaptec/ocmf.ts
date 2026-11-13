// Zaptec's signed meter readings (OCMF, "Open Charge Metering Format") and
// the CompletedSession observation (723) that carries them (D72).
//
// Verified against a read-only GET of the production charger on 2026-11-13:
// 723's value is JSON with SessionId, Energy (kWh), StartDateTime,
// EndDateTime and SignedSession = "OCMF|{...}". Its RD array holds the
// charger's cumulative meter register (RV, kWh) at the session's begin
// (TX "B"), at every whole hour (TX "T") and at the end (TX "E"); TM looks
// like "2026-11-13T06:00:00,000+00:00 R". Observation 554 SignedMeterValue
// has the same shape with one hourly reading. Pure, unit tested.

import type { LastCompletedSession, MeterReading } from "./types";

export type { MeterReading };

/** "2026-11-13T06:00:00,000+00:00 R" → Date; null if it doesn't parse. */
export function parseOcmfTime(tm: string): Date | null {
  const iso = tm.trim().split(/\s+/)[0]?.replace(",", ".");
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Meter readings from an "OCMF|{...}" string, oldest first; null when there are none. */
export function parseOcmfReadings(signed: string | null | undefined): MeterReading[] | null {
  if (!signed) return null;
  const json = signed.startsWith("OCMF|") ? signed.slice(5).split("|")[0] : signed;
  try {
    const payload = JSON.parse(json) as { RD?: { TM?: string; RV?: number; RU?: string }[] };
    const readings = (payload.RD ?? [])
      .map((rd) => {
        const at = rd.TM ? parseOcmfTime(rd.TM) : null;
        const kwh = typeof rd.RV === "number" ? (rd.RU === "Wh" ? rd.RV / 1000 : rd.RV) : NaN;
        return at && Number.isFinite(kwh) ? { at: at.toISOString(), kwh } : null;
      })
      .filter((r): r is MeterReading => r != null)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return readings.length > 0 ? readings : null;
  } catch {
    return null;
  }
}

/**
 * Zaptec times are UTC; production's 723 has a trailing Z, chargehistory's
 * don't (D70). Without a zone, `new Date()` would read local time.
 */
function asUtc(time: string): string {
  return /(Z|[+-]\d\d:?\d\d)$/i.test(time) || !/T\d/.test(time) ? time : `${time}Z`;
}

/** CompletedSession (723)'s value; defensive, since Zaptec doesn't document its shape. */
export function parseCompletedSession(raw: string | null | undefined): LastCompletedSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      SessionId?: string;
      StartDateTime?: string;
      EndDateTime?: string;
      Energy?: number;
      SignedSession?: string;
    };
    if (!parsed.StartDateTime || !parsed.EndDateTime || parsed.Energy == null) return null;
    return {
      sessionId: parsed.SessionId ?? null,
      startedAt: asUtc(parsed.StartDateTime),
      endedAt: asUtc(parsed.EndDateTime),
      energyKwh: parsed.Energy,
      meterReadings: parseOcmfReadings(parsed.SignedSession),
    };
  } catch {
    return null;
  }
}

export interface HourEnergy {
  /** Start of the clock hour (UTC; Oslo's offset is whole hours, so these are Oslo hours too). */
  hourStart: Date;
  kwh: number;
}

const HOUR_MS = 3_600_000;

/** The meter register at a moment: linear between readings, flat outside them. */
function meterAt(readings: { t: number; kwh: number }[], t: number): number {
  if (t <= readings[0].t) return readings[0].kwh;
  const last = readings[readings.length - 1];
  if (t >= last.t) return last.kwh;
  for (let i = 1; i < readings.length; i++) {
    const b = readings[i];
    if (t <= b.t) {
      const a = readings[i - 1];
      return b.t === a.t ? b.kwh : a.kwh + ((b.kwh - a.kwh) * (t - a.t)) / (b.t - a.t);
    }
  }
  return last.kwh;
}

/**
 * kWh drawn in each clock hour of [from, to], from meter readings (any
 * number of sessions on one charger, merged). Within an hour the energy is
 * spread evenly between two readings -- with Zaptec's hourly readings that
 * means each whole hour is exact. Null when the readings don't cover the
 * window or show no energy in it (the caller then spreads evenly).
 */
export function hourlyEnergy(readings: MeterReading[], from: Date, to: Date): HourEnergy[] | null {
  if (readings.length < 2 || to.getTime() <= from.getTime()) return null;
  const points = readings
    .map((r) => ({ t: Date.parse(r.at), kwh: r.kwh }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (points.length < 2) return null;
  const start = from.getTime();
  const end = to.getTime();
  if (points[points.length - 1].t <= start || points[0].t >= end) return null;

  const hours: HourEnergy[] = [];
  for (let h = Math.floor(start / HOUR_MS) * HOUR_MS; h < end; h += HOUR_MS) {
    const a = Math.max(start, h);
    const b = Math.min(end, h + HOUR_MS);
    const kwh = Math.max(0, meterAt(points, b) - meterAt(points, a));
    if (kwh > 0) hours.push({ hourStart: new Date(h), kwh: Math.round(kwh * 1000) / 1000 });
  }
  return hours.length > 0 ? hours : null;
}
