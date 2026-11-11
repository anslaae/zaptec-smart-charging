import { describe, expect, it } from "vitest";
import {
  formatDayAndTime,
  formatDayLabel,
  formatDuration,
  formatKr,
  formatKw,
  formatKwh,
  formatOsloDateTime,
  formatShortDate,
  formatTime,
  osloHour,
  relativeDay,
} from "./datetime";

// Intl's nb-NO output uses non-breaking spaces as the thousands separator.
const nbsp = (s: string) => s.replace(/[  ]/g, " ");

describe("Oslo time formatting", () => {
  it("formats 24h time in Oslo (winter, UTC+1)", () => {
    expect(formatTime("2026-11-10T06:30:00Z")).toBe("07:30");
  });

  it("formats 24h time in Oslo (summer, UTC+2)", () => {
    expect(formatTime("2026-07-10T21:05:00Z")).toBe("23:05");
  });

  it("formats short dates like 'tir. 10. nov.'", () => {
    expect(formatShortDate("2026-11-10T06:30:00Z")).toBe("tir. 10. nov.");
  });

  it("formats the shared date-time in Norwegian", () => {
    expect(formatOsloDateTime("2026-11-10T06:30:00Z")).toBe("10. nov. 2026, 07:30");
  });

  it("reads the hour on the Oslo wall clock", () => {
    expect(osloHour(new Date("2026-11-10T23:30:00Z"))).toBe(0);
    expect(osloHour(new Date("2026-11-10T06:30:00Z"))).toBe(7);
  });
});

describe("relative days", () => {
  const now = new Date("2026-11-09T21:00:00Z"); // Mon 22:00 in Oslo

  it("says i dag / i morgen / i går on Oslo calendar days", () => {
    expect(relativeDay("2026-11-09T05:00:00Z", now)).toBe("i dag");
    // 23:30 UTC on the 9th is already the 10th in Oslo
    expect(relativeDay("2026-11-09T23:30:00Z", now)).toBe("i morgen");
    expect(relativeDay("2026-11-08T12:00:00Z", now)).toBe("i går");
  });

  it("returns null for other days and falls back to a short date", () => {
    expect(relativeDay("2026-11-12T12:00:00Z", now)).toBeNull();
    expect(formatDayLabel("2026-11-12T12:00:00Z", now)).toBe("tor. 12. nov.");
  });

  it("counts days correctly across the DST change", () => {
    const beforeDst = new Date("2026-10-24T22:00:00Z"); // Sun 25 Oct 00:00 CEST
    expect(relativeDay("2026-10-25T23:30:00Z", beforeDst)).toBe("i morgen"); // Mon 26 Oct 00:30 CET
  });

  it("combines day and time", () => {
    expect(formatDayAndTime("2026-11-10T06:30:00Z", now)).toBe("i morgen 07:30");
  });

  it("calls the coming small hours i natt", () => {
    expect(formatDayAndTime("2026-11-10T02:30:00Z", now)).toBe("i natt 03:30");
    // ...but not a past night, and not a night more than 12 h away
    expect(formatDayLabel("2026-11-09T02:30:00Z", now)).toBe("i dag");
    expect(formatDayLabel("2026-11-11T02:30:00Z", now)).toBe("ons. 11. nov.");
  });
});

describe("number formatting", () => {
  it("uses a decimal comma and units", () => {
    expect(formatKw(7.1)).toBe("7,1 kW");
    expect(formatKwh(15.64)).toBe("15,6 kWh");
    expect(formatKr(123.4)).toBe("123,40 kr");
    expect(nbsp(formatKr(1234.5))).toBe("1 234,50 kr");
  });

  it("formats durations in minutes and hours", () => {
    expect(formatDuration(12 * 60)).toBe("12 min");
    expect(formatDuration(65 * 60)).toBe("1 t 5 min");
    expect(formatDuration(2 * 3600)).toBe("2 t");
  });
});
