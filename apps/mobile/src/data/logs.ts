import {
  bestLifts,
  createProductEvent,
  isValidWaterAmountMl,
  sleepMinutesByDay,
  valuesByLocalDay,
  type DatedValue,
  type ProductEventName,
} from "@vitacore/domain";
import { enqueue, getDatabase, readPreference, writePreference } from "./db";
import { createId } from "@/lib/id";

export async function recordEvent(name: ProductEventName, subjectId?: string | null): Promise<void> {
  const event = createProductEvent({
    name,
    occurredAt: new Date().toISOString(),
    subjectId: subjectId ?? null,
  });
  const db = await getDatabase();
  await db.runAsync(
    "INSERT INTO product_events (id, name, occurred_at, subject_id) VALUES (?, ?, ?, ?)",
    createId(),
    event.name,
    event.occurredAt,
    event.subjectId,
  );
}

export type MealName = "breakfast" | "lunch" | "dinner" | "snack";

export async function logFood(input: {
  day: string;
  timezone: string;
  meal: MealName;
  name: string;
  source: string;
  sourceId: string | null;
  servings: number;
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  notes?: string | null;
}): Promise<string> {
  const id = createId();
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO nutrition_logs (
      id, day, timezone, meal, food_name, source, source_id, servings, kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, logged_at, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.day,
    input.timezone,
    input.meal,
    input.name,
    input.source,
    input.sourceId,
    input.servings,
    input.kcal * input.servings,
    input.proteinG == null ? null : input.proteinG * input.servings,
    input.carbsG == null ? null : input.carbsG * input.servings,
    input.fatG == null ? null : input.fatG * input.servings,
    input.fiberG == null ? null : input.fiberG * input.servings,
    input.sugarG == null ? null : input.sugarG * input.servings,
    input.sodiumMg == null ? null : input.sodiumMg * input.servings,
    new Date().toISOString(),
    input.notes?.trim() || null,
  );
  await enqueue("nutrition_logs", id);
  await recordEvent(input.source === "barcode" ? "food_scanned" : "meal_logged", id);
  return id;
}

export type FoodLogRow = {
  id: string;
  day: string;
  meal: MealName;
  food_name: string;
  source: string;
  servings: number;
  kcal: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
  notes: string | null;
  logged_at: string;
};

export async function foodsForDay(day: string): Promise<FoodLogRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<FoodLogRow>(
    `SELECT id, day, meal, food_name, source, servings, kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, notes, logged_at
     FROM nutrition_logs WHERE day = ? ORDER BY logged_at DESC`,
    day,
  );
}

export async function foodLogById(id: string): Promise<FoodLogRow | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<FoodLogRow>(
    `SELECT id, day, meal, food_name, source, servings, kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, notes, logged_at
     FROM nutrition_logs WHERE id = ?`,
    id,
  );
  return row ?? null;
}

/**
 * Edits an existing entry's stored totals directly (name, meal, macros, notes) rather than
 * its serving count — only the final per-entry totals are stored locally (see logFood),
 * so there is no separate per-serving value to rescale from.
 */
export async function updateFoodLog(
  id: string,
  patch: {
    meal: MealName;
    name: string;
    kcal: number;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
    sugarG: number | null;
    sodiumMg: number | null;
    notes: string | null;
  },
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE nutrition_logs SET meal = ?, food_name = ?, kcal = ?, protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = ?, sugar_g = ?, sodium_mg = ?, notes = ? WHERE id = ?`,
    patch.meal,
    patch.name,
    patch.kcal,
    patch.proteinG,
    patch.carbsG,
    patch.fatG,
    patch.fiberG,
    patch.sugarG,
    patch.sodiumMg,
    patch.notes?.trim() || null,
    id,
  );
  // Re-queues the current row for sync; if it had already synced, this upserts the edit onto the same remote row.
  await enqueue("nutrition_logs", id);
}

/**
 * Removes a food entry locally and queues a remote delete for the same client_id.
 * Not-yet-synced upserts for this id are superseded by the newer delete outbox row.
 */
export async function deleteFoodLog(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM nutrition_logs WHERE id = ?", id);
  await enqueue("nutrition_logs", id, "delete");
}

export async function waterForDay(day: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ total: number | null }>("SELECT SUM(ml) AS total FROM hydration_logs WHERE day = ?", day);
  return row?.total ?? 0;
}

/** Throws for a negative, zero, non-integer, or unreasonably large amount rather than storing it. */
export async function addWater(day: string, timezone: string, ml: number): Promise<string> {
  if (!isValidWaterAmountMl(ml)) throw new Error("Water amount must be a whole number of millilitres greater than zero.");
  const id = createId();
  const db = await getDatabase();
  await db.runAsync(
    "INSERT INTO hydration_logs (id, day, timezone, ml, logged_at) VALUES (?, ?, ?, ?, ?)",
    id,
    day,
    timezone,
    ml,
    new Date().toISOString(),
  );
  await enqueue("hydration_logs", id);
  return id;
}

export type WaterLogRow = { id: string; ml: number; logged_at: string };

export async function waterEntriesForDay(day: string): Promise<WaterLogRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<WaterLogRow>("SELECT id, ml, logged_at FROM hydration_logs WHERE day = ? ORDER BY logged_at DESC", day);
}

/** Removes a water entry locally and queues a remote delete for the same client_id. */
export async function deleteWaterLog(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM hydration_logs WHERE id = ?", id);
  await enqueue("hydration_logs", id, "delete");
}

export async function saveSleep(input: { day: string; timezone: string; start: string; end: string }): Promise<void> {
  const id = createId();
  const db = await getDatabase();
  await db.runAsync(
    "INSERT INTO sleep_sessions (id, day, timezone, asleep_start, asleep_end, source) VALUES (?, ?, ?, ?, ?, 'manual')",
    id,
    input.day,
    input.timezone,
    input.start,
    input.end,
  );
  await enqueue("sleep_sessions", id);
  await recordEvent("sleep_recorded", id);
}

export async function latestManualSleep() {
  const db = await getDatabase();
  return db.getFirstAsync<{ day: string; asleep_start: string; asleep_end: string; source: string }>(
    "SELECT day, asleep_start, asleep_end, source FROM sleep_sessions ORDER BY asleep_end DESC LIMIT 1",
  );
}

export async function createWorkout(): Promise<string> {
  const id = createId();
  const db = await getDatabase();
  await db.runAsync(
    "INSERT INTO workout_sessions (id, title, started_at, ended_at, timezone) VALUES (?, NULL, ?, NULL, ?)",
    id,
    new Date().toISOString(),
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  await recordEvent("workout_started", id);
  return id;
}

export async function addSet(input: {
  sessionId: string;
  exerciseId: string;
  exerciseName: string;
  reps: number | null;
  weightKg: number | null;
}): Promise<void> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM workout_sets WHERE session_id = ? AND exercise_id = ?",
    input.sessionId,
    input.exerciseId,
  );
  await db.runAsync(
    `INSERT INTO workout_sets (
      id, session_id, exercise_id, exercise_name, set_index, reps, weight_kg, duration_seconds, rpe, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    createId(),
    input.sessionId,
    input.exerciseId,
    input.exerciseName,
    (row?.count ?? 0) + 1,
    input.reps,
    input.weightKg,
    new Date().toISOString(),
  );
}

export async function finishWorkout(sessionId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("UPDATE workout_sessions SET ended_at = ? WHERE id = ?", new Date().toISOString(), sessionId);
  await enqueue("workout_sessions", sessionId);
  await recordEvent("workout_completed", sessionId);
}

export async function listWorkouts() {
  const db = await getDatabase();
  return db.getAllAsync<{ id: string; started_at: string; ended_at: string | null }>(
    "SELECT id, started_at, ended_at FROM workout_sessions ORDER BY started_at DESC LIMIT 20",
  );
}

export async function setsForSession(sessionId: string) {
  const db = await getDatabase();
  return db.getAllAsync<{
    id: string;
    exercise_name: string;
    set_index: number;
    reps: number | null;
    weight_kg: number | null;
  }>("SELECT id, exercise_name, set_index, reps, weight_kg FROM workout_sets WHERE session_id = ? ORDER BY completed_at", sessionId);
}

// --- Incremental activity recording -------------------------------------------------
// A GPS activity is written to SQLite as it happens (session row first, then one point at
// a time) instead of in one batch at the end. That is what lets the background location
// task, which has no React state, add points to the very same activity_sessions /
// activity_points rows the foreground screen uses, and what lets an interrupted recording
// survive an app restart.
//
// (This replaced an earlier one-shot saveActivity() that inserted a session and all its
// points at the end of a recording. Phase 3 moved every caller to the incremental
// functions below; the old function had no remaining callers and was removed as dead code
// in the final handoff audit.)

export type ActivityPointInput = { latitude: number; longitude: number; altitudeMeters: number | null; recordedAtMs: number };

/** Inserts an open session (ended_at NULL). It is not queued for sync until finishActivitySession. */
export async function beginActivitySession(input: { kind: string; startedAt: string; timezone: string }): Promise<string> {
  const id = createId();
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO activity_sessions (id, kind, started_at, ended_at, timezone, distance_meters, moving_seconds)
     VALUES (?, ?, ?, NULL, ?, 0, 0)`,
    id,
    input.kind,
    input.startedAt,
    input.timezone,
  );
  return id;
}

export async function appendActivityPoint(sessionId: string, point: ActivityPointInput): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO activity_points (id, session_id, latitude, longitude, altitude_meters, recorded_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
    createId(),
    sessionId,
    point.latitude,
    point.longitude,
    point.altitudeMeters,
    point.recordedAtMs,
  );
}

export async function activityPointsForSession(sessionId: string): Promise<ActivityPointInput[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    latitude: number;
    longitude: number;
    altitude_meters: number | null;
    recorded_at_ms: number;
  }>(
    "SELECT latitude, longitude, altitude_meters, recorded_at_ms FROM activity_points WHERE session_id = ? ORDER BY recorded_at_ms ASC",
    sessionId,
  );
  return rows.map((row) => ({
    latitude: row.latitude,
    longitude: row.longitude,
    altitudeMeters: row.altitude_meters,
    recordedAtMs: row.recorded_at_ms,
  }));
}

export async function activitySummary(
  sessionId: string,
): Promise<{ kind: string; startedAt: string; distanceMeters: number; movingSeconds: number } | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ kind: string; started_at: string; distance_meters: number; moving_seconds: number }>(
    "SELECT kind, started_at, distance_meters, moving_seconds FROM activity_sessions WHERE id = ?",
    sessionId,
  );
  return row
    ? { kind: row.kind, startedAt: row.started_at, distanceMeters: row.distance_meters, movingSeconds: row.moving_seconds }
    : null;
}

export async function activitySessionInfo(sessionId: string): Promise<{ kind: string; startedAt: string } | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ kind: string; started_at: string }>(
    "SELECT kind, started_at FROM activity_sessions WHERE id = ? AND ended_at IS NULL",
    sessionId,
  );
  return row ? { kind: row.kind, startedAt: row.started_at } : null;
}

/** Closes the session with final totals and queues it for sync (the sync worker also uploads its points). */
export async function finishActivitySession(
  sessionId: string,
  input: { endedAt: string; distanceMeters: number; movingSeconds: number },
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE activity_sessions SET ended_at = ?, distance_meters = ?, moving_seconds = ? WHERE id = ?",
    input.endedAt,
    input.distanceMeters,
    input.movingSeconds,
    sessionId,
  );
  await enqueue("activity_sessions", sessionId);
}

const ACTIVE_ACTIVITY_KEY = "active_activity_session";

/**
 * Which activity, if any, is currently being recorded, and whether it is paused. Kept in
 * durable storage rather than React state so the headless background task and an app
 * restart can both read it. Passing null means "no activity is being recorded".
 */
export async function setActiveActivitySession(state: { id: string; paused: boolean } | null): Promise<void> {
  await writePreference(ACTIVE_ACTIVITY_KEY, state ? JSON.stringify(state) : "");
}

export async function getActiveActivitySession(): Promise<{ id: string; paused: boolean } | null> {
  const raw = await readPreference(ACTIVE_ACTIVITY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { id?: unknown; paused?: unknown };
    return typeof parsed.id === "string" ? { id: parsed.id, paused: parsed.paused === true } : null;
  } catch {
    return null;
  }
}

export async function listActivities() {
  const db = await getDatabase();
  return db.getAllAsync<{ id: string; kind: string; started_at: string; distance_meters: number; moving_seconds: number }>(
    "SELECT id, kind, started_at, distance_meters, moving_seconds FROM activity_sessions WHERE ended_at IS NOT NULL ORDER BY started_at DESC LIMIT 20",
  );
}

export type LocalHistory = {
  kcal: DatedValue[];
  waterMl: DatedValue[];
  sleepMinutes: DatedValue[];
  distanceMeters: DatedValue[];
  finishedWorkouts: DatedValue[];
  volumeKg: DatedValue[];
  records: ReturnType<typeof bestLifts>;
};

export async function loadLocalHistory(timeZone: string): Promise<LocalHistory> {
  const db = await getDatabase();
  const kcalRows = await db.getAllAsync<{ day: string; kcal: number }>("SELECT day, kcal FROM nutrition_logs");
  const waterRows = await db.getAllAsync<{ day: string; ml: number }>("SELECT day, ml FROM hydration_logs");
  const sleepRows = await db.getAllAsync<{ asleep_start: string; asleep_end: string }>(
    "SELECT asleep_start, asleep_end FROM sleep_sessions",
  );
  const activityRows = await db.getAllAsync<{ started_at: string; distance_meters: number }>(
    "SELECT started_at, distance_meters FROM activity_sessions WHERE ended_at IS NOT NULL",
  );
  const workoutRows = await db.getAllAsync<{ started_at: string }>(
    "SELECT started_at FROM workout_sessions WHERE ended_at IS NOT NULL",
  );
  const setRows = await db.getAllAsync<{
    exercise_name: string;
    reps: number | null;
    weight_kg: number | null;
    completed_at: string;
  }>("SELECT exercise_name, reps, weight_kg, completed_at FROM workout_sets");

  return {
    kcal: kcalRows.map((row) => ({ day: row.day, value: row.kcal })),
    waterMl: waterRows.map((row) => ({ day: row.day, value: row.ml })),
    sleepMinutes: sleepMinutesByDay(
      sleepRows.map((row) => ({ asleepStart: row.asleep_start, asleepEnd: row.asleep_end })),
      timeZone,
    ),
    distanceMeters: valuesByLocalDay(
      activityRows.map((row) => ({ at: row.started_at, value: row.distance_meters })),
      timeZone,
    ),
    finishedWorkouts: valuesByLocalDay(
      workoutRows.map((row) => ({ at: row.started_at, value: 1 })),
      timeZone,
    ),
    volumeKg: valuesByLocalDay(
      setRows
        .filter((row) => row.weight_kg != null && row.reps != null)
        .map((row) => ({ at: row.completed_at, value: (row.weight_kg ?? 0) * (row.reps ?? 0) })),
      timeZone,
    ),
    records: bestLifts(
      setRows.map((row) => ({ exerciseName: row.exercise_name, weightKg: row.weight_kg, reps: row.reps })),
    ),
  };
}

export async function exportLocalJson(): Promise<string> {
  const db = await getDatabase();
  const profile = await db.getAllAsync("SELECT * FROM profile");
  const events = await db.getAllAsync("SELECT name, occurred_at FROM product_events");
  const workouts = await db.getAllAsync("SELECT id, started_at, ended_at FROM workout_sessions");
  const meals = await db.getAllAsync("SELECT day, meal, food_name, kcal, source FROM nutrition_logs");
  return JSON.stringify({ profile, events, workouts, meals }, null, 2);
}
