/** Where a measurement came from. Phone sensors are never added to a health-platform total. */
export type MeasurementSource =
  | "healthkit"
  | "apple_watch"
  | "health_connect"
  | "core_motion"
  | "android_step_counter"
  | "phone_gps"
  | "manual"
  | "fitbit"
  | "garmin";

/**
 * Metrics this file merges as a same-day sum from possibly several sources. Heart rate,
 * HRV, and sleep are deliberately not here — they are not "sum the day's readings"
 * metrics, and already have their own today-plus-baseline shape in apps/mobile/src/health
 * (HeartRateReading, HrvReading, SleepReading), which this does not replace.
 */
export type HealthMetricKind = "steps" | "distance_meters" | "active_energy_kcal";

export type DailySample = {
  metric: HealthMetricKind;
  source: MeasurementSource;
  sourceRecordId: string | null;
  day: string;
  value: number;
};

const SOURCE_PRIORITY: MeasurementSource[] = [
  "apple_watch",
  "healthkit",
  "health_connect",
  "garmin",
  "fitbit",
  "core_motion",
  "android_step_counter",
  "phone_gps",
  "manual",
];

export type DailyTotal = {
  day: string;
  metric: HealthMetricKind;
  value: number;
  source: MeasurementSource;
  ignoredSources: MeasurementSource[];
};

/**
 * One source wins each day, per metric. Duplicate source-record ids inside that source are
 * counted once. Other sources are reported as ignored so the UI can say they were not added.
 * A sample with no source-record id is never deduplicated against another (there is nothing
 * to compare), so a platform that does not hand back stable ids just counts every sample —
 * safest default, since silently dropping an un-identified sample could lose a real reading.
 */
export function dedupeDailyHealthSamples(samples: DailySample[]): DailyTotal[] {
  const byGroup = new Map<string, DailySample[]>();
  for (const sample of samples) {
    const key = `${sample.day}:${sample.metric}`;
    const list = byGroup.get(key);
    if (list) list.push(sample);
    else byGroup.set(key, [sample]);
  }

  const totals: DailyTotal[] = [];
  for (const list of byGroup.values()) {
    const { day, metric } = list[0]!;
    const present = new Set(list.map((sample) => sample.source));
    const winner = SOURCE_PRIORITY.find((source) => present.has(source));
    if (!winner) continue;
    const seen = new Set<string>();
    let value = 0;
    for (const sample of list) {
      if (sample.source !== winner) continue;
      if (sample.sourceRecordId) {
        if (seen.has(sample.sourceRecordId)) continue;
        seen.add(sample.sourceRecordId);
      }
      value += sample.value;
    }
    totals.push({ day, metric, value, source: winner, ignoredSources: [...present].filter((source) => source !== winner) });
  }
  return totals.sort((a, b) => a.day.localeCompare(b.day) || a.metric.localeCompare(b.metric));
}

/** Kept for the existing steps-only call sites and tests. Behaves identically to dedupeDailyHealthSamples — steps is one of the metrics it handles. */
export function dedupeDailySteps(samples: DailySample[]): DailyTotal[] {
  return dedupeDailyHealthSamples(samples);
}
