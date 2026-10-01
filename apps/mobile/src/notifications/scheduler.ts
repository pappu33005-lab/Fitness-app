/**
 * Local reminder scheduling.
 *
 * STATUS: written against expo-notifications' documented API (SDK 54+ style, since this
 * project pins expo-notifications separately from the `expo` package below) from memory —
 * NOT run. The exact installed version has not been checked (see docs/notifications.md and
 * package.json). Re-verify the calls below (`scheduleNotificationAsync`,
 * `getAllScheduledNotificationsAsync`, `SchedulableTriggerInputTypes`,
 * `setNotificationChannelAsync`) against the installed version's real types once network
 * access is available.
 *
 * Every scheduling decision (what to send, when, whether it duplicates something already
 * scheduled) is pure logic in @vitacore/domain/reminders.ts, tested there. This file only
 * turns that plan into real OS calls and reads/writes the plain preference row it needs.
 */
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  defaultReminderSettings,
  desiredSchedule,
  diffSchedule,
  hydrationGoalMet,
  incompleteGoals,
  isAllowedNotificationRoute,
  NOTIFICATION_ID_PREFIX,
  parseReminderSettings,
  reminderPermissionState,
  serializeReminderSettings,
  shouldRequestPermission,
  type GoalProgress,
  type NotificationPermission,
  type PlannedNotification,
  type ReminderPermissionState,
  type ReminderSettings,
} from "@vitacore/domain";
import { readPreference, writePreference } from "@/data/db";

const SETTINGS_KEY = "reminder_settings";
const SIGNATURES_KEY = "reminder_notification_signatures";

const supported = Platform.OS === "ios" || Platform.OS === "android";

export const WORKOUT_CHANNEL_ID = "vitacore-workout";
export const HYDRATION_CHANNEL_ID = "vitacore-hydration";
export const GOAL_CHANNEL_ID = "vitacore-goals";

let handlerSet = false;

/**
 * Foreground display behavior and Android channels. Separate from the Phase 3 foreground
 * *location* service notification, which is a different OS mechanism (a persistent,
 * ongoing service notification) and is untouched by this file.
 */
export async function configureNotifications(): Promise<void> {
  if (!supported) return;
  if (!handlerSet) {
    handlerSet = true;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  }
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(WORKOUT_CHANNEL_ID, {
      name: "Workout reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    await Notifications.setNotificationChannelAsync(HYDRATION_CHANNEL_ID, {
      name: "Hydration reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    await Notifications.setNotificationChannelAsync(GOAL_CHANNEL_ID, {
      name: "Daily goal reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

function channelFor(kind: PlannedNotification["kind"]): string {
  if (kind === "workout") return WORKOUT_CHANNEL_ID;
  if (kind === "hydration") return HYDRATION_CHANNEL_ID;
  return GOAL_CHANNEL_ID;
}

export async function loadReminderSettings(): Promise<ReminderSettings> {
  const raw = await readPreference(SETTINGS_KEY);
  return parseReminderSettings(raw);
}

export async function saveReminderSettings(settings: ReminderSettings): Promise<void> {
  await writePreference(SETTINGS_KEY, serializeReminderSettings(settings));
}

async function loadSignatures(): Promise<Record<string, string>> {
  const raw = await readPreference(SIGNATURES_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function saveSignatures(signatures: Record<string, string>): Promise<void> {
  await writePreference(SIGNATURES_KEY, JSON.stringify(signatures));
}

export async function getPermissionState(): Promise<ReminderPermissionState> {
  if (!supported) return reminderPermissionState(null, false);
  const result = await Notifications.getPermissionsAsync();
  const permission: NotificationPermission = {
    status: result.granted ? "granted" : result.canAskAgain === false ? "denied" : result.status === "undetermined" ? "undetermined" : "denied",
    canAskAgain: result.canAskAgain !== false,
  };
  return reminderPermissionState(permission, true);
}

/** Only ever called in direct response to someone turning a reminder on — never on app launch, never repeatedly. */
export async function requestPermission(): Promise<ReminderPermissionState> {
  if (!supported) return "unsupported";
  const current = await getPermissionState();
  if (!shouldRequestPermission(current)) return current;
  const result = await Notifications.requestPermissionsAsync();
  const permission: NotificationPermission = {
    status: result.granted ? "granted" : result.canAskAgain === false ? "denied" : "undetermined",
    canAskAgain: result.canAskAgain !== false,
  };
  return reminderPermissionState(permission, true);
}

function toTrigger(planned: PlannedNotification): Notifications.NotificationTriggerInput {
  if (planned.trigger.type === "weekly") {
    return {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: planned.trigger.weekday + 1, // expo-notifications uses 1 = Sunday
      hour: planned.trigger.hour,
      minute: planned.trigger.minute,
    };
  }
  return { type: Notifications.SchedulableTriggerInputTypes.DATE, date: planned.trigger.at };
}

/**
 * Applies `settings` against real notification/goal state: reads current permission and
 * today's goal progress, computes the plan, diffs it against what the OS actually has
 * scheduled (never trusting our own signature cache alone), cancels only this app's stale
 * identifiers, and schedules the rest. Safe to call repeatedly — an unchanged plan makes no
 * calls at all.
 */
export async function syncReminders(goals: GoalProgress, now: Date = new Date()): Promise<{ scheduled: number; cancelled: number }> {
  if (!supported) return { scheduled: 0, cancelled: 0 };
  const settings = await loadReminderSettings();
  const permission = await getPermissionState();
  const plan = desiredSchedule(settings, { now, goals }, permission);

  const existing = await Notifications.getAllScheduledNotificationsAsync();
  const existingIds = existing.map((item) => item.identifier);
  const storedSignatures = await loadSignatures();
  const diff = diffSchedule(plan.notifications, existingIds, storedSignatures);

  for (const id of diff.cancel) {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
  }
  const plannedById = new Map(plan.notifications.map((item) => [item.id, item]));
  for (const item of diff.schedule) {
    const planned = plannedById.get(item.id);
    if (!planned) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: planned.id,
      content: {
        title: planned.title,
        body: planned.body,
        data: { route: planned.route },
        ...(Platform.OS === "android" ? { channelId: channelFor(planned.kind) } : null),
      },
      trigger: toTrigger(planned),
    }).catch(() => undefined);
  }
  await saveSignatures(diff.signatures);
  return { scheduled: diff.schedule.length, cancelled: diff.cancel.length };
}

/** Cancels every reminder this app has scheduled. Never touches a notification id it did not create. */
export async function cancelAllReminders(): Promise<void> {
  if (!supported) return;
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  for (const item of existing) {
    if (item.identifier.startsWith(NOTIFICATION_ID_PREFIX)) {
      await Notifications.cancelScheduledNotificationAsync(item.identifier).catch(() => undefined);
    }
  }
  await saveSignatures({});
}

/** Route to open for a tapped notification, from its stored `data.route`. Anything not on the allow-list is refused. */
export function routeForNotificationResponse(response: Notifications.NotificationResponse): string | null {
  const route = response.notification.request.content.data?.route;
  return isAllowedNotificationRoute(route) ? route : null;
}

export { defaultReminderSettings };
export type { GoalProgress, ReminderPermissionState, ReminderSettings };
