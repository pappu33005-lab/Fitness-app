/** Android development and release builds. Health Connect first, then the phone pedometer as its own labeled source. */
import { Pedometer } from "expo-sensors";
import { addDays, deviceTimeZone, localDay, zonedDayBounds } from "@vitacore/domain";
import { initialize, readRecords, requestPermission, SleepStageType } from "react-native-health-connect";
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

const PERMISSIONS = [
  { accessType: "read" as const, recordType: "Steps" as const },
  { accessType: "read" as const, recordType: "Distance" as const },
  { accessType: "read" as const, recordType: "ActiveCaloriesBurned" as const },
  { accessType: "read" as const, recordType: "SleepSession" as const },
  { accessType: "read" as const, recordType: "HeartRate" as const },
  { accessType: "read" as const, recordType: "RestingHeartRate" as const },
  { accessType: "read" as const, recordType: "HeartRateVariabilityRmssd" as const },
  { accessType: "read" as const, recordType: "ExerciseSession" as const },
];

function todayIsoRange(): { startTime: string; endTime: string } {
  const zone = deviceTimeZone();
  const bounds = zonedDayBounds(localDay(new Date(), zone), zone);
  return { startTime: bounds.start.toISOString(), endTime: bounds.end.toISOString() };
}

const BASELINE_WINDOW_DAYS = 28;

/** The 28 days before today. Excludes today so a baseline never includes the value it is compared against. */
function baselineIsoRange(): { startTime: string; endTime: string } {
  const zone = deviceTimeZone();
  const today = localDay(new Date(), zone);
  const end = zonedDayBounds(today, zone).start;
  const start = zonedDayBounds(addDays(today, -BASELINE_WINDOW_DAYS), zone).start;
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

export async function connectPlatformHealth(): Promise<HealthConnection> {
  try {
    const ready = await initialize();
    if (!ready) return "unavailable";
    const granted = await requestPermission(PERMISSIONS);
    return granted.length > 0 ? "ready" : "denied";
  } catch {
    return "unavailable";
  }
}

export async function readSteps(): Promise<StepReading> {
  const range = todayIsoRange();
  try {
    const ready = await initialize();
    if (ready) {
      const page = await readRecords("Steps", {
        timeRangeFilter: { operator: "between", startTime: range.startTime, endTime: range.endTime },
      });
      const steps = page.records.reduce((sum, record) => sum + record.count, 0);
      if (page.records.length === 0) {
        return { status: "empty", sourceLabel: "Health Connect", detail: "Health Connect has no step records for today." };
      }
      return { status: "value", steps, source: "health_connect", sourceLabel: "Steps · Health Connect" };
    }
  } catch {
    // Health Connect is absent. The phone counter below is a different source.
  }

  try {
    const available = await Pedometer.isAvailableAsync();
    if (!available) {
      return { status: "unavailable", detail: "Health Connect is unavailable and this phone has no step sensor." };
    }
    const permission = await Pedometer.requestPermissionsAsync();
    if (!permission.granted) {
      return { status: "unavailable", detail: "Activity recognition is off, so steps from this phone are unavailable." };
    }
    const start = new Date(range.startTime);
    const end = new Date(range.endTime);
    const result = await Pedometer.getStepCountAsync(start, end);
    return {
      status: "value",
      steps: result.steps,
      source: "android_step_counter",
      sourceLabel: "Steps · This phone",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Steps could not be read.";
    return { status: "unavailable", detail: message };
  }
}

/**
 * Health Connect's STAGE_TYPE_AWAKE_IN_BED is 7. react-native-health-connect@4.1.3's
 * SleepStageType constant omits it, so the numeric value is kept here.
 */
const STAGE_AWAKE_IN_BED = 7;

export async function readSleep(): Promise<SleepReading> {
  const end = new Date();
  const start = new Date(end.getTime() - 36 * 60 * 60 * 1000);
  try {
    const ready = await initialize();
    if (!ready) {
      return { status: "unavailable", detail: "Health Connect is not available on this Android device." };
    }
    const page = await readRecords("SleepSession", {
      timeRangeFilter: { operator: "between", startTime: start.toISOString(), endTime: end.toISOString() },
    });
    if (page.records.length === 0) {
      return { status: "empty", sourceLabel: "Health Connect", detail: "Health Connect has no sleep session for the last night." };
    }
    const stages = { awake: 0, rem: 0, light: 0, deep: 0 };
    let asleep = 0;
    let inBed = 0;
    let sawStage = false;
    for (const record of page.records) {
      const sessionMinutes = Math.max(0, (new Date(record.endTime).getTime() - new Date(record.startTime).getTime()) / 60000);
      inBed += sessionMinutes;
      for (const stage of record.stages ?? []) {
        const minutes = Math.max(0, (new Date(stage.endTime).getTime() - new Date(stage.startTime).getTime()) / 60000);
        sawStage = true;
        if (stage.stage === SleepStageType.AWAKE || stage.stage === STAGE_AWAKE_IN_BED || stage.stage === SleepStageType.OUT_OF_BED) {
          stages.awake += minutes;
        }
        if (stage.stage === SleepStageType.LIGHT || stage.stage === SleepStageType.SLEEPING) {
          stages.light += minutes;
          asleep += minutes;
        }
        if (stage.stage === SleepStageType.DEEP) {
          stages.deep += minutes;
          asleep += minutes;
        }
        if (stage.stage === SleepStageType.REM) {
          stages.rem += minutes;
          asleep += minutes;
        }
      }
      if (!record.stages?.length) asleep += sessionMinutes;
    }
    return {
      status: "value",
      sourceLabel: "Sleep · Health Connect",
      asleepMinutes: Math.round(asleep),
      inBedMinutes: Math.round(inBed),
      stages: sawStage
        ? {
            awake: Math.round(stages.awake),
            rem: Math.round(stages.rem),
            light: Math.round(stages.light),
            deep: Math.round(stages.deep),
          }
        : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sleep could not be read from Health Connect.";
    return { status: "unavailable", detail: message };
  }
}

export async function readRestingHeartRate(): Promise<HeartRateReading> {
  try {
    const ready = await initialize();
    if (!ready) return { status: "unavailable", detail: "Health Connect is not available on this Android device." };
    const range = todayIsoRange();
    const page = await readRecords("RestingHeartRate", {
      timeRangeFilter: { operator: "between", startTime: range.startTime, endTime: range.endTime },
    });
    const todayRecords = page.records;
    if (todayRecords.length === 0) {
      return { status: "empty", sourceLabel: "Health Connect", detail: "Health Connect has no resting heart rate for today." };
    }
    const todayAvg = todayRecords.reduce((sum, record) => sum + record.beatsPerMinute, 0) / todayRecords.length;

    const baseline = baselineIsoRange();
    const baselinePage = await readRecords("RestingHeartRate", {
      timeRangeFilter: { operator: "between", startTime: baseline.startTime, endTime: baseline.endTime },
    });
    const baselineRecords = baselinePage.records;
    const baselineAvg = baselineRecords.length
      ? baselineRecords.reduce((sum, record) => sum + record.beatsPerMinute, 0) / baselineRecords.length
      : null;

    return {
      status: "value",
      restingBpm: Math.round(todayAvg),
      baselineBpm: baselineAvg == null ? null : Math.round(baselineAvg),
      sourceLabel: "Resting heart rate · Health Connect",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Resting heart rate could not be read from Health Connect.";
    return { status: "unavailable", detail: message };
  }
}

export async function readHeartRateVariability(): Promise<HrvReading> {
  try {
    const ready = await initialize();
    if (!ready) return { status: "unavailable", detail: "Health Connect is not available on this Android device." };
    const range = todayIsoRange();
    const page = await readRecords("HeartRateVariabilityRmssd", {
      timeRangeFilter: { operator: "between", startTime: range.startTime, endTime: range.endTime },
    });
    const todayRecords = page.records;
    if (todayRecords.length === 0) {
      return { status: "empty", sourceLabel: "Health Connect", detail: "Health Connect has no heart-rate variability for today." };
    }
    const todayAvg = todayRecords.reduce((sum, record) => sum + record.heartRateVariabilityMillis, 0) / todayRecords.length;

    const baseline = baselineIsoRange();
    const baselinePage = await readRecords("HeartRateVariabilityRmssd", {
      timeRangeFilter: { operator: "between", startTime: baseline.startTime, endTime: baseline.endTime },
    });
    const baselineRecords = baselinePage.records;
    const baselineAvg = baselineRecords.length
      ? baselineRecords.reduce((sum, record) => sum + record.heartRateVariabilityMillis, 0) / baselineRecords.length
      : null;

    return {
      status: "value",
      valueMs: Math.round(todayAvg),
      baselineMs: baselineAvg == null ? null : Math.round(baselineAvg),
      sourceLabel: "Heart-rate variability (RMSSD) · Health Connect",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Heart-rate variability could not be read from Health Connect.";
    return { status: "unavailable", detail: message };
  }
}

export async function readDistance(): Promise<DistanceReading> {
  try {
    const ready = await initialize();
    if (!ready) return { status: "unavailable", detail: "Health Connect is not available on this Android device." };
    const range = todayIsoRange();
    const page = await readRecords("Distance", {
      timeRangeFilter: { operator: "between", startTime: range.startTime, endTime: range.endTime },
    });
    const records = page.records;
    if (records.length === 0) return { status: "empty", sourceLabel: "Health Connect", detail: "Health Connect has no distance records for today." };
    const meters = records.reduce((sum, record) => sum + record.distance.inMeters, 0);
    return { status: "value", meters: Math.round(meters), sourceLabel: "Distance · Health Connect" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Distance could not be read from Health Connect.";
    return { status: "unavailable", detail: message };
  }
}

export async function readActiveEnergy(): Promise<ActiveEnergyReading> {
  try {
    const ready = await initialize();
    if (!ready) return { status: "unavailable", detail: "Health Connect is not available on this Android device." };
    const range = todayIsoRange();
    const page = await readRecords("ActiveCaloriesBurned", {
      timeRangeFilter: { operator: "between", startTime: range.startTime, endTime: range.endTime },
    });
    const records = page.records;
    if (records.length === 0) return { status: "empty", sourceLabel: "Health Connect", detail: "Health Connect has no active-energy records for today." };
    const kcal = records.reduce((sum, record) => sum + record.energy.inKilocalories, 0);
    return { status: "value", kcal: Math.round(kcal), sourceLabel: "Active energy · Health Connect" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Active energy could not be read from Health Connect.";
    return { status: "unavailable", detail: message };
  }
}

export async function readRecentWorkouts(): Promise<WorkoutsReading> {
  try {
    const ready = await initialize();
    if (!ready) return { status: "unavailable", detail: "Health Connect is not available on this Android device." };
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const page = await readRecords("ExerciseSession", {
      timeRangeFilter: { operator: "between", startTime: start.toISOString(), endTime: end.toISOString() },
    });
    const records = page.records;
    if (records.length === 0) {
      return { status: "empty", sourceLabel: "Health Connect", detail: "Health Connect has no exercise sessions from the last 7 days." };
    }
    return {
      status: "value",
      sourceLabel: "Workouts · Health Connect",
      workouts: records.map((record) => ({
        sourceRecordId: record.metadata?.id ?? null,
        kind: String(record.exerciseType ?? "exercise"),
        startedAt: record.startTime,
        endedAt: record.endTime,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workouts could not be read from Health Connect.";
    return { status: "unavailable", detail: message };
  }
}
