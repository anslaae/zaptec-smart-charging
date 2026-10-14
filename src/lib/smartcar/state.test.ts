import { describe, expect, it } from "vitest";
import { parseStateOfCharge } from "./state";
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
