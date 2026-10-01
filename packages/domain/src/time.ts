function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((part) => part.type === type)?.value ?? "0";
  const numeric = Number(value);
  return type === "hour" && numeric === 24 ? 0 : numeric;
}

/** Milliseconds to add to a UTC instant to get the wall-clock reading in `timeZone`. */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const asUtc = Date.UTC(
    partValue(parts, "year"),
    partValue(parts, "month") - 1,
    partValue(parts, "day"),
    partValue(parts, "hour"),
    partValue(parts, "minute"),
    partValue(parts, "second"),
  );
  return asUtc - instant.getTime();
}

/** Calendar day in `timeZone`, formatted YYYY-MM-DD. */
export function localDay(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(year, month - 1, date));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/** UTC instant when `day` starts in `timeZone`. Handles daylight-saving transitions. */
export function startOfZonedDay(day: string, timeZone: string): Date {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  let utc = Date.UTC(year, month - 1, date, 0, 0, 0);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = Date.UTC(year, month - 1, date, 0, 0, 0) - timeZoneOffsetMs(new Date(utc), timeZone);
    if (next === utc) break;
    utc = next;
  }
  return new Date(utc);
}

export function zonedDayBounds(day: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: startOfZonedDay(day, timeZone),
    end: startOfZonedDay(addDays(day, 1), timeZone),
  };
}

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export type DayPeriod = "morning" | "afternoon" | "evening";

export function dayPeriod(instant: Date, timeZone: string): DayPeriod {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(instant);
  const hour = partValue(parts, "hour");
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
