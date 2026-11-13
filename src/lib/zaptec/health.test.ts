import { describe, expect, it } from "vitest";
import { chargerHealth, warningNames } from "./health";

describe("warningNames", () => {
  it("is empty for 0, null or garbage", () => {
    expect(warningNames(0)).toEqual([]);
    expect(warningNames(null)).toEqual([]);
    expect(warningNames(Number.NaN)).toEqual([]);
  });
  it("names the set bits, including ones above 2^32", () => {
    expect(warningNames(1 + 16)).toEqual(["WARNING_HUMIDITY", "WARNING_MAX_SESSION_RESTART"]);
    expect(warningNames(4294967296)).toEqual(["WARNING_MCU_BOOTLOADER"]);
  });
  it("reports bits it doesn't know", () => {
    expect(warningNames(32768)).toEqual(["UNKNOWN_32768"]);
  });
});

describe("chargerHealth", () => {
  it("is fine with no warnings, and shows the signal in the detail", () => {
    expect(chargerHealth({ isOnline: true, warnings: 0, notifications: 0, signalDbm: -75 })).toEqual({
      level: "ok",
      homeLine: null,
      detail: "Tilkoblet · ingen feil · signal -75 dBm",
      warningCodes: [],
    });
  });

  it("puts a known warning in plain Norwegian on Hjem", () => {
    const health = chargerHealth({ isOnline: true, warnings: 16, notifications: 0, signalDbm: null });
    expect(health.level).toBe("warning");
    expect(health.homeLine).toBe("Laderen melder en feil: stoppet for mange ganger – koble bilen fra og til");
    expect(health.detail).toContain("WARNING_MAX_SESSION_RESTART");
  });

  it("falls back to the code for warnings without a Norwegian text", () => {
    expect(chargerHealth({ isOnline: true, warnings: 512, notifications: null, signalDbm: null }).homeLine).toBe(
      "Laderen melder en feil: kode 512",
    );
  });

  it("offline wins, and Hjem's existing offline line covers it", () => {
    const health = chargerHealth({ isOnline: false, warnings: 16, notifications: 0, signalDbm: -70 });
    expect(health.level).toBe("offline");
    expect(health.homeLine).toBeNull();
  });
});
