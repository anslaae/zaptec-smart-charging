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

// Shared display format for any timestamp shown to the household -- always
// Europe/Oslo wall-clock time in Norwegian, 24h, e.g. "10. nov. 2026, 07:30".
// The locale is fixed (never `undefined`) so the server and the browser render
// the exact same text -- a runtime-default locale differed between them and
// caused hydration mismatches.
export function formatOsloDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: HOUSEHOLD_TIME_ZONE,
    hourCycle: "h23",
  }).format(new Date(date));
}

const LOCALE = "nb-NO";

/** "07:30" -- 24h wall-clock time in Oslo. */
export function formatTime(date: string | Date): string {
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: HOUSEHOLD_TIME_ZONE,
  }).format(new Date(date));
}

/** "tir. 10. nov." -- short weekday + day + month in Oslo. */
export function formatShortDate(date: string | Date): string {
  return new Intl.DateTimeFormat(LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: HOUSEHOLD_TIME_ZONE,
  }).format(new Date(date));
}

/** Whole calendar days from `now` to `date`, counted on Oslo dates (DST-safe). */
function osloDayOffset(date: Date, now: Date): number {
  const [y1, m1, d1] = zonedDateKey(now, HOUSEHOLD_TIME_ZONE).split("-").map(Number);
  const [y2, m2, d2] = zonedDateKey(date, HOUSEHOLD_TIME_ZONE).split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** "i dag" / "i morgen" / "i går", or null for any other day. */
export function relativeDay(date: string | Date, now: Date = new Date()): string | null {
  switch (osloDayOffset(new Date(date), now)) {
    case 0:
      return "i dag";
    case 1:
      return "i morgen";
    case -1:
      return "i går";
    default:
      return null;
  }
}

/** Hours before 06:00 that are still ahead and less than 12 h away read as "i natt". */
const NIGHT_ENDS_HOUR = 6;

/** "i natt" / "i morgen" when it applies, otherwise "tir. 10. nov.". */
export function formatDayLabel(date: string | Date, now: Date = new Date()): string {
  const d = new Date(date);
  const ahead = d.getTime() - now.getTime();
  if (ahead > 0 && ahead < 12 * 3_600_000 && osloHour(d) < NIGHT_ENDS_HOUR) return "i natt";
  return relativeDay(d, now) ?? formatShortDate(d);
}

/** "i morgen 07:30" / "tir. 10. nov. 07:30". */
export function formatDayAndTime(date: string | Date, now: Date = new Date()): string {
  return `${formatDayLabel(date, now)} ${formatTime(date)}`;
}

/** Hour of day (0-23) on the Oslo wall clock. */
export function osloHour(date: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: HOUSEHOLD_TIME_ZONE }).format(date),
  );
}

/** "7,1" -- a plain number with a fixed number of decimals, for templates that add their own unit. */
export function formatNumber(value: number, fractionDigits: number): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** "7,1 kW" */
export function formatKw(kw: number): string {
  return `${formatNumber(kw, 1)} kW`;
}

/** "15,6 kWh" */
export function formatKwh(kwh: number): string {
  return `${formatNumber(kwh, 1)} kWh`;
}

/** "123,40 kr" */
export function formatKr(nok: number): string {
  return `${formatNumber(nok, 2)} kr`;
}

/** "45 min" / "1 t 5 min" -- a duration in seconds, for session timers. */
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.max(0, Math.round(totalSeconds / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} t` : `${hours} t ${rest} min`;
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
