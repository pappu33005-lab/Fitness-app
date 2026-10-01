import { addDays, localDay } from "./time";

export const historyRanges = [
  { id: "7", days: 7, bucketDays: 1, label: "7 days" },
  { id: "30", days: 30, bucketDays: 1, label: "30 days" },
  { id: "90", days: 90, bucketDays: 7, label: "3 months" },
  { id: "180", days: 180, bucketDays: 7, label: "6 months" },
  { id: "365", days: 365, bucketDays: 7, label: "1 year" },
] as const;

export type HistoryRangeId = (typeof historyRanges)[number]["id"];

export type HistoryPoint = {
  day: string;
  value: number | null;
};

export type DatedValue = {
  day: string;
  value: number;
};

/** Days with no saved record stay null. A missing day is not stored as zero. */
export function fillDailyRange(today: string, days: number, recorded: DatedValue[]): HistoryPoint[] {
  const totals = new Map<string, number>();
  for (const row of recorded) {
    totals.set(row.day, (totals.get(row.day) ?? 0) + row.value);
  }
  return Array.from({ length: days }, (_, index) => {
    const day = addDays(today, index - (days - 1));
    return { day, value: totals.has(day) ? (totals.get(day) ?? 0) : null };
  });
}

/** Sums only days that have a record. A bucket with no records stays null. */
export function bucketHistory(points: HistoryPoint[], bucketDays: number): HistoryPoint[] {
  if (bucketDays <= 1) return points;
  const buckets: HistoryPoint[] = [];
  for (let index = 0; index < points.length; index += bucketDays) {
    const slice = points.slice(index, index + bucketDays);
    const present = slice.filter((point) => point.value != null);
    buckets.push({
      day: slice[0]?.day ?? "",
      value: present.length === 0 ? null : present.reduce((sum, point) => sum + (point.value ?? 0), 0),
    });
  }
  return buckets;
}

export function seriesForRange(today: string, recorded: DatedValue[], days: number, bucketDays: number): HistoryPoint[] {
  return bucketHistory(fillDailyRange(today, days, recorded), bucketDays);
}

export function recordedSummary(points: HistoryPoint[]): { total: number; daysWithData: number } {
  let total = 0;
  let daysWithData = 0;
  for (const point of points) {
    if (point.value == null) continue;
    total += point.value;
    daysWithData += 1;
  }
  return { total, daysWithData };
}

export type SleepSpan = { asleepStart: string; asleepEnd: string };
export type TimedValue = { at: string; value: number };
export type LiftSet = { exerciseName: string; weightKg: number | null; reps: number | null };

/** When more than one note exists for a night, keep the longer one. */
export function sleepMinutesByDay(spans: SleepSpan[], timeZone: string): DatedValue[] {
  const longest = new Map<string, number>();
  for (const span of spans) {
    const start = new Date(span.asleepStart).getTime();
    const end = new Date(span.asleepEnd).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const minutes = (end - start) / 60000;
    const day = localDay(new Date(end), timeZone);
    const current = longest.get(day);
    if (current == null || minutes > current) longest.set(day, minutes);
  }
  return [...longest.entries()].map(([day, value]) => ({ day, value }));
}

export function valuesByLocalDay(rows: TimedValue[], timeZone: string): DatedValue[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const instant = new Date(row.at);
    if (!Number.isFinite(instant.getTime())) continue;
    const day = localDay(instant, timeZone);
    totals.set(day, (totals.get(day) ?? 0) + row.value);
  }
  return [...totals.entries()].map(([day, value]) => ({ day, value }));
}

export function bestLifts(sets: LiftSet[]): { exerciseName: string; weightKg: number; reps: number | null }[] {
  const best = new Map<string, { weightKg: number; reps: number | null }>();
  for (const set of sets) {
    if (set.weightKg == null || !Number.isFinite(set.weightKg) || set.weightKg <= 0) continue;
    const current = best.get(set.exerciseName);
    if (!current || set.weightKg > current.weightKg) {
      best.set(set.exerciseName, { weightKg: set.weightKg, reps: set.reps });
    }
  }
  return [...best.entries()]
    .map(([exerciseName, value]) => ({ exerciseName, ...value }))
    .sort((left, right) => right.weightKg - left.weightKg || left.exerciseName.localeCompare(right.exerciseName));
}
