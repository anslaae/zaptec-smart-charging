import { describe, expect, it } from "vitest";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import type { ChargerState } from "@/lib/zaptec/types";
import { chargingSinceFromLog, withChargeDuration, type StateLogPoint } from "./chargingSince";

const t0 = new Date("2026-11-19T22:25:00Z");
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const row = (min: number, mode: number, kw: number | null): StateLogPoint => ({ observedAt: at(min), operationMode: mode, powerKw: kw });
const { Charging, StoppedOrIdle, ConnectedRequesting } = ChargerOperationMode;

describe("chargingSinceFromLog (D84)", () => {
  it("is the start of the newest run of mode 3 with power", () => {
    const rows = [row(0, ConnectedRequesting, 0), row(5, Charging, 4.36), row(40, Charging, 4.4), row(90, Charging, 3.9)];
    expect(chargingSinceFromLog(rows)).toEqual(at(5));
  });

  it("a pause (mode 5, or mode 3 at ~0 kW) ends the earlier run", () => {
    const rows = [row(0, Charging, 4.4), row(30, StoppedOrIdle, 0), row(60, Charging, 4.4), row(70, Charging, 0.1), row(80, Charging, 4.3)];
    expect(chargingSinceFromLog(rows)).toEqual(at(80));
  });

  it("null when the newest row isn't drawing (the log hasn't caught up)", () => {
    expect(chargingSinceFromLog([row(0, Charging, 4.4), row(10, StoppedOrIdle, 0)])).toBeNull();
    expect(chargingSinceFromLog([])).toBeNull();
  });

  it("order of rows doesn't matter", () => {
    const rows = [row(40, Charging, 4.4), row(0, StoppedOrIdle, 0), row(5, Charging, 4.36)];
    expect(chargingSinceFromLog(rows)).toEqual(at(5));
  });
});

describe("withChargeDuration (D84)", () => {
  const base = { chargerId: "c", operationMode: Charging, chargeDurationSeconds: null } as ChargerState;

  it("fills from the log run, else the app's own start", () => {
    expect(withChargeDuration(base, at(5), at(0), at(65)).chargeDurationSeconds).toBe(3600);
    expect(withChargeDuration(base, null, at(0), at(30)).chargeDurationSeconds).toBe(1800);
  });

  it("keeps Zaptec's own value (the mock reports 701)", () => {
    expect(withChargeDuration({ ...base, chargeDurationSeconds: 120 }, at(0), null, at(60)).chargeDurationSeconds).toBe(120);
  });

  it("leaves it null when not charging or nothing is known", () => {
    expect(withChargeDuration({ ...base, operationMode: StoppedOrIdle }, at(0), null, at(60)).chargeDurationSeconds).toBeNull();
    expect(withChargeDuration(base, null, null, at(60)).chargeDurationSeconds).toBeNull();
    expect(withChargeDuration(base, at(90), null, at(60)).chargeDurationSeconds).toBeNull(); // in the future
  });
});
