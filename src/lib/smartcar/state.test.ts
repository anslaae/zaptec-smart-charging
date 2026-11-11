import { describe, expect, it } from "vitest";
import { newerReading, parseStateOfCharge } from "./state";
import type { SmartcarSignalApiResponse } from "./types";

function response(
  overrides: Partial<SmartcarSignalApiResponse["data"]["attributes"]> = {},
  meta: SmartcarSignalApiResponse["data"]["meta"] = { oemUpdatedAt: "2026-10-14T07:52:27.000Z" },
): SmartcarSignalApiResponse {
  return {
    data: {
      attributes: {
        status: { value: "SUCCESS" },
        body: { value: 80, unit: "percent" },
        ...overrides,
      },
      meta,
    },
  };
}

describe("parseStateOfCharge", () => {
  it("parses a successful signal response", () => {
    const result = parseStateOfCharge(response());
    expect(result).toEqual({
      percent: 80,
      oemUpdatedAt: new Date("2026-10-14T07:52:27.000Z"),
    });
  });

  it("returns null when the signal status is ERROR", () => {
    const result = parseStateOfCharge(
      response({ status: { value: "ERROR" }, body: undefined }),
    );
    expect(result).toBeNull();
  });

  it("returns null when the body is missing", () => {
    const result = parseStateOfCharge(response({ body: undefined }));
    expect(result).toBeNull();
  });

  it("returns null when the unit isn't percent", () => {
    const result = parseStateOfCharge(response({ body: { value: 80, unit: "volts" } }));
    expect(result).toBeNull();
  });

  it("returns null when oemUpdatedAt is missing or unparsable", () => {
    expect(parseStateOfCharge(response({}, {}))).toBeNull();
    expect(parseStateOfCharge(response({}, { oemUpdatedAt: "not-a-date" }))).toBeNull();
  });
});

describe("newerReading", () => {
  const a = { percent: 51, oemUpdatedAt: new Date("2026-11-11T09:27:00Z") };
  const b = { percent: 49, oemUpdatedAt: new Date("2026-11-11T12:00:00Z") };
  it("keeps the % when the live API call failed", () => {
    expect(newerReading(null, a)).toBe(a);
    expect(newerReading(a, null)).toBe(a);
    expect(newerReading(null, null)).toBeNull();
  });
  it("takes the newer reading, the first on a tie", () => {
    expect(newerReading(a, b)).toBe(b);
    expect(newerReading(b, a)).toBe(b);
    expect(newerReading(a, { ...a, percent: 50 })).toBe(a);
  });
});
