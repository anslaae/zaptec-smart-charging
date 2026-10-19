import { describe, expect, it } from "vitest";
import { canSkipDbTouch, FULL_TICK_INTERVAL_MS, type QuietTickMemory } from "./tick-gate";
import { ChargerOperationMode } from "@/lib/zaptec/constants";

const now = new Date("2026-01-01T12:00:00Z");

function quietMemory(overrides: Partial<QuietTickMemory> = {}): QuietTickMemory {
  return { checkedAt: now, allQuiet: true, ...overrides };
}

describe("canSkipDbTouch", () => {
  it("never skips on a cold start (no memory yet)", () => {
    expect(canSkipDbTouch([ChargerOperationMode.Disconnected], now, null)).toBe(false);
  });

  it("never skips if the last full tick found something pending", () => {
    const memory = quietMemory({ allQuiet: false });
    expect(canSkipDbTouch([ChargerOperationMode.Disconnected], now, memory)).toBe(false);
  });

  it("never skips if any charger is not disconnected right now", () => {
    const memory = quietMemory();
    expect(
      canSkipDbTouch([ChargerOperationMode.Disconnected, ChargerOperationMode.Charging], now, memory),
    ).toBe(false);
  });

  it("never skips a charger with a null (unknown) mode", () => {
    const memory = quietMemory();
    expect(canSkipDbTouch([null], now, memory)).toBe(false);
  });

  it("skips when every charger is disconnected and the last full tick was quiet and recent", () => {
    const memory = quietMemory({ checkedAt: new Date(now.getTime() - 60_000) });
    expect(canSkipDbTouch([ChargerOperationMode.Disconnected], now, memory)).toBe(true);
  });

  it("stops skipping once the full-tick interval has elapsed, forcing a fresh check", () => {
    const memory = quietMemory({ checkedAt: new Date(now.getTime() - FULL_TICK_INTERVAL_MS) });
    expect(canSkipDbTouch([ChargerOperationMode.Disconnected], now, memory)).toBe(false);
  });

  it("treats no chargers at all as trivially quiet (vacuous true)", () => {
    const memory = quietMemory();
    expect(canSkipDbTouch([], now, memory)).toBe(true);
  });
});
