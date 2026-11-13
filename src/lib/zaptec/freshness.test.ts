import { describe, expect, it } from "vitest";
import { JUST_STARTED_MS, parseSeen, precheckCommand, serializeSeen, type OpenRowFact } from "./freshness";

const now = new Date("2026-11-13T20:10:00Z");
const row = (kind: string, agoMs: number, name: string | null = "Astrid"): OpenRowFact => ({
  id: `row-${kind}`,
  kind,
  startedAt: new Date(now.getTime() - agoMs),
  startedByName: name,
});

describe("parseSeen / serializeSeen", () => {
  it("round-trips", () => {
    expect(parseSeen(serializeSeen({ rowId: "r1", planId: null }))).toEqual({ rowId: "r1", planId: null });
  });
  it("treats missing or malformed input as no comparison", () => {
    expect(parseSeen(null)).toBeNull();
    expect(parseSeen("")).toBeNull();
    expect(parseSeen("{nope")).toBeNull();
    expect(parseSeen(JSON.stringify({ rowId: 5, planId: "" }))).toEqual({ rowId: null, planId: null });
  });
});

describe("precheckCommand: Lad nå", () => {
  it("proceeds when the screen matches", () => {
    expect(
      precheckCommand({ intent: "manual", seen: { rowId: null, planId: null }, charging: false, row: null, planId: null, now }),
    ).toEqual({ kind: "proceed" });
  });

  it("says who started it when it is already charging (second phone)", () => {
    const result = precheckCommand({
      intent: "manual",
      seen: { rowId: null, planId: null },
      charging: true,
      row: row("manual", 10 * 60_000),
      planId: null,
      now,
    });
    expect(result.kind).toBe("already");
    expect(result.kind === "already" && result.message).toMatch(/^Lader allerede \(startet av Astrid \d\d:\d\d\)$/);
  });

  it("counts a row opened moments ago as started while Zaptec still lags", () => {
    const result = precheckCommand({
      intent: "manual",
      seen: null,
      charging: false,
      row: row("manual", JUST_STARTED_MS - 1000),
      planId: null,
      now,
    });
    expect(result.kind).toBe("already");
  });

  it("re-sends the start for an older row that isn't charging (a retry)", () => {
    expect(
      precheckCommand({
        intent: "manual",
        seen: { rowId: "row-manual", planId: null },
        charging: false,
        row: row("manual", JUST_STARTED_MS + 1000),
        planId: null,
        now,
      }),
    ).toEqual({ kind: "proceed" });
  });

  it("names no person when nobody is recorded as starting it", () => {
    const result = precheckCommand({ intent: "manual", seen: null, charging: true, row: row("manual", 5_000, null), planId: null, now });
    expect(result.kind === "already" && result.message).toMatch(/^Lader allerede \(startet \d\d:\d\d\)$/);
  });

  it("refuses when a plan appeared that the screen didn't show", () => {
    expect(
      precheckCommand({ intent: "manual", seen: { rowId: null, planId: null }, charging: false, row: null, planId: "p1", now }),
    ).toEqual({ kind: "changed", message: "Statusen har endret seg – sjekk igjen" });
  });

  it("refuses when the plan the screen confirmed cancelling is a different one", () => {
    expect(
      precheckCommand({ intent: "manual", seen: { rowId: null, planId: "p-old" }, charging: false, row: null, planId: "p-new", now })
        .kind,
    ).toBe("changed");
  });

  it("without `seen` (deep link, old client) only the already-check applies", () => {
    expect(precheckCommand({ intent: "manual", seen: null, charging: false, row: null, planId: "p1", now })).toEqual({
      kind: "proceed",
    });
  });

  it("Lad nå while Forvarm runs (shown) proceeds -- it switches kinds", () => {
    expect(
      precheckCommand({
        intent: "manual",
        seen: { rowId: "row-preheat", planId: null },
        charging: true,
        row: row("preheat", 5 * 60_000),
        planId: null,
        now,
      }),
    ).toEqual({ kind: "proceed" });
  });
});

describe("precheckCommand: Forvarm", () => {
  it("is already on when a Forvarm row draws power", () => {
    const result = precheckCommand({
      intent: "preheat",
      seen: { rowId: null, planId: null },
      charging: true,
      row: row("preheat", 120_000),
      planId: null,
      now,
    });
    expect(result.kind === "already" && result.message).toMatch(/^Forvarmer allerede/);
  });
});

describe("precheckCommand: Stopp", () => {
  it("says already stopped when nothing runs", () => {
    expect(
      precheckCommand({ intent: "stop", seen: { rowId: "row-manual", planId: null }, charging: false, row: null, planId: null, now }),
    ).toEqual({ kind: "already", message: "Allerede stoppet" });
  });

  it("refuses to stop a session someone else started after the screen was drawn", () => {
    expect(
      precheckCommand({
        intent: "stop",
        seen: { rowId: "row-old", planId: null },
        charging: true,
        row: row("manual", 30_000),
        planId: null,
        now,
      }).kind,
    ).toBe("changed");
  });

  it("refuses when the shown session ended and a plan now charges", () => {
    expect(
      precheckCommand({ intent: "stop", seen: { rowId: "row-manual", planId: null }, charging: true, row: null, planId: "p1", now })
        .kind,
    ).toBe("changed");
  });

  it("stops the session the screen shows", () => {
    expect(
      precheckCommand({
        intent: "stop",
        seen: { rowId: "row-manual", planId: null },
        charging: true,
        row: row("manual", 30_000),
        planId: null,
        now,
      }),
    ).toEqual({ kind: "proceed" });
  });

  it("stops unauthorised charging with nothing open (old client)", () => {
    expect(precheckCommand({ intent: "stop", seen: null, charging: true, row: null, planId: null, now })).toEqual({
      kind: "proceed",
    });
  });
});
