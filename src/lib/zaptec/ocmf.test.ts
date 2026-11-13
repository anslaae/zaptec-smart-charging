import { describe, expect, it } from "vitest";
import { hourlyEnergy, parseCompletedSession, parseOcmfReadings, parseOcmfTime } from "./ocmf";

// Shape of the production CompletedSession (723) on 2026-11-13, serial blanked.
const rd = (tm: string, tx: string, rv: number) =>
  ({ TM: `${tm},000+00:00 R`, TX: tx, RV: rv, RI: "1-0:1.8.0", RU: "kWh", RT: "AC", ST: "G" });
const signed =
  "OCMF|" +
  JSON.stringify({
    FV: "1.0",
    GI: "ZAPTEC GO",
    GS: "ZAP000000",
    PG: "T1",
    RD: [
      rd("2026-11-13T05:41:27", "B", 431.595),
      rd("2026-11-13T06:00:00", "T", 432.839),
      rd("2026-11-13T07:00:00", "T", 437.178),
      rd("2026-11-13T08:00:00", "T", 441.424),
      rd("2026-11-13T09:00:00", "T", 441.837),
      rd("2026-11-13T09:16:41", "E", 441.837),
    ],
  });
const completedRaw = JSON.stringify({
  SessionId: "52f99b26-0000-4000-9000-000000000000",
  Energy: 10.242,
  StartDateTime: "2026-11-13T05:41:27.596208Z",
  EndDateTime: "2026-11-13T09:16:41.260946Z",
  ReliableClock: true,
  StoppedByRFID: false,
  SignedSession: signed,
});

describe("parseOcmfTime", () => {
  it("reads Zaptec's comma-decimal timestamps with a trailing flag", () => {
    expect(parseOcmfTime("2026-11-13T06:00:00,000+00:00 R")?.toISOString()).toBe("2026-11-13T06:00:00.000Z");
    expect(parseOcmfTime("nonsense")).toBeNull();
  });
});

describe("parseOcmfReadings", () => {
  it("returns the meter register at begin, each hour and end", () => {
    const readings = parseOcmfReadings(signed)!;
    expect(readings).toHaveLength(6);
    expect(readings[0]).toEqual({ at: "2026-11-13T05:41:27.000Z", kwh: 431.595 });
    expect(readings[5].kwh).toBe(441.837);
  });
  it("is null for missing or broken input", () => {
    expect(parseOcmfReadings(null)).toBeNull();
    expect(parseOcmfReadings("OCMF|{broken")).toBeNull();
    expect(parseOcmfReadings('OCMF|{"RD":[]}')).toBeNull();
  });
  it("converts Wh to kWh", () => {
    expect(parseOcmfReadings('OCMF|{"RD":[{"TM":"2026-11-13T06:00:00,000+00:00 R","RV":1500,"RU":"Wh"}]}')).toEqual([
      { at: "2026-11-13T06:00:00.000Z", kwh: 1.5 },
    ]);
  });
});

describe("parseCompletedSession", () => {
  it("reads the session id, energy and readings", () => {
    const parsed = parseCompletedSession(completedRaw)!;
    expect(parsed.sessionId).toBe("52f99b26-0000-4000-9000-000000000000");
    expect(parsed.energyKwh).toBe(10.242);
    expect(parsed.meterReadings).toHaveLength(6);
  });
  it("still works for the older shape without SessionId or SignedSession", () => {
    expect(parseCompletedSession(JSON.stringify({ StartDateTime: "a", EndDateTime: "b", Energy: 1 }))).toEqual({
      sessionId: null,
      startedAt: "a",
      endedAt: "b",
      energyKwh: 1,
      meterReadings: null,
    });
    expect(parseCompletedSession("{")).toBeNull();
  });
});

describe("hourlyEnergy", () => {
  const readings = parseOcmfReadings(signed)!;

  it("gives the exact kWh of each clock hour of the session", () => {
    const hours = hourlyEnergy(readings, new Date("2026-11-13T05:41:27Z"), new Date("2026-11-13T09:16:41Z"))!;
    expect(hours.map((h) => [h.hourStart.toISOString(), h.kwh])).toEqual([
      ["2026-11-13T05:00:00.000Z", 1.244],
      ["2026-11-13T06:00:00.000Z", 4.339],
      ["2026-11-13T07:00:00.000Z", 4.246],
      ["2026-11-13T08:00:00.000Z", 0.413],
    ]);
    expect(hours.reduce((s, h) => s + h.kwh, 0)).toBeCloseTo(10.242, 3);
  });

  it("splits a part of the session (a row that started later) by interpolation", () => {
    const hours = hourlyEnergy(readings, new Date("2026-11-13T06:30:00Z"), new Date("2026-11-13T07:30:00Z"))!;
    expect(hours[0].kwh).toBeCloseTo(4.339 / 2, 2);
    expect(hours[1].kwh).toBeCloseTo(4.246 / 2, 2);
  });

  it("is null when the readings don't cover the window", () => {
    expect(hourlyEnergy(readings, new Date("2026-11-14T06:00:00Z"), new Date("2026-11-14T07:00:00Z"))).toBeNull();
    expect(hourlyEnergy(readings.slice(0, 1), new Date("2026-11-13T05:00:00Z"), new Date("2026-11-13T09:00:00Z"))).toBeNull();
    expect(hourlyEnergy(readings, new Date("2026-11-13T09:00:00Z"), new Date("2026-11-13T09:16:00Z"))).toBeNull();
  });
});

describe("parseCompletedSession times", () => {
  it("reads zone-less Zaptec times as UTC, keeps explicit zones", () => {
    const parsed = parseCompletedSession(
      JSON.stringify({ StartDateTime: "2026-11-13T05:41:27.597", EndDateTime: "2026-11-13T09:16:41+01:00", Energy: 1 }),
    )!;
    expect(parsed.startedAt).toBe("2026-11-13T05:41:27.597Z");
    expect(parsed.endedAt).toBe("2026-11-13T09:16:41+01:00");
  });
});
