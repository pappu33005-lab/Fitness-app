export type GeoPoint = {
  latitude: number;
  longitude: number;
  /** Meters above the ellipsoid, when the device reported it. */
  altitudeMeters: number | null;
  /** Unix milliseconds. */
  recordedAtMs: number;
};

const EARTH_RADIUS_M = 6371000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineMeters(from: GeoPoint, to: GeoPoint): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function trackDistanceMeters(points: GeoPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous && current) total += haversineMeters(previous, current);
  }
  return total;
}

/** Positive climbs only. Null when the device never reported altitude. */
export function elevationGainMeters(points: GeoPoint[]): number | null {
  const withAltitude = points.filter((point) => point.altitudeMeters != null);
  if (withAltitude.length < 2) return null;
  let gain = 0;
  for (let index = 1; index < withAltitude.length; index += 1) {
    const previous = withAltitude[index - 1]?.altitudeMeters;
    const current = withAltitude[index]?.altitudeMeters;
    if (previous == null || current == null) continue;
    const delta = current - previous;
    if (delta > 0.5) gain += delta;
  }
  return gain;
}

export type Split = {
  index: number;
  distanceMeters: number;
  durationSeconds: number;
  paceSecondsPerKilometer: number | null;
};

/**
 * Builds distance splits using moving time only (same pause-gap rule as `movingSeconds`).
 * Long gaps between consecutive points are excluded from split duration/pace so a pause
 * cannot inflate split pace. Distance still comes from the recorded points; no fake GPS
 * points are invented across a pause.
 */
export function buildSplits(points: GeoPoint[], splitMeters: number, maxGapMs = 90_000): Split[] {
  if (points.length < 2 || splitMeters <= 0) return [];
  const splits: Split[] = [];
  let distanceIntoSplit = 0;
  let movingMsIntoSplit = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) continue;
    const segmentLength = haversineMeters(previous, current);
    const rawGap = current.recordedAtMs - previous.recordedAtMs;
    const segmentMovingMs = rawGap > 0 && rawGap <= maxGapMs ? rawGap : 0;
    if (segmentLength <= 0.01) {
      // Negligible movement: still attribute continuous moving time to the open split.
      movingMsIntoSplit += segmentMovingMs;
      continue;
    }

    let segmentLeft = segmentLength;
    let timeLeft = segmentMovingMs;

    while (segmentLeft > 0.01) {
      const need = splitMeters - distanceIntoSplit;
      if (segmentLeft + 0.01 < need) {
        distanceIntoSplit += segmentLeft;
        movingMsIntoSplit += timeLeft;
        break;
      }
      const fraction = need / segmentLeft;
      const timeUsed = timeLeft * fraction;
      movingMsIntoSplit += timeUsed;
      const durationSeconds = movingMsIntoSplit / 1000;
      splits.push({
        index: splits.length + 1,
        distanceMeters: splitMeters,
        durationSeconds,
        paceSecondsPerKilometer:
          durationSeconds > 0 ? durationSeconds / (splitMeters / 1000) : null,
      });
      segmentLeft -= need;
      timeLeft -= timeUsed;
      distanceIntoSplit = 0;
      movingMsIntoSplit = 0;
    }
  }

  return splits;
}

export function durationSeconds(points: GeoPoint[]): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return 0;
  return Math.max(0, (last.recordedAtMs - first.recordedAtMs) / 1000);
}

/**
 * Moving time excludes long gaps between consecutive points (pauses, GPS dropouts).
 * Wall-clock elapsed time remains `durationSeconds`. Pace and MET estimates should use
 * moving time when points were not written while paused.
 */
export function movingSeconds(points: GeoPoint[], maxGapMs = 90_000): number {
  if (points.length < 2) return 0;
  let totalMs = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) continue;
    const gap = current.recordedAtMs - previous.recordedAtMs;
    if (gap > 0 && gap <= maxGapMs) totalMs += gap;
  }
  return totalMs / 1000;
}

export function paceSecondsPerKilometer(distanceMeters: number, seconds: number): number | null {
  if (distanceMeters < 1 || seconds <= 0) return null;
  return seconds / (distanceMeters / 1000);
}

/**
 * A labeled estimate from the Compendium of Physical Activities, not a measured burn.
 * MET values used: walk 3.5, hike 6, run 9.8, cycle 8.
 */
export function estimatedActivityKcal(input: {
  kind: "walk" | "run" | "cycle" | "hike";
  durationSeconds: number;
  weightKg: number | null;
}): { kcal: number; disclaimer: string } | null {
  if (input.weightKg == null || input.weightKg <= 0 || input.durationSeconds <= 0) return null;
  const met = { walk: 3.5, hike: 6, run: 9.8, cycle: 8 }[input.kind];
  const hours = input.durationSeconds / 3600;
  const kcal = Math.round(met * input.weightKg * hours);
  return {
    kcal,
    disclaimer: "Estimated from a standard MET value and your weight. It is not a measured calorie burn.",
  };
}

/**
 * Used by both the foreground watcher and the headless background task so they apply the
 * exact same gating rule: never record a point once the session has ended, and never
 * record one while the user has paused the workout — even if the background task itself
 * has no React state to check and is only reading this from durable storage.
 */
export function shouldAcceptLocationUpdate(state: { hasActiveSession: boolean; paused: boolean }): boolean {
  return state.hasActiveSession && !state.paused;
}

/**
 * Reconciles the in-memory route (built live while the screen was in the foreground) with
 * whatever the background task wrote straight to SQLite while the screen was not visible.
 * Points are deduped by their recorded timestamp — the same GPS fix should never appear
 * twice just because both the foreground watcher and the background task happened to
 * observe it around a foreground/background transition — and the result is sorted so a
 * batch that arrives out of order never scrambles the route.
 */
export function mergeGeoPoints(existing: GeoPoint[], incoming: GeoPoint[]): GeoPoint[] {
  const byTimestamp = new Map<number, GeoPoint>();
  for (const point of existing) byTimestamp.set(point.recordedAtMs, point);
  for (const point of incoming) byTimestamp.set(point.recordedAtMs, point);
  return Array.from(byTimestamp.values()).sort((a, b) => a.recordedAtMs - b.recordedAtMs);
}

/**
 * Rule for the headless background task. While the record screen is visible and its own
 * foreground watcher is writing points, the background task must stay quiet — otherwise
 * the same movement would be stored twice from two location sources with different
 * timestamps. It records only when a session is open, not paused, and no foreground
 * writer is currently attached (screen locked, app backgrounded, screen left, or the JS
 * runtime was relaunched headlessly after the process was killed).
 */
export function shouldPersistBackgroundLocation(state: {
  hasActiveSession: boolean;
  paused: boolean;
  foregroundWriterActive: boolean;
}): boolean {
  return shouldAcceptLocationUpdate(state) && !state.foregroundWriterActive;
}

/**
 * Foreground-only recording cannot continue after the Record screen unmounts (or when
 * Always/background location is not active). Auto-pause instead of silently dropping
 * points. Background-capable sessions must not auto-pause — the native task continues.
 */
export function shouldAutoPauseForegroundRecording(state: {
  hasActiveSession: boolean;
  alreadyPaused: boolean;
  backgroundTrackingActive: boolean;
  stopping: boolean;
}): boolean {
  return (
    state.hasActiveSession &&
    !state.alreadyPaused &&
    !state.backgroundTrackingActive &&
    !state.stopping
  );
}
