/** iOS development and release builds. HealthKit first, then the phone pedometer as its own labeled source. */
import {
  addDays,
  aggregatePlatformSleep,
  deviceTimeZone,
  localDay,
  platformSleepQueryBounds,
  zonedDayBounds,
  type PlatformSleepInterval,
} from "@vitacore/domain";
import type {
  ActiveEnergyReading,
  DistanceReading,
  HealthConnection,
  HeartRateReading,
  HrvReading,
  SleepReading,
  StepReading,
  WorkoutsReading,
} from "./types";
import {
  CategoryValueSleepAnalysis,
  isHealthDataAvailableAsync,
  queryCategorySamples,
  queryStatisticsForQuantity,
  queryWorkoutSamples,
  requestAuthorization,
} from "@kingstinct/react-native-healthkit";
import { Pedometer } from "expo-sensors";

const READ = {
  toRead: [
    "HKQuantityTypeIdentifierStepCount",
    "HKQuantityTypeIdentifierDistanceWalkingRunning",
    "HKQuantityTypeIdentifierActiveEnergyBurned",
    "HKCategoryTypeIdentifierSleepAnalysis",
    "HKQuantityTypeIdentifierHeartRate",
    "HKQuantityTypeIdentifierRestingHeartRate",
    "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
    "HKWorkoutTypeIdentifier",
  ],
} as const;

function todayBounds(): { start: Date; end: Date } {
  const zone = deviceTimeZone();
  return zonedDayBounds(localDay(new Date(), zone), zone);
}

const BASELINE_WINDOW_DAYS = 28;

/** The 28 days before today. Excludes today so a baseline never includes the value it is compared against. */
function baselineBounds(): { start: Date; end: Date } {
  const zone = deviceTimeZone();
  const today = localDay(new Date(), zone);
  const end = zonedDayBounds(today, zone).start;
  const start = zonedDayBounds(addDays(today, -BASELINE_WINDOW_DAYS), zone).start;
  return { start, end };
}

async function discreteAverage(
  identifier: "HKQuantityTypeIdentifierRestingHeartRate" | "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  unit: "count/min" | "ms",
  start: Date,
  end: Date,
): Promise<number | null> {
  const stats = await queryStatisticsForQuantity(identifier, ["discreteAverage"], {
    unit,
    filter: { date: { startDate: start, endDate: end } },
  });
  const quantity = stats.averageQuantity?.quantity;
  return quantity == null ? null : quantity;
}

export async function connectPlatformHealth(): Promise<HealthConnection> {
  try {
    const available = await isHealthDataAvailableAsync();
    if (!available) return "unavailable";
    const accepted = await requestAuthorization(READ);
    return accepted ? "ready" : "denied";
  } catch {
    return "unavailable";
  }
}

export async function readSteps(): Promise<StepReading> {
  const { start, end } = todayBounds();
  try {
    const available = await isHealthDataAvailableAsync();
    if (available) {
      const stats = await queryStatisticsForQuantity("HKQuantityTypeIdentifierStepCount", ["cumulativeSum"], {
        unit: "count",
        filter: { date: { startDate: start, endDate: end } },
      });
      const quantity = stats.sumQuantity?.quantity;
      if (quantity == null) {
        return { status: "empty", sourceLabel: "Apple Health", detail: "Apple Health has no step total for today." };
      }
      return { status: "value", steps: Math.round(quantity), source: "healthkit", sourceLabel: "Steps · Apple Health" };
    }
  } catch {
    // Fall through to Core Motion only when HealthKit itself cannot be called.
  }

  try {
    const motion = await Pedometer.isAvailableAsync();
    if (!motion) {
      return { status: "unavailable", detail: "This iPhone did not report a step sensor, and Apple Health could not be read." };
    }
    const permission = await Pedometer.requestPermissionsAsync();
    if (!permission.granted) {
      return { status: "unavailable", detail: "Motion access is off, so steps from this iPhone are unavailable." };
    }
    const result = await Pedometer.getStepCountAsync(start, end);
    return { status: "value", steps: result.steps, source: "core_motion", sourceLabel: "Steps · This iPhone" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Steps could not be read.";
    return { status: "unavailable", detail: message };
  }
}

export async function readSleep(): Promise<SleepReading> {
  try {
    const available = await isHealthDataAvailableAsync();
    if (!available) {
      return { status: "unavailable", detail: "Apple Health is not available on this device." };
    }
    const zone = deviceTimeZone();
    const { start, end } = platformSleepQueryBounds(new Date(), zone);
    const samples = await queryCategorySamples("HKCategoryTypeIdentifierSleepAnalysis", {
      limit: 200,
      filter: { date: { startDate: start, endDate: end } },
    });
    if (samples.length === 0) {
      return { status: "empty", sourceLabel: "Apple Health", detail: "Apple Health has no sleep samples for last night." };
    }
    const intervals: PlatformSleepInterval[] = [];
    for (const sample of samples) {
      const startMs = sample.startDate.getTime();
      const endMs = sample.endDate.getTime();
      if (sample.value === CategoryValueSleepAnalysis.inBed) intervals.push({ startMs, endMs, kind: "in_bed" });
      if (sample.value === CategoryValueSleepAnalysis.awake) intervals.push({ startMs, endMs, kind: "awake" });
      if (sample.value === CategoryValueSleepAnalysis.asleepCore) intervals.push({ startMs, endMs, kind: "light" });
      if (sample.value === CategoryValueSleepAnalysis.asleepDeep) intervals.push({ startMs, endMs, kind: "deep" });
      if (sample.value === CategoryValueSleepAnalysis.asleepREM) intervals.push({ startMs, endMs, kind: "rem" });
      if (sample.value === CategoryValueSleepAnalysis.asleepUnspecified) intervals.push({ startMs, endMs, kind: "asleep" });
    }
    const aggregated = aggregatePlatformSleep({ intervals, now: new Date(), timeZone: zone });
    if (aggregated.status === "empty") {
      return { status: "empty", sourceLabel: "Apple Health", detail: aggregated.reason };
    }
    return {
      status: "value",
      sourceLabel: "Sleep · Apple Health",
      asleepMinutes: aggregated.asleepMinutes,
      inBedMinutes: aggregated.inBedMinutes,
      stages: aggregated.stages,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sleep could not be read from Apple Health.";
    return { status: "unavailable", detail: message };
  }
}

export async function readRestingHeartRate(): Promise<HeartRateReading> {
  try {
    const available = await isHealthDataAvailableAsync();
    if (!available) return { status: "unavailable", detail: "Apple Health is not available on this device." };
    const today = todayBounds();
    const todayValue = await discreteAverage(
      "HKQuantityTypeIdentifierRestingHeartRate",
      "count/min",
      today.start,
      today.end,
    );
    if (todayValue == null) {
      return { status: "empty", sourceLabel: "Apple Health", detail: "Apple Health has no resting heart rate for today." };
    }
    const baseline = baselineBounds();
    const baselineValue = await discreteAverage(
      "HKQuantityTypeIdentifierRestingHeartRate",
      "count/min",
      baseline.start,
      baseline.end,
    );
    return {
      status: "value",
      restingBpm: Math.round(todayValue),
      baselineBpm: baselineValue == null ? null : Math.round(baselineValue),
      sourceLabel: "Resting heart rate · Apple Health",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Resting heart rate could not be read from Apple Health.";
    return { status: "unavailable", detail: message };
  }
}

export async function readHeartRateVariability(): Promise<HrvReading> {
  try {
    const available = await isHealthDataAvailableAsync();
    if (!available) return { status: "unavailable", detail: "Apple Health is not available on this device." };
    const today = todayBounds();
    const todayValue = await discreteAverage(
      "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
      "ms",
      today.start,
      today.end,
    );
    if (todayValue == null) {
      return { status: "empty", sourceLabel: "Apple Health", detail: "Apple Health has no heart-rate variability for today." };
    }
    const baseline = baselineBounds();
    const baselineValue = await discreteAverage(
      "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
      "ms",
      baseline.start,
      baseline.end,
    );
    return {
      status: "value",
      valueMs: Math.round(todayValue),
      baselineMs: baselineValue == null ? null : Math.round(baselineValue),
      sourceLabel: "Heart-rate variability (SDNN) · Apple Health",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Heart-rate variability could not be read from Apple Health.";
    return { status: "unavailable", detail: message };
  }
}

export async function readDistance(): Promise<DistanceReading> {
  try {
    const available = await isHealthDataAvailableAsync();
    if (!available) return { status: "unavailable", detail: "Apple Health is not available on this device." };
    const { start, end } = todayBounds();
    const stats = await queryStatisticsForQuantity("HKQuantityTypeIdentifierDistanceWalkingRunning", ["cumulativeSum"], {
      unit: "m",
      filter: { date: { startDate: start, endDate: end } },
    });
    const quantity = stats.sumQuantity?.quantity;
    if (quantity == null) return { status: "empty", sourceLabel: "Apple Health", detail: "Apple Health has no walking+running distance for today." };
    return { status: "value", meters: Math.round(quantity), sourceLabel: "Distance · Apple Health" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Distance could not be read from Apple Health.";
    return { status: "unavailable", detail: message };
  }
}

export async function readActiveEnergy(): Promise<ActiveEnergyReading> {
  try {
    const available = await isHealthDataAvailableAsync();
    if (!available) return { status: "unavailable", detail: "Apple Health is not available on this device." };
    const { start, end } = todayBounds();
    const stats = await queryStatisticsForQuantity("HKQuantityTypeIdentifierActiveEnergyBurned", ["cumulativeSum"], {
      unit: "kcal",
      filter: { date: { startDate: start, endDate: end } },
    });
    const quantity = stats.sumQuantity?.quantity;
    if (quantity == null) return { status: "empty", sourceLabel: "Apple Health", detail: "Apple Health has no active-energy total for today." };
    return { status: "value", kcal: Math.round(quantity), sourceLabel: "Active energy · Apple Health" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Active energy could not be read from Apple Health.";
    return { status: "unavailable", detail: message };
  }
}

export async function readRecentWorkouts(): Promise<WorkoutsReading> {
  try {
    const available = await isHealthDataAvailableAsync();
    if (!available) return { status: "unavailable", detail: "Apple Health is not available on this device." };
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const samples = await queryWorkoutSamples({
      limit: 20,
      filter: { date: { startDate: start, endDate: end } },
    });
    if (samples.length === 0) {
      return { status: "empty", sourceLabel: "Apple Health", detail: "Apple Health has no workouts from the last 7 days." };
    }
    return {
      status: "value",
      sourceLabel: "Workouts · Apple Health",
      workouts: samples.map((sample) => ({
        sourceRecordId: sample.uuid ?? null,
        kind: String(sample.workoutActivityType ?? "workout"),
        startedAt: sample.startDate.toISOString(),
        endedAt: sample.endDate.toISOString(),
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workouts could not be read from Apple Health.";
    return { status: "unavailable", detail: message };
  }
}
