/**
 * Normalized, platform-agnostic health-data layer.
 *
 * Layering this phase builds on top of apps/mobile/src/health (the platform adapter —
 * HealthKit on iOS, Health Connect on Android):
 *
 *   platform source (HealthKit / Health Connect / a wearable's own cloud)
 *     -> permission layer (apps/mobile/src/health's connect/request functions)
 *     -> platform adapter (apps/mobile/src/health/native.ios.ts, native.android.ts)
 *     -> normalized sample (this file: NormalizedHealthSample, validated by normalizeHealthSample)
 *     -> domain/application layer (this file's merge/dedupe helpers, plus the existing
 *        recovery/sleep scoring in recovery.ts and sleep.ts, and dedupeDailyHealthSamples
 *        in samples.ts for same-day multi-source totals)
 *     -> UI / analytics / coach (apps/mobile screens; packages/domain/src/coach.ts's
 *        context builder, which this phase does not change — see health.md)
 *
 * Nothing here talks to HealthKit, Health Connect, Supabase, or a wearable's API directly.
 * It only validates and reshapes data the platform adapter already fetched.
 */

import type { MeasurementSource } from "./samples";

export type HealthMetric =
  | "steps"
  | "distance_meters"
  | "active_energy_kcal"
  | "heart_rate_bpm"
  | "resting_heart_rate_bpm"
  | "hrv_ms"
  | "sleep_minutes"
  | "workout";

export type NormalizedHealthSample = {
  metric: HealthMetric;
  value: number;
  unit: string;
  startedAt: string;
  endedAt: string;
  source: MeasurementSource;
  sourceRecordId: string | null;
};

export type RawHealthSample = {
  metric: HealthMetric;
  value: unknown;
  unit: string;
  startedAt: string;
  endedAt: string;
  source: MeasurementSource;
  sourceRecordId: string | null;
};

/**
 * Validates one platform-reported sample. Rejects a non-finite or negative value, an
 * unparseable timestamp, and an end before its start — every one of these has shown up in
 * real HealthKit/Health Connect data from a misbehaving third-party source at some point,
 * and none of them should become a silently-wrong number in the app. Returns null rather
 * than throwing, so a single bad sample never stops the rest of a batch (see
 * normalizeHealthSamples).
 */
export function normalizeHealthSample(raw: RawHealthSample): NormalizedHealthSample | null {
  const value = typeof raw.value === "number" ? raw.value : Number(raw.value);
  if (!Number.isFinite(value) || value < 0) return null;
  const startedAt = new Date(raw.startedAt);
  const endedAt = new Date(raw.endedAt);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) return null;
  if (endedAt.getTime() < startedAt.getTime()) return null;
  if (!raw.unit) return null;
  return {
    metric: raw.metric,
    value,
    unit: raw.unit,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    source: raw.source,
    sourceRecordId: raw.sourceRecordId,
  };
}

export type NormalizeBatchResult = { samples: NormalizedHealthSample[]; rejectedCount: number };

/** Runs normalizeHealthSample over a batch. A batch with nothing usable returns an empty list, not an error. */
export function normalizeHealthSamples(raw: RawHealthSample[]): NormalizeBatchResult {
  const samples: NormalizedHealthSample[] = [];
  let rejectedCount = 0;
  for (const item of raw) {
    const normalized = normalizeHealthSample(item);
    if (normalized) samples.push(normalized);
    else rejectedCount += 1;
  }
  return { samples, rejectedCount };
}

/**
 * De-duplicates by platform record id first (the strongest signal a platform can give:
 * "this is the same record"), and only for samples that share one falls back to an
 * identical (metric, source, startedAt, endedAt, value) tuple — two different real
 * readings essentially never collide on all four by coincidence, so this fallback is safe
 * without a record id to lean on.
 */
export function dedupeHealthSamples(samples: NormalizedHealthSample[]): NormalizedHealthSample[] {
  const byRecordId = new Set<string>();
  const byComposite = new Set<string>();
  const result: NormalizedHealthSample[] = [];
  for (const sample of samples) {
    if (sample.sourceRecordId) {
      const key = `${sample.source}:${sample.sourceRecordId}`;
      if (byRecordId.has(key)) continue;
      byRecordId.add(key);
      result.push(sample);
      continue;
    }
    const composite = `${sample.metric}:${sample.source}:${sample.startedAt}:${sample.endedAt}:${sample.value}`;
    if (byComposite.has(composite)) continue;
    byComposite.add(composite);
    result.push(sample);
  }
  return result;
}

// --- External workouts vs. manually logged sessions -----------------------------------

export type ExternalWorkout = {
  sourceRecordId: string | null;
  source: MeasurementSource;
  kind: string;
  startedAt: string;
  endedAt: string;
};

export type LocalSessionWindow = { startedAt: string; endedAt: string | null };

/**
 * An external workout (read from HealthKit/Health Connect — e.g. one Apple Watch recorded
 * directly, without opening VitaCore) counts as "already represented" when its time range
 * meaningfully overlaps a workout or GPS activity already logged in VitaCore itself. This
 * is what keeps a manually-logged session from being duplicated by the same workout also
 * showing up from the platform store — nothing here overwrites or deletes the local
 * session; it only decides what is safe to additionally surface as new.
 */
export function isWorkoutAlreadyRepresented(workout: ExternalWorkout, localSessions: LocalSessionWindow[]): boolean {
  const workoutStart = new Date(workout.startedAt).getTime();
  const workoutEnd = new Date(workout.endedAt).getTime();
  return localSessions.some((session) => {
    const localStart = new Date(session.startedAt).getTime();
    const localEnd = session.endedAt ? new Date(session.endedAt).getTime() : localStart + 60 * 60 * 1000;
    return workoutStart < localEnd && localStart < workoutEnd;
  });
}

/** Only the external workouts genuinely not already covered by a local session — for a read-only "recent workouts from Health" list, never for silently merging into VitaCore's own tables. */
export function newExternalWorkouts(workouts: ExternalWorkout[], localSessions: LocalSessionWindow[]): ExternalWorkout[] {
  return workouts.filter((workout) => !isWorkoutAlreadyRepresented(workout, localSessions));
}

// --- Connection / permission status ----------------------------------------------------

export type HealthPlatform = "healthkit" | "health_connect" | "unsupported";

export type HealthConnectionSummary = {
  platform: HealthPlatform;
  /**
   * iOS deliberately never reveals whether a *read* permission was denied (Apple's
   * documented privacy design for HealthKit read access), so on iOS this can only ever be
   * "granted" (the request completed) or "unknown" — never a reliable "denied". Android's
   * Health Connect does report granted/denied per record type accurately. See health.md.
   */
  status: "granted" | "denied" | "unknown" | "unavailable";
  lastSuccessfulReadAt: string | null;
};

/** Plain-language line for the status screen — the one place this wording is decided, so the screen and any future surface agree. */
export function describeHealthConnection(summary: HealthConnectionSummary): string {
  if (summary.platform === "unsupported") return "Health data is not available on this device.";
  const store = summary.platform === "healthkit" ? "Apple Health" : "Health Connect";
  if (summary.status === "unavailable") return `${store} is not available on this device.`;
  if (summary.status === "denied") return `${store} access is off. Turn it on in system settings to use this data.`;
  if (summary.status === "unknown") {
    return `${store} permission was requested. Whether each item was granted is not reported back to the app — check ${summary.platform === "healthkit" ? "Settings > Privacy > Health" : "Health Connect"} to review it.`;
  }
  return summary.lastSuccessfulReadAt ? `Connected to ${store}. Last read ${summary.lastSuccessfulReadAt}.` : `Connected to ${store}. No data has been read yet.`;
}
