// This is a single-household Norwegian app: wall-clock times entered/shown in
// the UI are always Europe/Oslo local time, while the database stores UTC.
// Server Components run in whatever timezone the host process uses (UTC on
// Vercel), so every display/parse must pass this explicitly rather than rely
// on the runtime default.
export const HOUSEHOLD_TIME_ZONE = "Europe/Oslo";

// datetime-local inputs/values are naive "wall clock" strings with no
// timezone attached. Converting one to a real UTC instant requires knowing
// the zone's UTC offset *on that date* (Oslo swings between UTC+1 and UTC+2
// across DST), which Date can't do directly — so we render our UTC guess
// back through the target timezone and correct by however far it drifted.
export function zonedDateTimeToUtc(dateTimeLocal: string, timeZone: string): Date {
  const [datePart, timePart] = dateTimeLocal.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = (timePart ?? "00:00").split(":").map(Number);

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(utcGuess)).map((part) => [part.type, part.value]),
  );
  const zonedReadingOfGuess = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = zonedReadingOfGuess - utcGuess;
  return new Date(utcGuess - offsetMs);
}

// A date's calendar day as seen in `timeZone`, e.g. "2026-10-05" — used to
// bucket timestamps by local day regardless of the server's own timezone.
export function zonedDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// A "YYYY-MM-DDTHH:mm" string for a datetime-local input's defaultValue,
// representing tomorrow at the given time, in `timeZone`.
export function tomorrowAtLocalValue(timeZone: string, hour: number, minute: number): string {
  const todayKey = zonedDateKey(new Date(), timeZone);
  const [year, month, day] = todayKey.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  const yyyy = tomorrow.getUTCFullYear();
  const mm = String(tomorrow.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(tomorrow.getUTCDate()).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const mi = String(minute).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
