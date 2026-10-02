import { addDays, localDay, startOfZonedDay, zonedDayBounds } from "./time";
import type { SleepStageMinutes } from "./sleep";

/**
 * One interval from a platform health store. Categories may overlap (e.g. HealthKit
 * asleepUnspecified covering the same span as Core/Deep/REM stages).
 */
export type PlatformSleepInterval = {
  startMs: number;
  endMs: number;
  /**
   * - in_bed: time in bed (not asleep)
   * - awake: awake within a sleep session
   * - asleep: unspecified asleep (no stage breakdown)
   * - light / deep / rem: staged asleep
   */
  kind: "in_bed" | "awake" | "asleep" | "light" | "deep" | "rem";
};

export type AggregatedPlatformSleep =
  | {
      status: "value";
      wakeDay: string;
      asleepMinutes: number;
      /** Null when the store did not report in-bed time — never invented from asleep. */
      inBedMinutes: number | null;
      stages: SleepStageMinutes | null;
    }
  | { status: "empty"; wakeDay: string; reason: string };

const STAGE_KINDS = new Set(["light", "deep", "rem", "awake"]);

/** Merges overlapping [start,end) intervals into a non-overlapping union; returns total minutes. */
export function unionMinutes(intervals: Array<{ startMs: number; endMs: number }>): number {
  const sorted = intervals
    .map((item) => ({ startMs: item.startMs, endMs: Math.max(item.startMs, item.endMs) }))
    .filter((item) => item.endMs > item.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (sorted.length === 0) return 0;
  let totalMs = 0;
  let curStart = sorted[0]!.startMs;
  let curEnd = sorted[0]!.endMs;
  for (let index = 1; index < sorted.length; index += 1) {
    const next = sorted[index]!;
    if (next.startMs <= curEnd) {
      curEnd = Math.max(curEnd, next.endMs);
    } else {
      totalMs += curEnd - curStart;
      curStart = next.startMs;
      curEnd = next.endMs;
    }
  }
  totalMs += curEnd - curStart;
  return totalMs / 60_000;
}

/**
 * Subtracts `mask` intervals from `base` (set difference), then returns remaining minutes.
 * Used so unspecified "asleep" does not double-count spans already covered by stages.
 */
export function subtractUnionMinutes(
  base: Array<{ startMs: number; endMs: number }>,
  mask: Array<{ startMs: number; endMs: number }>,
): number {
  const sortedMask = mask
    .map((item) => ({ startMs: item.startMs, endMs: Math.max(item.startMs, item.endMs) }))
    .filter((item) => item.endMs > item.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  let remaining: Array<{ startMs: number; endMs: number }> = base
    .map((item) => ({ startMs: item.startMs, endMs: Math.max(item.startMs, item.endMs) }))
    .filter((item) => item.endMs > item.startMs);

  for (const cut of sortedMask) {
    const next: Array<{ startMs: number; endMs: number }> = [];
    for (const segment of remaining) {
      if (cut.endMs <= segment.startMs || cut.startMs >= segment.endMs) {
        next.push(segment);
        continue;
      }
      if (segment.startMs < cut.startMs) next.push({ startMs: segment.startMs, endMs: cut.startMs });
      if (segment.endMs > cut.endMs) next.push({ startMs: cut.endMs, endMs: segment.endMs });
    }
    remaining = next;
  }
  return unionMinutes(remaining);
}

/**
 * Aggregates platform sleep for the local wake day containing `now`.
 *
 * Rules:
 * - Wake day = local calendar day of `now` in `timeZone`.
 * - Consider intervals that end within [wakeDayStart - 12h, wakeDayEnd).
 * - Keep the longest contiguous overnight bout ending on the wake day (naps shorter
 *   than that bout are dropped from the main total).
 * - Prefer staged asleep over overlapping unspecified asleep.
 * - Never invent in-bed from asleep; omit in-bed when absent.
 * - Sessions with only a session envelope and no asleep/stage intervals do not invent asleep.
 */
export function aggregatePlatformSleep(input: {
  intervals: PlatformSleepInterval[];
  now: Date;
  timeZone: string;
}): AggregatedPlatformSleep {
  const wakeDay = localDay(input.now, input.timeZone);
  const { start: wakeStart, end: wakeEnd } = zonedDayBounds(wakeDay, input.timeZone);
  const windowStart = wakeStart.getTime() - 12 * 60 * 60 * 1000;
  const windowEnd = wakeEnd.getTime();

  const inWindow = input.intervals.filter(
    (item) => item.endMs > windowStart && item.startMs < windowEnd && item.endMs > item.startMs,
  );
  if (inWindow.length === 0) {
    return { status: "empty", wakeDay, reason: "No sleep samples for last night." };
  }

  // Candidates: intervals that end on the wake day (overnight ending this morning, or same-day nap).
  const endingOnWakeDay = inWindow.filter((item) => item.endMs >= wakeStart.getTime() && item.endMs < wakeEnd.getTime());
  const pool = endingOnWakeDay.length > 0 ? endingOnWakeDay : inWindow;

  // Cluster into bouts by merging gaps under 90 minutes (typical bathroom wake).
  const sorted = [...pool].sort((a, b) => a.startMs - b.startMs);
  const bouts: Array<{ startMs: number; endMs: number; items: PlatformSleepInterval[] }> = [];
  for (const item of sorted) {
    const last = bouts[bouts.length - 1];
    if (!last || item.startMs - last.endMs > 90 * 60_000) {
      bouts.push({ startMs: item.startMs, endMs: item.endMs, items: [item] });
    } else {
      last.endMs = Math.max(last.endMs, item.endMs);
      last.startMs = Math.min(last.startMs, item.startMs);
      last.items.push(item);
    }
  }

  // Prefer the longest bout that ends on the wake day; else the longest overall in window.
  const endingBouts = bouts.filter((bout) => bout.endMs >= wakeStart.getTime() && bout.endMs < wakeEnd.getTime());
  const candidates = endingBouts.length > 0 ? endingBouts : bouts;
  if (candidates.length === 0) {
    return { status: "empty", wakeDay, reason: "No sleep samples for last night." };
  }
  candidates.sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs));
  const primary = candidates[0]!;

  const stageIntervals = primary.items.filter((item) => STAGE_KINDS.has(item.kind));
  const unspecifiedAsleep = primary.items.filter((item) => item.kind === "asleep");
  const inBedIntervals = primary.items.filter((item) => item.kind === "in_bed");

  const light = unionMinutes(stageIntervals.filter((item) => item.kind === "light"));
  const deep = unionMinutes(stageIntervals.filter((item) => item.kind === "deep"));
  const rem = unionMinutes(stageIntervals.filter((item) => item.kind === "rem"));
  const awake = unionMinutes(stageIntervals.filter((item) => item.kind === "awake"));
  const stagedAsleep = light + deep + rem;

  // Unspecified asleep only counts where stages do not already cover the span.
  const unspecifiedOnly = subtractUnionMinutes(
    unspecifiedAsleep,
    stageIntervals.filter((item) => item.kind === "light" || item.kind === "deep" || item.kind === "rem"),
  );

  const asleepMinutes = Math.round(stagedAsleep + unspecifiedOnly);
  if (asleepMinutes < 1) {
    return {
      status: "empty",
      wakeDay,
      reason: "Sleep session time was present but asleep minutes could not be determined.",
    };
  }

  const inBedRaw = unionMinutes(inBedIntervals);
  const inBedMinutes = inBedRaw >= 1 ? Math.round(inBedRaw) : null;
  const sawStages = light + deep + rem + awake > 0;

  return {
    status: "value",
    wakeDay,
    asleepMinutes,
    inBedMinutes,
    stages: sawStages
      ? {
          awake: Math.round(awake),
          rem: Math.round(rem),
          light: Math.round(light),
          deep: Math.round(deep),
        }
      : null,
  };
}

/** Query window for platform APIs: previous local evening through end of wake day. */
export function platformSleepQueryBounds(now: Date, timeZone: string): { start: Date; end: Date; wakeDay: string } {
  const wakeDay = localDay(now, timeZone);
  const { start: wakeStart, end: wakeEnd } = zonedDayBounds(wakeDay, timeZone);
  const previousEvening = new Date(startOfZonedDay(addDays(wakeDay, -1), timeZone).getTime() + 18 * 60 * 60 * 1000);
  const start = previousEvening.getTime() < wakeStart.getTime() - 12 * 60 * 60 * 1000
    ? previousEvening
    : new Date(wakeStart.getTime() - 12 * 60 * 60 * 1000);
  return { start, end: wakeEnd, wakeDay };
}
