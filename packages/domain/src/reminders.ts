/**
 * Pure planning logic for local reminders. No notification library, no storage, no clock of
 * its own: the caller passes `now`. The mobile app (apps/mobile/src/notifications) turns the
 * plan into OS schedules; keeping the decisions here is what makes them testable.
 *
 * Time handling: schedules are minutes-of-day in the device's local time, and dates are built
 * with local calendar fields, so nothing here assumes a timezone.
 */

/** JavaScript weekday numbering: 0 = Sunday ... 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const HYDRATION_INTERVALS = [60, 90, 120, 180] as const;
export type HydrationInterval = (typeof HYDRATION_INTERVALS)[number];

export const REMINDER_SETTINGS_VERSION = 1;

export type ReminderSettings = {
  version: typeof REMINDER_SETTINGS_VERSION;
  workout: { enabled: boolean; days: Weekday[]; timeMinutes: number };
  hydration: { enabled: boolean; intervalMinutes: HydrationInterval };
  goals: { enabled: boolean; timeMinutes: number };
  /** Reminder-only quiet hours. The app has no bedtime/wake setting, so this is not derived from sleep data. */
  quietHours: { enabled: boolean; startMinutes: number; endMinutes: number };
};

export function defaultReminderSettings(): ReminderSettings {
  return {
    version: REMINDER_SETTINGS_VERSION,
    workout: { enabled: false, days: [1, 3, 5], timeMinutes: 18 * 60 },
    hydration: { enabled: false, intervalMinutes: 120 },
    goals: { enabled: false, timeMinutes: 19 * 60 },
    quietHours: { enabled: false, startMinutes: 22 * 60, endMinutes: 7 * 60 },
  };
}

/** Hydration window used when quiet hours are off. */
export const DEFAULT_DAY_WINDOW = { startMinutes: 7 * 60, endMinutes: 22 * 60 } as const;

const MINUTES_PER_DAY = 1440;

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readMinutes(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < MINUTES_PER_DAY ? value : fallback;
}

function readWeekdays(value: unknown, fallback: Weekday[]): Weekday[] {
  if (!Array.isArray(value)) return fallback;
  const days = new Set<Weekday>();
  for (const item of value) {
    if (typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 6) days.add(item as Weekday);
  }
  return Array.from(days).sort((a, b) => a - b);
}

function readInterval(value: unknown, fallback: HydrationInterval): HydrationInterval {
  return (HYDRATION_INTERVALS as readonly number[]).includes(value as number) ? (value as HydrationInterval) : fallback;
}

/**
 * Reads stored settings without ever throwing. Missing, corrupt, or outdated (different
 * version) data falls back to the defaults, field by field, so a bad value can never
 * produce a bad schedule.
 */
export function parseReminderSettings(raw: string | null | undefined): ReminderSettings {
  const defaults = defaultReminderSettings();
  if (!raw) return defaults;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (typeof parsed !== "object" || parsed === null) return defaults;
  const source = parsed as Record<string, unknown>;
  if (source.version !== REMINDER_SETTINGS_VERSION) return defaults;
  const workout = (source.workout ?? {}) as Record<string, unknown>;
  const hydration = (source.hydration ?? {}) as Record<string, unknown>;
  const goals = (source.goals ?? {}) as Record<string, unknown>;
  const quiet = (source.quietHours ?? {}) as Record<string, unknown>;
  return {
    version: REMINDER_SETTINGS_VERSION,
    workout: {
      enabled: readBoolean(workout.enabled, defaults.workout.enabled),
      days: readWeekdays(workout.days, defaults.workout.days),
      timeMinutes: readMinutes(workout.timeMinutes, defaults.workout.timeMinutes),
    },
    hydration: {
      enabled: readBoolean(hydration.enabled, defaults.hydration.enabled),
      intervalMinutes: readInterval(hydration.intervalMinutes, defaults.hydration.intervalMinutes),
    },
    goals: {
      enabled: readBoolean(goals.enabled, defaults.goals.enabled),
      timeMinutes: readMinutes(goals.timeMinutes, defaults.goals.timeMinutes),
    },
    quietHours: {
      enabled: readBoolean(quiet.enabled, defaults.quietHours.enabled),
      startMinutes: readMinutes(quiet.startMinutes, defaults.quietHours.startMinutes),
      endMinutes: readMinutes(quiet.endMinutes, defaults.quietHours.endMinutes),
    },
  };
}

export function serializeReminderSettings(settings: ReminderSettings): string {
  return JSON.stringify(settings);
}

export type ReminderValidationError = { field: "workout.days" | "quietHours" | "time"; message: string };

/** Problems a person can fix in the settings screen. Enabled sections that would schedule nothing are reported. */
export function validateReminderSettings(settings: ReminderSettings): ReminderValidationError[] {
  const errors: ReminderValidationError[] = [];
  if (settings.workout.enabled && settings.workout.days.length === 0) {
    errors.push({ field: "workout.days", message: "Pick at least one day for workout reminders." });
  }
  if (settings.quietHours.enabled && settings.quietHours.startMinutes === settings.quietHours.endMinutes) {
    errors.push({ field: "quietHours", message: "Quiet hours need different start and end times." });
  }
  const times = [
    settings.workout.timeMinutes,
    settings.goals.timeMinutes,
    settings.quietHours.startMinutes,
    settings.quietHours.endMinutes,
  ];
  if (times.some((minutes) => !Number.isInteger(minutes) || minutes < 0 || minutes >= MINUTES_PER_DAY)) {
    errors.push({ field: "time", message: "A reminder time is not a valid time of day." });
  }
  return errors;
}

/** True when a minute-of-day falls inside quiet hours. Handles a window that crosses midnight (22:00 to 07:00). */
export function isQuietMinute(minute: number, quiet: ReminderSettings["quietHours"]): boolean {
  if (!quiet.enabled) return false;
  const { startMinutes: start, endMinutes: end } = quiet;
  if (start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** Hours reminders may fire in: the complement of quiet hours, or the default day window when quiet hours are off. */
export function reminderWindow(settings: ReminderSettings): { startMinutes: number; endMinutes: number } {
  if (settings.quietHours.enabled && settings.quietHours.startMinutes !== settings.quietHours.endMinutes) {
    return { startMinutes: settings.quietHours.endMinutes, endMinutes: settings.quietHours.startMinutes };
  }
  return { startMinutes: DEFAULT_DAY_WINDOW.startMinutes, endMinutes: DEFAULT_DAY_WINDOW.endMinutes };
}

/** Minutes-of-day for one day of hydration reminders: one interval after the window opens, then every interval, all before it closes. */
export function hydrationSlotMinutes(settings: ReminderSettings): number[] {
  const window = reminderWindow(settings);
  const length = (window.endMinutes - window.startMinutes + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY;
  const slots: number[] = [];
  for (let offset = settings.hydration.intervalMinutes; offset < length; offset += settings.hydration.intervalMinutes) {
    const minute = (window.startMinutes + offset) % MINUTES_PER_DAY;
    if (!isQuietMinute(minute, settings.quietHours)) slots.push(minute);
  }
  return slots;
}

// --- Goals ---------------------------------------------------------------------------

export type GoalProgress = {
  /** null when no step source is available. Unknown is never treated as incomplete. */
  stepsToday: number | null;
  stepGoal: number | null;
  waterMlToday: number;
  hydrationTargetMl: number | null;
};

export function hydrationGoalMet(goals: GoalProgress): boolean {
  return goals.hydrationTargetMl != null && goals.hydrationTargetMl > 0 && goals.waterMlToday >= goals.hydrationTargetMl;
}

/** Goals that are known to be unfinished right now. A goal with no target, or no measurement, is left out. */
export function incompleteGoals(goals: GoalProgress): Array<"steps" | "water"> {
  const open: Array<"steps" | "water"> = [];
  if (goals.stepGoal != null && goals.stepGoal > 0 && goals.stepsToday != null && goals.stepsToday < goals.stepGoal) open.push("steps");
  if (goals.hydrationTargetMl != null && goals.hydrationTargetMl > 0 && goals.waterMlToday < goals.hydrationTargetMl) open.push("water");
  return open;
}

// --- Plan ----------------------------------------------------------------------------

export const NOTIFICATION_ID_PREFIX = "vitacore.";
export const MAX_PENDING_NOTIFICATIONS = 60;
export const HYDRATION_HORIZON_DAYS = 2;
export const GOAL_HORIZON_DAYS = 3;

/** Only these screens can be opened from a notification tap. */
export const NOTIFICATION_ROUTES = ["/", "/workout", "/nutrition"] as const;
export type NotificationRoute = (typeof NOTIFICATION_ROUTES)[number];

export function isAllowedNotificationRoute(route: unknown): route is NotificationRoute {
  return typeof route === "string" && (NOTIFICATION_ROUTES as readonly string[]).includes(route);
}

export type ReminderKind = "workout" | "hydration" | "goal";

export type PlannedTrigger =
  | { type: "weekly"; weekday: Weekday; hour: number; minute: number }
  | { type: "date"; at: Date };

export type PlannedNotification = {
  id: string;
  kind: ReminderKind;
  title: string;
  body: string;
  trigger: PlannedTrigger;
  route: NotificationRoute;
};

const WORKOUT_COPY: ReadonlyArray<{ title: string; body: string }> = [
  { title: "Time to move", body: "Your workout window is open. Pick something short or long in VitaCore." },
  { title: "Ready when you are", body: "A workout you finish beats one you skip. Open VitaCore to choose one." },
  { title: "Workout time", body: "Set aside a little time for yourself. Your session is a tap away." },
];

const HYDRATION_COPY: ReadonlyArray<{ title: string; body: string }> = [
  { title: "Water break", body: "A glass of water now helps the rest of the day." },
  { title: "Drink up", body: "Take a minute for some water." },
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function localTimeKey(date: Date): string {
  return `${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Local calendar date `dayOffset` days after `now`, at the given minute of the day. */
function atLocal(now: Date, dayOffset: number, minutes: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, Math.floor(minutes / 60), minutes % 60, 0, 0);
}

function joinNatural(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function goalBody(open: Array<"steps" | "water"> | null): string {
  if (!open) return "A quick check on your daily goals. Open VitaCore to see where you are.";
  const labels = open.map((goal) => (goal === "steps" ? "Steps" : "Water"));
  const noun = open.length > 1 ? "goals" : "goal";
  const lead = joinNatural(labels);
  return `${lead} ${noun} may still be open today. Open VitaCore to check.`;
}

export type PlanResult = { notifications: PlannedNotification[]; truncated: boolean };

/**
 * Builds the reminders that should exist right now.
 *
 * - Workout reminders repeat weekly on the chosen days.
 * - Hydration and goal reminders are one-off dates covering the next couple of days, and the
 *   app re-plans on launch, on return to the foreground, and after data changes. That is what
 *   lets today's reminders be dropped once a goal is met. Local notifications cannot run code
 *   when they fire, so this is the only way to avoid a reminder for a finished goal.
 * - Times already in the past are skipped. Invalid sections are skipped rather than guessed.
 */
export function planReminders(settings: ReminderSettings, context: { now: Date; goals: GoalProgress }): PlanResult {
  const { now, goals } = context;
  const errors = validateReminderSettings(settings);
  const workoutBlocked = errors.some((error) => error.field === "workout.days" || error.field === "time");
  const timeBlocked = errors.some((error) => error.field === "time");
  const quietBlocked = errors.some((error) => error.field === "quietHours");
  const earliest = now.getTime() + 60_000;

  const workout: PlannedNotification[] = [];
  if (settings.workout.enabled && !workoutBlocked) {
    settings.workout.days.forEach((weekday, index) => {
      const copy = WORKOUT_COPY[index % WORKOUT_COPY.length] as { title: string; body: string };
      workout.push({
        id: `${NOTIFICATION_ID_PREFIX}workout.${weekday}`,
        kind: "workout",
        title: copy.title,
        body: copy.body,
        trigger: {
          type: "weekly",
          weekday,
          hour: Math.floor(settings.workout.timeMinutes / 60),
          minute: settings.workout.timeMinutes % 60,
        },
        route: "/workout",
      });
    });
  }

  const goal: PlannedNotification[] = [];
  if (settings.goals.enabled && !timeBlocked) {
    for (let offset = 0; offset < GOAL_HORIZON_DAYS; offset += 1) {
      const at = atLocal(now, offset, settings.goals.timeMinutes);
      if (at.getTime() < earliest) continue;
      let open: Array<"steps" | "water"> | null = null;
      if (offset === 0) {
        open = incompleteGoals(goals);
        if (open.length === 0) continue; // nothing known to be unfinished today
      }
      goal.push({
        id: `${NOTIFICATION_ID_PREFIX}goal.${localDateKey(at)}`,
        kind: "goal",
        title: "Today's goals",
        body: goalBody(open),
        trigger: { type: "date", at },
        route: "/",
      });
    }
  }

  const hydration: PlannedNotification[] = [];
  if (settings.hydration.enabled && !quietBlocked && !timeBlocked) {
    const slots = hydrationSlotMinutes(settings);
    for (let offset = 0; offset < HYDRATION_HORIZON_DAYS; offset += 1) {
      if (offset === 0 && hydrationGoalMet(goals)) continue; // today's target is already reached
      slots.forEach((minute, index) => {
        const at = atLocal(now, offset, minute);
        if (at.getTime() < earliest) return;
        const copy = HYDRATION_COPY[index % HYDRATION_COPY.length] as { title: string; body: string };
        hydration.push({
          id: `${NOTIFICATION_ID_PREFIX}hydration.${localDateKey(at)}.${localTimeKey(at)}`,
          kind: "hydration",
          title: copy.title,
          body: copy.body,
          trigger: { type: "date", at },
          route: "/nutrition",
        });
      });
    }
  }
  hydration.sort((a, b) => (a.trigger as { at: Date }).at.getTime() - (b.trigger as { at: Date }).at.getTime());

  // Priority when the OS pending limit is reached: workout, then goals, then the soonest hydration reminders.
  const all = [...workout, ...goal, ...hydration];
  return { notifications: all.slice(0, MAX_PENDING_NOTIFICATIONS), truncated: all.length > MAX_PENDING_NOTIFICATIONS };
}

// --- Permission ---------------------------------------------------------------------

export type NotificationPermission = { status: "granted" | "denied" | "undetermined"; canAskAgain: boolean };

export type ReminderPermissionState = "unsupported" | "granted" | "not_asked" | "denied_can_retry" | "blocked";

export function reminderPermissionState(permission: NotificationPermission | null, supported: boolean): ReminderPermissionState {
  if (!supported || permission == null) return "unsupported";
  if (permission.status === "granted") return "granted";
  if (permission.status === "undetermined") return "not_asked";
  return permission.canAskAgain ? "denied_can_retry" : "blocked";
}

/** The system prompt is only ever shown in response to a person turning a reminder on, and never once it is blocked. */
export function shouldRequestPermission(state: ReminderPermissionState): boolean {
  return state === "not_asked" || state === "denied_can_retry";
}

/** With no permission nothing is scheduled, so turning a reminder on cannot leave hidden schedules behind. */
export function desiredSchedule(
  settings: ReminderSettings,
  context: { now: Date; goals: GoalProgress },
  permission: ReminderPermissionState,
): PlanResult {
  if (permission !== "granted") return { notifications: [], truncated: false };
  return planReminders(settings, context);
}

// --- Reconciling with what the OS already has ---------------------------------------

export function triggerKey(trigger: PlannedTrigger): string {
  return trigger.type === "weekly"
    ? `weekly:${trigger.weekday}:${trigger.hour}:${trigger.minute}`
    : `date:${trigger.at.getTime()}`;
}

/** Changes whenever anything a person would see, or when it fires, or where a tap goes, changes. */
export function notificationSignature(planned: PlannedNotification): string {
  return [planned.kind, planned.title, planned.body, planned.route, triggerKey(planned.trigger)].join("|");
}

export type ScheduleDiff = {
  /** Identifiers to cancel: ours that are no longer wanted, or whose content changed. */
  cancel: string[];
  /** Notifications to (re)schedule. Every one has a stable identifier, so no duplicates can accumulate. */
  schedule: PlannedNotification[];
  /** Signatures to remember for the next comparison. */
  signatures: Record<string, string>;
};

/**
 * Compares the wanted plan with what the OS reports as scheduled. Only identifiers with this
 * app's prefix are ever cancelled. An unchanged reminder is left alone, a changed one is
 * cancelled and scheduled again, and one the OS no longer has is scheduled again.
 */
export function diffSchedule(
  planned: PlannedNotification[],
  existingIds: string[],
  storedSignatures: Record<string, string>,
): ScheduleDiff {
  const ours = new Set(existingIds.filter((id) => id.startsWith(NOTIFICATION_ID_PREFIX)));
  const signatures: Record<string, string> = {};
  const plannedById = new Map<string, PlannedNotification>();
  for (const item of planned) {
    plannedById.set(item.id, item);
    signatures[item.id] = notificationSignature(item);
  }
  const cancel: string[] = [];
  for (const id of ours) {
    if (!plannedById.has(id) || storedSignatures[id] !== signatures[id]) cancel.push(id);
  }
  const schedule = planned.filter((item) => !ours.has(item.id) || storedSignatures[item.id] !== signatures[item.id]);
  return { cancel, schedule, signatures };
}
