import { describe, expect, it } from "vitest";
import { isNorwegianHoliday, norwegianHolidays } from "./holidays";

describe("Norwegian public holidays", () => {
  it("knows Easter-based holidays for 2026 and 2027", () => {
    // Easter Sunday: 5 Apr 2026, 28 Mar 2027
    expect([...norwegianHolidays(2026)]).toEqual(
      expect.arrayContaining(["2026-04-02", "2026-04-03", "2026-04-05", "2026-04-06", "2026-05-14", "2026-05-24", "2026-05-25"]),
    );
    expect(isNorwegianHoliday("2027-03-26")).toBe(true); // Langfredag 2027
    expect(isNorwegianHoliday("2027-05-06")).toBe(true); // Kristi himmelfart 2027
  });

  it("has the fixed ones and nothing else", () => {
    expect(isNorwegianHoliday("2026-05-17")).toBe(true);
    expect(isNorwegianHoliday("2026-12-26")).toBe(true);
    expect(isNorwegianHoliday("2026-11-11")).toBe(false);
    expect(norwegianHolidays(2026).size).toBe(12);
  });
});
