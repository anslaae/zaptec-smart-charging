import { describe, expect, it } from "vitest";
import { nb } from "./nb";
import { formatPercent } from "@/lib/datetime";

function strings(value: unknown, path = "nb"): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, v]) => strings(v, `${path}.${key}`));
  }
  return [];
}

// Copy rules (owner with Claude design, 2026-11-13; DECISIONS D79). e2e can't
// check these: Playwright folds U+202F into a plain space.
describe("nb copy rules (D79)", () => {
  const all = strings(nb);

  it("a percent is always number + U+202F + %", () => {
    const bad = all.filter(([, s]) => /[\d}](?: |)%/.test(s));
    expect(bad).toEqual([]);
    expect(formatPercent(80)).toBe("80 %");
  });

  it("the system never speaks as Appen or vi", () => {
    const bad = all.filter(([, s]) => /\b(Appen|Vi|vi)\b/.test(s));
    expect(bad).toEqual([]);
  });

  it("Zaptec is named only for its own things", () => {
    const allowed = /Zaptec-appen|Zaptec Portal|Zaptec-kontoen|Zaptec Go|Importert fra Zaptec|^Zaptec$/;
    const bad = all.filter(([, s]) => s.includes("Zaptec") && !allowed.test(s));
    expect(bad).toEqual([]);
  });
});
