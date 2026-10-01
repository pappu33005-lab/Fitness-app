/**
 * Browser and any non-native bundle. Metro uses native.ios.ts and native.android.ts
 * on those platforms instead. This file reports unavailable. It does not estimate steps or sleep.
 */
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

export async function connectPlatformHealth(): Promise<HealthConnection> {
  return "unavailable";
}

export async function readSteps(): Promise<StepReading> {
  return {
    status: "unavailable",
    detail: "Step counting uses Apple Health, Health Connect, or the phone's motion sensors. A browser cannot provide that measurement.",
  };
}

export async function readSleep(): Promise<SleepReading> {
  return {
    status: "unavailable",
    detail: "Sleep stages are read from Apple Health or Health Connect. This browser does not have those stores.",
  };
}

export async function readRestingHeartRate(): Promise<HeartRateReading> {
  return {
    status: "unavailable",
    detail: "Resting heart rate is read from Apple Health or Health Connect. This browser does not have those stores.",
  };
}

export async function readHeartRateVariability(): Promise<HrvReading> {
  return {
    status: "unavailable",
    detail: "Heart-rate variability is read from Apple Health or Health Connect. This browser does not have those stores.",
  };
}

export async function readDistance(): Promise<DistanceReading> {
  return {
    status: "unavailable",
    detail: "Distance is read from Apple Health or Health Connect. This browser does not have those stores.",
  };
}

export async function readActiveEnergy(): Promise<ActiveEnergyReading> {
  return {
    status: "unavailable",
    detail: "Active energy is read from Apple Health or Health Connect. This browser does not have those stores.",
  };
}

export async function readRecentWorkouts(): Promise<WorkoutsReading> {
  return {
    status: "unavailable",
    detail: "Workouts are read from Apple Health or Health Connect. This browser does not have those stores.",
  };
}
