import { Platform } from "react-native";
import * as SQLite from "expo-sqlite";
import type {
  ActivityLevel,
  BodyGoal,
  DietaryPreference,
  FitnessLevel,
  SexForEstimate,
  UnitSystem,
  WorkoutPreference,
} from "@vitacore/domain";

export type LocalProfile = {
  id: string;
  displayName: string | null;
  ageYears: number | null;
  sex: SexForEstimate | null;
  heightCm: number | null;
  weightKg: number | null;
  fitnessLevel: FitnessLevel | null;
  activityLevel: ActivityLevel | null;
  goal: BodyGoal | null;
  unitSystem: UnitSystem;
  workoutPreference: WorkoutPreference | null;
  dietary: DietaryPreference[];
  sleepTargetMinutes: number | null;
  hydrationTargetMl: number | null;
  stepGoal: number | null;
  onboardingCompletedAt: string | null;
};

let database: SQLite.SQLiteDatabase | null = null;

const WEB_SNAPSHOT = "vitacore-sqlite";

function webStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("vitacore", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("kv")) request.result.createObjectStore("kv");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readWebSnapshot(): Promise<Uint8Array | null> {
  if (Platform.OS !== "web" || typeof indexedDB === "undefined") return null;
  const store = await webStore();
  return new Promise((resolve, reject) => {
    const tx = store.transaction("kv", "readonly");
    const request = tx.objectStore("kv").get(WEB_SNAPSHOT);
    request.onsuccess = () => resolve(request.result instanceof Uint8Array ? request.result : null);
    request.onerror = () => reject(request.error);
  });
}

async function writeWebSnapshot(bytes: Uint8Array): Promise<void> {
  const store = await webStore();
  await new Promise<void>((resolve, reject) => {
    const tx = store.transaction("kv", "readwrite");
    tx.objectStore("kv").put(bytes, WEB_SNAPSHOT);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function withWebPersistence(db: SQLite.SQLiteDatabase): SQLite.SQLiteDatabase {
  if (Platform.OS !== "web") return db;
  return new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if ((prop === "execAsync" || prop === "runAsync") && typeof value === "function") {
        return async (...args: unknown[]) => {
          const result = await (value as (...input: unknown[]) => Promise<unknown>).apply(target, args);
          try {
            await writeWebSnapshot(await target.serializeAsync());
          } catch (error) {
            console.error(error);
          }
          return result;
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  // iOS and Android persist vitacore.db on disk. The branches below exist only so the
  // browser UI preview can keep a guest session. They are not the production store.
  if (Platform.OS !== "web") return SQLite.openDatabaseAsync("vitacore.db");
  try {
    const snapshot = await readWebSnapshot();
    if (snapshot) return await SQLite.deserializeDatabaseAsync(snapshot);
  } catch {
    // A damaged browser snapshot is discarded. The next save replaces it.
  }
  return SQLite.openDatabaseAsync(":memory:");
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;
  const db = await openDatabase();
  await db.execAsync(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS profile (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      age_years INTEGER,
      sex TEXT,
      height_cm REAL,
      weight_kg REAL,
      fitness_level TEXT,
      activity_level TEXT,
      goal TEXT,
      unit_system TEXT NOT NULL,
      workout_preference TEXT,
      dietary_json TEXT NOT NULL,
      sleep_target_minutes INTEGER,
      hydration_target_ml INTEGER,
      step_goal INTEGER,
      onboarding_completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS product_events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      subject_id TEXT
    );
    CREATE TABLE IF NOT EXISTS nutrition_logs (
      id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      timezone TEXT NOT NULL,
      meal TEXT NOT NULL,
      food_name TEXT NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT,
      servings REAL NOT NULL,
      kcal REAL NOT NULL,
      protein_g REAL,
      carbs_g REAL,
      fat_g REAL,
      fiber_g REAL,
      sugar_g REAL,
      sodium_mg REAL,
      logged_at TEXT NOT NULL,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS custom_foods (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      brand TEXT,
      barcode TEXT,
      serving_label TEXT NOT NULL,
      kcal REAL NOT NULL,
      protein_g REAL NOT NULL,
      carbs_g REAL NOT NULL,
      fat_g REAL NOT NULL,
      fiber_g REAL,
      sugar_g REAL,
      sodium_mg REAL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hydration_logs (
      id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      timezone TEXT NOT NULL,
      ml INTEGER NOT NULL,
      logged_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workout_sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      timezone TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workout_sets (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      exercise_name TEXT NOT NULL,
      set_index INTEGER NOT NULL,
      reps INTEGER,
      weight_kg REAL,
      duration_seconds INTEGER,
      rpe REAL,
      completed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sleep_sessions (
      id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      timezone TEXT NOT NULL,
      asleep_start TEXT NOT NULL,
      asleep_end TEXT NOT NULL,
      source TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity_sessions (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      timezone TEXT NOT NULL,
      distance_meters REAL NOT NULL DEFAULT 0,
      moving_seconds INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS activity_points (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      altitude_meters REAL,
      recorded_at_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sound_favorites (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS sync_outbox (
      id TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL DEFAULT 'upsert',
      created_at TEXT NOT NULL,
      synced_at TEXT
    );
  `);
  // Column additions for tables that already existed before this one was added. CREATE TABLE
  // IF NOT EXISTS above never alters an existing table, so a new column needs an explicit,
  // idempotent migration here. Existing rows and all other data are untouched either way.
  await ensureColumn(db, "nutrition_logs", "notes", "TEXT");
  await ensureColumn(db, "sync_outbox", "operation", "TEXT NOT NULL DEFAULT 'upsert'");

  database = withWebPersistence(db);
  return database;
}

async function ensureColumn(db: SQLite.SQLiteDatabase, table: string, column: string, definition: string): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (columns.some((existing) => existing.name === column)) return;
  await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

type ProfileRow = {
  id: string;
  display_name: string | null;
  age_years: number | null;
  sex: SexForEstimate | null;
  height_cm: number | null;
  weight_kg: number | null;
  fitness_level: FitnessLevel | null;
  activity_level: ActivityLevel | null;
  goal: BodyGoal | null;
  unit_system: UnitSystem;
  workout_preference: WorkoutPreference | null;
  dietary_json: string;
  sleep_target_minutes: number | null;
  hydration_target_ml: number | null;
  step_goal: number | null;
  onboarding_completed_at: string | null;
};

function mapProfile(row: ProfileRow): LocalProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    ageYears: row.age_years,
    sex: row.sex,
    heightCm: row.height_cm,
    weightKg: row.weight_kg,
    fitnessLevel: row.fitness_level,
    activityLevel: row.activity_level,
    goal: row.goal,
    unitSystem: row.unit_system,
    workoutPreference: row.workout_preference,
    dietary: JSON.parse(row.dietary_json) as DietaryPreference[],
    sleepTargetMinutes: row.sleep_target_minutes,
    hydrationTargetMl: row.hydration_target_ml,
    stepGoal: row.step_goal,
    onboardingCompletedAt: row.onboarding_completed_at,
  };
}

export async function readProfile(): Promise<LocalProfile | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ProfileRow>("SELECT * FROM profile LIMIT 1");
  return row ? mapProfile(row) : null;
}

export async function saveProfile(profile: LocalProfile): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO profile (
      id, display_name, age_years, sex, height_cm, weight_kg, fitness_level, activity_level, goal,
      unit_system, workout_preference, dietary_json, sleep_target_minutes, hydration_target_ml, step_goal,
      onboarding_completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      age_years = excluded.age_years,
      sex = excluded.sex,
      height_cm = excluded.height_cm,
      weight_kg = excluded.weight_kg,
      fitness_level = excluded.fitness_level,
      activity_level = excluded.activity_level,
      goal = excluded.goal,
      unit_system = excluded.unit_system,
      workout_preference = excluded.workout_preference,
      dietary_json = excluded.dietary_json,
      sleep_target_minutes = excluded.sleep_target_minutes,
      hydration_target_ml = excluded.hydration_target_ml,
      step_goal = excluded.step_goal,
      onboarding_completed_at = excluded.onboarding_completed_at`,
    profile.id,
    profile.displayName,
    profile.ageYears,
    profile.sex,
    profile.heightCm,
    profile.weightKg,
    profile.fitnessLevel,
    profile.activityLevel,
    profile.goal,
    profile.unitSystem,
    profile.workoutPreference,
    JSON.stringify(profile.dietary),
    profile.sleepTargetMinutes,
    profile.hydrationTargetMl,
    profile.stepGoal,
    profile.onboardingCompletedAt,
  );
  await enqueue("profile", profile.id);
}

export async function readPreference(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM preferences WHERE key = ?", key);
  return row?.value ?? null;
}

export async function writePreference(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
}

export type OutboxRow = {
  id: string;
  entity: string;
  entity_id: string;
  operation: "upsert" | "delete";
  created_at: string;
  synced_at: string | null;
};

const outboxListeners = new Set<() => void>();

/** Notified after every successful enqueue. The sync worker uses this to schedule a debounced attempt without db.ts importing it back (no circular dependency). */
export function onOutboxChange(listener: () => void): () => void {
  outboxListeners.add(listener);
  return () => outboxListeners.delete(listener);
}

export async function enqueue(
  entity: string,
  entityId: string,
  operation: "upsert" | "delete" = "upsert",
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "INSERT INTO sync_outbox (id, entity, entity_id, operation, created_at, synced_at) VALUES (?, ?, ?, ?, ?, NULL)",
    `${entity}:${entityId}:${operation}:${Date.now()}`,
    entity,
    entityId,
    operation,
    new Date().toISOString(),
  );
  for (const listener of outboxListeners) listener();
}

export async function listPendingOutbox(): Promise<OutboxRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    entity: string;
    entity_id: string;
    operation: string | null;
    created_at: string;
    synced_at: string | null;
  }>("SELECT * FROM sync_outbox WHERE synced_at IS NULL ORDER BY created_at ASC");
  return rows.map((row) => ({
    ...row,
    operation: row.operation === "delete" ? "delete" : "upsert",
  }));
}

/** Deletes a completed outbox row. This only ever removes sync bookkeeping, never the user's actual local record. */
export async function clearOutboxItem(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM sync_outbox WHERE id = ?", id);
}

export async function deleteAllLocalData(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    DELETE FROM profile;
    DELETE FROM preferences;
    DELETE FROM product_events;
    DELETE FROM nutrition_logs;
    DELETE FROM custom_foods;
    DELETE FROM hydration_logs;
    DELETE FROM workout_sessions;
    DELETE FROM workout_sets;
    DELETE FROM sleep_sessions;
    DELETE FROM activity_sessions;
    DELETE FROM activity_points;
    DELETE FROM sound_favorites;
    DELETE FROM sync_outbox;
  `);
}
