import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeHmac, verifySignature, parseVehicleStateSignals } from "./webhook";
import type { SmartcarWebhookSignal } from "./types";

const TOKEN = "test-management-token";

describe("computeHmac / verifySignature", () => {
  it("computes an HMAC-SHA256 hex digest", () => {
    const expected = createHmac("sha256", TOKEN).update("hello").digest("hex");
    expect(computeHmac("hello", TOKEN)).toBe(expected);
  });

  it("accepts a correctly signed payload", () => {
    const body = JSON.stringify({ eventType: "VEHICLE_STATE" });
    const signature = computeHmac(body, TOKEN);
    expect(verifySignature(body, signature, TOKEN)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const signature = computeHmac(JSON.stringify({ a: 1 }), TOKEN);
    expect(verifySignature(JSON.stringify({ a: 2 }), signature, TOKEN)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifySignature("body", null, TOKEN)).toBe(false);
  });

  it("rejects a signature of the wrong length", () => {
    expect(verifySignature("body", "not-a-real-signature", TOKEN)).toBe(false);
  });
});

function signal(overrides: Partial<SmartcarWebhookSignal> = {}): SmartcarWebhookSignal {
  return {
    code: "tractionbattery-stateofcharge",
    body: { value: 80 },
    status: { value: "SUCCESS" },
    meta: { oemUpdatedAt: "2026-10-14T07:52:27.000Z" },
    ...overrides,
  };
}

describe("parseVehicleStateSignals", () => {
  it("returns all nulls for an empty/undefined signals array", () => {
    expect(parseVehicleStateSignals(undefined)).toEqual({
      batteryPercent: null,
      batteryReportedAt: null,
      odometerKm: null,
      odometerReportedAt: null,
    });
    expect(parseVehicleStateSignals([]).batteryPercent).toBeNull();
  });

  it("parses the battery signal", () => {
    const result = parseVehicleStateSignals([signal()]);
    expect(result.batteryPercent).toBe(80);
    expect(result.batteryReportedAt).toEqual(new Date("2026-10-14T07:52:27.000Z"));
    expect(result.odometerKm).toBeNull();
  });

  it("parses the odometer signal, including an epoch-ms oemUpdatedAt", () => {
    const result = parseVehicleStateSignals([
      signal({
        code: "odometer-traveleddistance",
        body: { value: 36215.8 },
        meta: { oemUpdatedAt: 1754365413366 },
      }),
    ]);
    expect(result.odometerKm).toBe(36215.8);
    expect(result.odometerReportedAt).toEqual(new Date(1754365413366));
  });

  it("parses both signals when both are present in one delivery", () => {
    const result = parseVehicleStateSignals([
      signal(),
      signal({ code: "odometer-traveleddistance", body: { value: 100 } }),
    ]);
    expect(result.batteryPercent).toBe(80);
    expect(result.odometerKm).toBe(100);
  });

  it("ignores a signal with a non-SUCCESS status", () => {
    const result = parseVehicleStateSignals([signal({ status: { value: "ERROR" } })]);
    expect(result.batteryPercent).toBeNull();
  });

  it("ignores a signal with a missing oemUpdatedAt or non-numeric value", () => {
    expect(parseVehicleStateSignals([signal({ meta: {} })]).batteryPercent).toBeNull();
    expect(
      parseVehicleStateSignals([signal({ body: { value: "not-a-number" } })]).batteryPercent,
    ).toBeNull();
  });
});
