export type StepReading =
  | { status: "value"; steps: number; sourceLabel: string; source: "healthkit" | "health_connect" | "core_motion" | "android_step_counter" }
  | { status: "empty"; sourceLabel: string; detail: string }
  | { status: "unavailable"; detail: string };

export type StageMinutes = { awake: number; rem: number; light: number; deep: number };

export type SleepReading =
  | {
      status: "value";
      sourceLabel: string;
      asleepMinutes: number;
      /** Null when the store did not report in-bed — never invented from asleep. */
      inBedMinutes: number | null;
      stages: StageMinutes | null;
    }
  | { status: "empty"; sourceLabel: string; detail: string }
  | { status: "unavailable"; detail: string };

export type HealthConnection = "unknown" | "ready" | "denied" | "unavailable";

/**
 * Today's resting heart rate plus a trailing baseline average, both read from the
 * platform health store. `baselineBpm` is null when there is not enough history to
 * average — it is never invented from a single day.
 */
export type HeartRateReading =
  | { status: "value"; restingBpm: number; baselineBpm: number | null; sourceLabel: string }
  | { status: "empty"; sourceLabel: string; detail: string }
  | { status: "unavailable"; detail: string };

/**
 * Today's heart-rate variability plus a trailing baseline average. iOS reads SDNN
 * (HealthKit's HRV metric); Android reads RMSSD (Health Connect's HRV metric). These
 * are different measurements on different scales, so a value is only ever compared
 * against its own platform's baseline, never across platforms.
 */
export type HrvReading =
  | { status: "value"; valueMs: number; baselineMs: number | null; sourceLabel: string }
  | { status: "empty"; sourceLabel: string; detail: string }
  | { status: "unavailable"; detail: string };

/** Today's walking+running distance. There is no phone-sensor fallback for this the way steps has one — no Core Motion / step-counter API gives distance directly. */
export type DistanceReading =
  | { status: "value"; meters: number; sourceLabel: string }
  | { status: "empty"; sourceLabel: string; detail: string }
  | { status: "unavailable"; detail: string };

/** Today's active-energy (calories actively burned, not basal/resting). Same no-fallback caveat as DistanceReading. */
export type ActiveEnergyReading =
  | { status: "value"; kcal: number; sourceLabel: string }
  | { status: "empty"; sourceLabel: string; detail: string }
  | { status: "unavailable"; detail: string };

/**
 * A workout/exercise session recorded directly in Apple Health or Health Connect — for
 * example one an Apple Watch recorded on its own, without VitaCore's record screen ever
 * being open. Read-only: nothing here writes back to VitaCore's own workout_sessions or
 * activity_sessions tables. `kind` is the platform's own activity-type label, not
 * translated to VitaCore's own workout/activity vocabulary.
 */
export type ExternalWorkoutSample = { sourceRecordId: string | null; kind: string; startedAt: string; endedAt: string };

export type WorkoutsReading =
  | { status: "value"; workouts: ExternalWorkoutSample[]; sourceLabel: string }
  | { status: "empty"; sourceLabel: string; detail: string }
  | { status: "unavailable"; detail: string };
