/**
 * Background GPS for activity recording.
 *
 * Points from the background task go into the same activity_sessions / activity_points
 * rows the foreground record screen writes, through the same data functions. Nothing here
 * invents a location: every point comes from an OS location callback.
 *
 * STATUS: written against expo-location / expo-task-manager's documented API but NOT run
 * on any device or emulator. Background delivery with the screen locked, on either
 * platform, is unverified until tested on a physical iPhone and Android phone.
 */
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { shouldPersistBackgroundLocation } from "@vitacore/domain";
import { appendActivityPoint, getActiveActivitySession } from "@/data/logs";

export const BACKGROUND_LOCATION_TASK = "vitacore-background-location";

const supported = Platform.OS === "ios" || Platform.OS === "android";

/**
 * True only while the record screen is mounted, the app is active, and its own watcher is
 * writing points. In a headless relaunch (process killed, JS started just to deliver a
 * location) this module-level flag starts false, which is correct: nobody else is writing.
 */
let foregroundWriterActive = false;

export function setForegroundWriterActive(active: boolean): void {
  foregroundWriterActive = active;
}

export function isForegroundWriterActive(): boolean {
  return foregroundWriterActive;
}

type LocationTaskBody = { data?: { locations?: Location.LocationObject[] } | undefined; error?: { message?: string } | null };

/**
 * Must run at module load in the global scope (see the import in app/_layout.tsx) so the
 * OS can hand a location update to JS even when no React tree exists.
 */
if (supported && !TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async (body: LocationTaskBody) => {
    if (body.error) {
      // Includes the OS reporting that location access is no longer available.
      console.warn("Background location task error:", body.error.message ?? "unknown");
      return;
    }
    try {
      const active = await getActiveActivitySession();
      if (!active) {
        // No workout is being recorded. Updates must not keep running, so shut them down
        // here as well; this heals a stop that could not reach the native side.
        await stopBackgroundLocationUpdates();
        return;
      }
      if (
        !shouldPersistBackgroundLocation({
          hasActiveSession: true,
          paused: active.paused,
          foregroundWriterActive,
        })
      ) {
        return;
      }
      for (const location of body.data?.locations ?? []) {
        await appendActivityPoint(active.id, {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          altitudeMeters: location.coords.altitude,
          recordedAtMs: location.timestamp,
        });
      }
    } catch (error) {
      console.warn("Background location point could not be saved:", error instanceof Error ? error.message : String(error));
    }
  });
}

export type BackgroundStartResult = { started: true } | { started: false; reason: string };

/**
 * Battery notes: High accuracy (not BestForNavigation) with a 10 m / 5 s minimum step, and
 * no automatic pausing so a route is never silently cut short. These numbers are a starting
 * point and have not been tuned or measured on a device. On Android a foreground-service
 * notification is required for updates to continue with the screen off; iOS shows the
 * system location indicator.
 */
export async function startBackgroundLocationUpdates(): Promise<BackgroundStartResult> {
  if (!supported) return { started: false, reason: "Background location is only available in the iOS and Android apps." };
  try {
    // Task already registered (previous session, app restart): restart it so options are fresh and it is never doubled.
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 5000,
      distanceInterval: 10,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Fitness,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "Recording your activity",
        notificationBody: "Your route is being recorded. Open the app and tap Stop and save to finish.",
      },
    });
    return { started: true };
  } catch (error) {
    return { started: false, reason: error instanceof Error ? error.message : "Background tracking could not start." };
  }
}

/** Safe to call when nothing is running. */
export async function stopBackgroundLocationUpdates(): Promise<void> {
  if (!supported) return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch (error) {
    console.warn("Background location could not be stopped:", error instanceof Error ? error.message : String(error));
  }
}

export async function isBackgroundLocationRunning(): Promise<boolean> {
  if (!supported) return false;
  try {
    return await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  } catch {
    return false;
  }
}
