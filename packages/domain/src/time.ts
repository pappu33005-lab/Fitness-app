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

/** Parses `HH:MM` or `H:MM` into minutes-from-midnight. Rejects invalid clock values. */
export function parseHourMinute(value: string): { hour: number; minute: number; minutesFromMidnight: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute, minutesFromMidnight: hour * 60 + minute };
}

export type OvernightSleepBounds =
  | { ok: true; day: string; startIso: string; endIso: string; asleepMinutes: number }
  | { ok: false; reason: string };

/**
 * Builds an overnight (or same-day nap) sleep interval from a wake-day and two clock times.
 * For normal overnight sleep (bed 23:00, wake 07:00 on the morning of `wakeDay`), bedtime is
 * placed on the previous calendar day. Same-day naps (bed after wake on the clock is false,
 * i.e. bed < wake) stay on `wakeDay`.
 */
export function overnightSleepBounds(input: {
  wakeDay: string;
  bedTime: string;
  wakeTime: string;
  timeZone: string;
}): OvernightSleepBounds {
  const bed = parseHourMinute(input.bedTime);
  const wake = parseHourMinute(input.wakeTime);
  if (!bed || !wake) return { ok: false, reason: "Use times like 23:00 and 07:00." };
  if (bed.minutesFromMidnight === wake.minutesFromMidnight) {
    return { ok: false, reason: "Bedtime and wake time need to be different." };
  }
  const bedDay = bed.minutesFromMidnight >= wake.minutesFromMidnight ? addDays(input.wakeDay, -1) : input.wakeDay;
  const startMs = startOfZonedDay(bedDay, input.timeZone).getTime() + bed.minutesFromMidnight * 60_000;
  const endMs = startOfZonedDay(input.wakeDay, input.timeZone).getTime() + wake.minutesFromMidnight * 60_000;
  if (!(endMs > startMs)) return { ok: false, reason: "Wake time needs to be after bedtime." };
  const asleepMinutes = Math.round((endMs - startMs) / 60_000);
  if (asleepMinutes < 1 || asleepMinutes > 24 * 60) {
    return { ok: false, reason: "That sleep note is outside a realistic overnight range." };
  }
  return {
    ok: true,
    day: input.wakeDay,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    asleepMinutes,
  };
}
