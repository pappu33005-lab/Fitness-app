import { describe, expect, it } from "vitest";
import {
  MAX_PENDING_NOTIFICATIONS,
  defaultReminderSettings,
  desiredSchedule,
  diffSchedule,
  hydrationSlotMinutes,
  incompleteGoals,
  isAllowedNotificationRoute,
  isQuietMinute,
  parseReminderSettings,
  planReminders,
  reminderPermissionState,
  serializeReminderSettings,
  shouldRequestPermission,
  validateReminderSettings,
  type GoalProgress,
  type ReminderSettings,
} from "./reminders";

// Local-time constructors keep these tests independent of the machine's timezone.
const monday9am = new Date(2026, 8, 28, 9, 0, 0, 0);
const openGoals: GoalProgress = { stepsToday: 1000, stepGoal: 8000, waterMlToday: 500, hydrationTargetMl: 2000 };
const metGoals: GoalProgress = { stepsToday: 9000, stepGoal: 8000, waterMlToday: 2500, hydrationTargetMl: 2000 };

function settings(patch: Partial<ReminderSettings> = {}): ReminderSettings {
  return { ...defaultReminderSettings(), ...patch };
}

describe("enabling and disabling reminders", () => {
  it("plans nothing when every reminder is off (the default)", () => {
    expect(planReminders(defaultReminderSettings(), { now: monday9am, goals: openGoals }).notifications).toEqual([]);
  });

  it("plans one weekly notification per selected day when workout reminders are on", () => {
    const plan = planReminders(
      settings({ workout: { enabled: true, days: [1, 3, 5], timeMinutes: 18 * 60 + 30 } }),
      { now: monday9am, goals: openGoals },
    );
    expect(plan.notifications).toHaveLength(3);
    expect(plan.notifications.map((n) => n.id)).toEqual(["vitacore.workout.1", "vitacore.workout.3", "vitacore.workout.5"]);
    for (const n of plan.notifications) {
      expect(n.trigger).toMatchObject({ type: "weekly", hour: 18, minute: 30 });
      expect(n.route).toBe("/workout");
    }
  });

  it("cancels a reminder that was turned off", () => {
    const on = settings({ workout: { enabled: true, days: [2], timeMinutes: 480 } });
    const off = settings({ workout: { enabled: false, days: [2], timeMinutes: 480 } });
    const before = planReminders(on, { now: monday9am, goals: openGoals }).notifications;
    const after = planReminders(off, { now: monday9am, goals: openGoals }).notifications;
    const scheduled = diffSchedule(before, [], {});
    const diff = diffSchedule(after, before.map((n) => n.id), scheduled.signatures);
    expect(after).toEqual([]);
    expect(diff.cancel).toEqual(["vitacore.workout.2"]);
    expect(diff.schedule).toEqual([]);
  });
});

describe("duplicate prevention, cancellation and schedule updates", () => {
  const on = settings({ workout: { enabled: true, days: [1, 4], timeMinutes: 7 * 60 } });
  const plan = planReminders(on, { now: monday9am, goals: openGoals }).notifications;
  const first = diffSchedule(plan, [], {});

  it("gives every notification a unique, stable identifier", () => {
    const ids = plan.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const again = planReminders(on, { now: monday9am, goals: openGoals }).notifications.map((n) => n.id);
    expect(again).toEqual(ids);
  });

  it("schedules everything the first time", () => {
    expect(first.schedule).toHaveLength(2);
    expect(first.cancel).toEqual([]);
  });

  it("does nothing when re-planning an unchanged schedule (no duplicates)", () => {
    const second = diffSchedule(plan, plan.map((n) => n.id), first.signatures);
    expect(second.schedule).toEqual([]);
    expect(second.cancel).toEqual([]);
  });

  it("replaces a reminder whose time changed instead of adding a second one", () => {
    const moved = planReminders(
      settings({ workout: { enabled: true, days: [1, 4], timeMinutes: 8 * 60 } }),
      { now: monday9am, goals: openGoals },
    ).notifications;
    const diff = diffSchedule(moved, plan.map((n) => n.id), first.signatures);
    expect(diff.cancel.sort()).toEqual(["vitacore.workout.1", "vitacore.workout.4"]);
    expect(diff.schedule.map((n) => n.id).sort()).toEqual(["vitacore.workout.1", "vitacore.workout.4"]);
  });

  it("reschedules a reminder the OS no longer has", () => {
    const diff = diffSchedule(plan, ["vitacore.workout.1"], first.signatures);
    expect(diff.schedule.map((n) => n.id)).toEqual(["vitacore.workout.4"]);
  });

  it("cancels its own stale reminders but never touches identifiers from anywhere else", () => {
    const diff = diffSchedule([], ["vitacore.workout.6", "someone-elses-id"], {});
    expect(diff.cancel).toEqual(["vitacore.workout.6"]);
  });
});

describe("goal reminders", () => {
  const goalOn = settings({ goals: { enabled: true, timeMinutes: 19 * 60 } });

  it("reminds today when a known goal is unfinished, without inventing numbers", () => {
    const today = planReminders(goalOn, { now: monday9am, goals: openGoals }).notifications.find((n) => n.id === "vitacore.goal.20260928");
    expect(today).toBeDefined();
    expect(today?.body).toContain("Steps and Water goals");
    expect(today?.body).not.toMatch(/\d/);
  });

  it("skips today's reminder when the goals are already completed", () => {
    const ids = planReminders(goalOn, { now: monday9am, goals: metGoals }).notifications.map((n) => n.id);
    expect(ids).not.toContain("vitacore.goal.20260928");
    expect(ids).toContain("vitacore.goal.20260929");
  });

  it("does not treat an unmeasured or unset goal as incomplete", () => {
    expect(incompleteGoals({ stepsToday: null, stepGoal: 8000, waterMlToday: 0, hydrationTargetMl: null })).toEqual([]);
    expect(incompleteGoals({ stepsToday: 100, stepGoal: null, waterMlToday: 0, hydrationTargetMl: 0 })).toEqual([]);
  });

  it("skips a time that has already passed today", () => {
    const late = new Date(2026, 8, 28, 20, 0, 0, 0);
    const ids = planReminders(goalOn, { now: late, goals: openGoals }).notifications.map((n) => n.id);
    expect(ids).not.toContain("vitacore.goal.20260928");
  });
});

describe("hydration reminders and quiet hours", () => {
  it("never places a reminder inside quiet hours that cross midnight", () => {
    const quiet = { enabled: true, startMinutes: 22 * 60, endMinutes: 7 * 60 };
    const s = settings({ hydration: { enabled: true, intervalMinutes: 60 }, quietHours: quiet });
    const slots = hydrationSlotMinutes(s);
    expect(slots.length).toBeGreaterThan(0);
    for (const minute of slots) expect(isQuietMinute(minute, quiet)).toBe(false);
    expect(Math.min(...slots)).toBeGreaterThan(7 * 60);
    expect(Math.max(...slots)).toBeLessThan(22 * 60);
  });

  it("handles quiet hours inside one day and a daytime quiet window (night-shift)", () => {
    expect(isQuietMinute(13 * 60, { enabled: true, startMinutes: 12 * 60, endMinutes: 14 * 60 })).toBe(true);
    expect(isQuietMinute(14 * 60, { enabled: true, startMinutes: 12 * 60, endMinutes: 14 * 60 })).toBe(false);
    const nightShift = { enabled: true, startMinutes: 8 * 60, endMinutes: 16 * 60 };
    const slots = hydrationSlotMinutes(settings({ hydration: { enabled: true, intervalMinutes: 120 }, quietHours: nightShift }));
    for (const minute of slots) expect(isQuietMinute(minute, nightShift)).toBe(false);
  });

  it("uses the interval and stays inside the default day window with quiet hours off", () => {
    const slots = hydrationSlotMinutes(settings({ hydration: { enabled: true, intervalMinutes: 180 } }));
    expect(slots).toEqual([10 * 60, 13 * 60, 16 * 60, 19 * 60]);
  });

  it("drops today's hydration reminders once the water target is met, but keeps tomorrow's", () => {
    const s = settings({ hydration: { enabled: true, intervalMinutes: 120 } });
    const plan = planReminders(s, { now: monday9am, goals: metGoals }).notifications;
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((n) => n.id.startsWith("vitacore.hydration.20260929"))).toBe(true);
  });

  it("skips workout and goal reminders whose time falls inside quiet hours", () => {
    const quiet = { enabled: true, startMinutes: 18 * 60, endMinutes: 7 * 60 };
    const plan = planReminders(
      settings({
        workout: { enabled: true, days: [1], timeMinutes: 20 * 60 },
        goals: { enabled: true, timeMinutes: 19 * 60 },
        quietHours: quiet,
      }),
      { now: monday9am, goals: openGoals },
    ).notifications;
    expect(plan.every((n) => n.kind === "hydration" || (n.kind !== "workout" && n.kind !== "goal"))).toBe(true);
    expect(plan.some((n) => n.kind === "workout")).toBe(false);
    expect(plan.some((n) => n.kind === "goal")).toBe(false);
  });

  it("stays under the OS pending limit even in the busiest configuration", () => {
    const s = settings({
      workout: { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], timeMinutes: 600 },
      hydration: { enabled: true, intervalMinutes: 60 },
      goals: { enabled: true, timeMinutes: 19 * 60 },
      quietHours: { enabled: true, startMinutes: 60, endMinutes: 120 },
    });
    const plan = planReminders(s, { now: monday9am, goals: openGoals });
    expect(plan.notifications.length).toBeLessThanOrEqual(MAX_PENDING_NOTIFICATIONS);
    expect(plan.truncated).toBe(false);
    expect(new Set(plan.notifications.map((n) => n.id)).size).toBe(plan.notifications.length);
  });
});

describe("invalid schedules", () => {
  it("reports enabled workout reminders with no days and plans nothing for them", () => {
    const s = settings({ workout: { enabled: true, days: [], timeMinutes: 600 } });
    expect(validateReminderSettings(s).map((e) => e.field)).toContain("workout.days");
    expect(planReminders(s, { now: monday9am, goals: openGoals }).notifications).toEqual([]);
  });

  it("rejects quiet hours with identical start and end, and skips hydration", () => {
    const s = settings({
      hydration: { enabled: true, intervalMinutes: 120 },
      quietHours: { enabled: true, startMinutes: 600, endMinutes: 600 },
    });
    expect(validateReminderSettings(s).map((e) => e.field)).toContain("quietHours");
    expect(planReminders(s, { now: monday9am, goals: openGoals }).notifications).toEqual([]);
  });

  it("rejects out-of-range times", () => {
    const s = settings({ goals: { enabled: true, timeMinutes: 2000 } });
    expect(validateReminderSettings(s).map((e) => e.field)).toContain("time");
    expect(planReminders(s, { now: monday9am, goals: openGoals }).notifications).toEqual([]);
  });
});

describe("persistence of settings", () => {
  it("round-trips through the stored JSON", () => {
    const s = settings({
      workout: { enabled: true, days: [0, 6], timeMinutes: 425 },
      hydration: { enabled: true, intervalMinutes: 90 },
      quietHours: { enabled: true, startMinutes: 1350, endMinutes: 390 },
    });
    expect(parseReminderSettings(serializeReminderSettings(s))).toEqual(s);
  });

  it("falls back to safe defaults for missing, corrupt, or outdated data", () => {
    const defaults = defaultReminderSettings();
    expect(parseReminderSettings(null)).toEqual(defaults);
    expect(parseReminderSettings("{not json")).toEqual(defaults);
    expect(parseReminderSettings("42")).toEqual(defaults);
    expect(parseReminderSettings(JSON.stringify({ version: 0, workout: { enabled: true } }))).toEqual(defaults);
  });

  it("repairs individual bad fields instead of trusting them", () => {
    const stored = JSON.stringify({
      version: 1,
      workout: { enabled: true, days: [1, 1, 9, "x", 3], timeMinutes: 99999 },
      hydration: { enabled: true, intervalMinutes: 17 },
    });
    const parsed = parseReminderSettings(stored);
    expect(parsed.workout.days).toEqual([1, 3]);
    expect(parsed.workout.timeMinutes).toBe(defaultReminderSettings().workout.timeMinutes);
    expect(parsed.hydration.intervalMinutes).toBe(120);
  });
});

describe("permission handling", () => {
  it("maps permission results to states", () => {
    expect(reminderPermissionState(null, true)).toBe("unsupported");
    expect(reminderPermissionState({ status: "granted", canAskAgain: true }, false)).toBe("unsupported");
    expect(reminderPermissionState({ status: "granted", canAskAgain: true }, true)).toBe("granted");
    expect(reminderPermissionState({ status: "undetermined", canAskAgain: true }, true)).toBe("not_asked");
    expect(reminderPermissionState({ status: "denied", canAskAgain: true }, true)).toBe("denied_can_retry");
    expect(reminderPermissionState({ status: "denied", canAskAgain: false }, true)).toBe("blocked");
  });

  it("only asks the system when asking can still work", () => {
    expect(shouldRequestPermission("not_asked")).toBe(true);
    expect(shouldRequestPermission("denied_can_retry")).toBe(true);
    expect(shouldRequestPermission("blocked")).toBe(false);
    expect(shouldRequestPermission("granted")).toBe(false);
    expect(shouldRequestPermission("unsupported")).toBe(false);
  });

  it("schedules nothing without permission, so nothing hidden is left behind", () => {
    const s = settings({ workout: { enabled: true, days: [1], timeMinutes: 600 } });
    for (const state of ["unsupported", "not_asked", "denied_can_retry", "blocked"] as const) {
      expect(desiredSchedule(s, { now: monday9am, goals: openGoals }, state).notifications).toEqual([]);
    }
    expect(desiredSchedule(s, { now: monday9am, goals: openGoals }, "granted").notifications).toHaveLength(1);
  });
});

describe("notification taps", () => {
  it("only allows known in-app routes", () => {
    expect(isAllowedNotificationRoute("/workout")).toBe(true);
    expect(isAllowedNotificationRoute("/nutrition")).toBe(true);
    expect(isAllowedNotificationRoute("/account")).toBe(false);
    expect(isAllowedNotificationRoute("https://example.com")).toBe(false);
    expect(isAllowedNotificationRoute(undefined)).toBe(false);
  });
});
