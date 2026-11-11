// Norwegian public holidays (helligdager + 1. og 17. mai). Elvia charges the
// night rate all day on these, and Smart lading uses the weekend ready-by
// time (HANDOFF §6b). Pure: Easter by the anonymous Gregorian algorithm,
// the movable feasts from it.

function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

const cache = new Map<number, Set<string>>();

/** "YYYY-MM-DD" keys of the year's public holidays. */
export function norwegianHolidays(year: number): Set<string> {
  const cached = cache.get(year);
  if (cached) return cached;
  const key = (date: Date) => date.toISOString().slice(0, 10);
  const { month, day } = easterSunday(year);
  const easter = Date.UTC(year, month - 1, day);
  const offset = (days: number) => key(new Date(easter + days * 86_400_000));
  const set = new Set<string>([
    `${year}-01-01`, // Første nyttårsdag
    offset(-3), // Skjærtorsdag
    offset(-2), // Langfredag
    offset(0), // Første påskedag
    offset(1), // Andre påskedag
    `${year}-05-01`, // Arbeidernes dag
    `${year}-05-17`, // Grunnlovsdag
    offset(39), // Kristi himmelfartsdag
    offset(49), // Første pinsedag
    offset(50), // Andre pinsedag
    `${year}-12-25`, // Første juledag
    `${year}-12-26`, // Andre juledag
  ]);
  cache.set(year, set);
  return set;
}

/** Whether an Oslo calendar day ("YYYY-MM-DD") is a public holiday. */
export function isNorwegianHoliday(dateKey: string): boolean {
  return norwegianHolidays(Number(dateKey.slice(0, 4))).has(dateKey);
}
