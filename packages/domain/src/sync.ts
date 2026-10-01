/**
 * Pure decision logic for the local-first outbox sync worker. Everything here is
 * framework-free on purpose: no SQLite, no Supabase client, no network. The mobile app
 * (apps/mobile/src/data/sync.ts) is a thin shell that calls these functions and does the
 * actual I/O. Keeping the decisions here is what makes them testable in this package's
 * existing Vitest suite, since apps/mobile has no test runner configured.
 */

export const SYNCABLE_ENTITIES = [
  "profile",
  "nutrition_logs",
  "hydration_logs",
  "sleep_sessions",
  "workout_sessions",
  "activity_sessions",
] as const;

export type OutboxEntity = (typeof SYNCABLE_ENTITIES)[number];

const SYNCABLE_ENTITY_SET = new Set<string>(SYNCABLE_ENTITIES);

/** True for an entity name the worker knows how to upload. Anything else is surfaced as an error, never silently dropped. */
export function isSupportedEntity(entity: string): entity is OutboxEntity {
  return SYNCABLE_ENTITY_SET.has(entity);
}

export type OutboxItem = {
  id: string;
  entity: string;
  entityId: string;
  createdAt: string;
};

/**
 * Keeps only the newest queued item per (entity, entityId). Re-saving the same local
 * record (for example editing the profile five times before the first sync) enqueues
 * five outbox rows, but uploading the current row once already captures all five edits —
 * the extra uploads would be harmless (upserts are idempotent) but wasteful.
 */
export function dedupeOutboxItems(items: OutboxItem[]): OutboxItem[] {
  const latestByKey = new Map<string, OutboxItem>();
  for (const item of items) {
    const key = `${item.entity}:${item.entityId}`;
    const existing = latestByKey.get(key);
    if (!existing || item.createdAt >= existing.createdAt) latestByKey.set(key, item);
  }
  return items.filter((item) => latestByKey.get(`${item.entity}:${item.entityId}`) === item);
}

export type SyncOutcome =
  | { kind: "synced"; itemId: string }
  /** The local row was gone by the time the worker got to it. Nothing to upload, nothing lost. */
  | { kind: "skipped_missing_local_row"; itemId: string }
  /** This one record failed (bad payload, constraint, etc). Leave it queued, keep going. */
  | { kind: "row_error"; itemId: string; message: string }
  /** Session invalid/expired. Stop the whole batch rather than fail every remaining row one at a time. */
  | { kind: "auth_error"; itemId: string; message: string }
  /** No connectivity. Stop the whole batch for the same reason. */
  | { kind: "network_error"; itemId: string; message: string }
  /** An outbox row references an entity the worker does not (yet) know how to upload. Leave it queued, keep going. */
  | { kind: "unsupported_entity"; itemId: string; entity: string };

/** A batch-ending outcome means "stop processing further rows this pass," not "discard the queue." */
export function shouldAbortBatch(outcome: SyncOutcome): boolean {
  return outcome.kind === "auth_error" || outcome.kind === "network_error";
}

/** Only a real server acknowledgement (or confirming there was nothing to send) clears an outbox row. */
export function shouldMarkSynced(outcome: SyncOutcome): boolean {
  return outcome.kind === "synced" || outcome.kind === "skipped_missing_local_row";
}

export type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "auth_required" | "error";

/**
 * Rolls a batch of per-item outcomes up into one status for the UI. `hadSession` is
 * checked first: syncing while signed out is not an error state, it is the normal
 * local-only mode.
 */
export function nextSyncStatus(outcomes: SyncOutcome[], hadSession: boolean): SyncStatus {
  if (!hadSession) return "idle";
  if (outcomes.some((outcome) => outcome.kind === "auth_error")) return "auth_required";
  if (outcomes.some((outcome) => outcome.kind === "network_error")) return "offline";
  if (outcomes.some((outcome) => outcome.kind === "row_error" || outcome.kind === "unsupported_entity")) return "error";
  return "synced";
}

/** A sync pass may only start from a non-syncing status. This is the whole concurrency guard, expressed as a pure check. */
export function canStartSync(status: SyncStatus): boolean {
  return status !== "syncing";
}

export type SupabaseLikeError = { message?: string | null; code?: string | null; status?: number | null } | null | undefined;

/**
 * Best-effort classification of a Supabase/PostgREST error into a batch-aborting reason
 * or a per-row failure. This has not been checked against real Supabase error payloads in
 * this environment (no network access) — the patterns below follow PostgREST/GoTrue's
 * documented shapes (PGRST301 for JWT issues, HTTP 401, and common "network request
 * failed" fetch error text) but should be re-checked once this runs against a live
 * project.
 */
export function classifySupabaseError(error: SupabaseLikeError): "auth" | "network" | "other" {
  if (!error) return "other";
  if (error.code === "PGRST301" || error.status === 401) return "auth";
  const message = error.message ?? "";
  if (/jwt|token expired|invalid.*refresh|not authenticated/i.test(message)) return "auth";
  if (/network|fetch|timeout|offline|enotfound|failed to fetch/i.test(message)) return "network";
  return "other";
}

// --- Payload mapping -------------------------------------------------------------
// Local SQLite rows use the same column names as the Supabase migration on purpose, so
// each of these is closer to "add user_id and rename the primary key" than a real
// transform. Fields the Supabase migration does not have (workout title, set duration/
// RPE) are intentionally left out rather than invented as new columns.

export type LocalProfileRow = {
  id: string;
  display_name: string | null;
  age_years: number | null;
  sex: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  fitness_level: string | null;
  activity_level: string | null;
  goal: string | null;
  unit_system: string;
  workout_preference: string | null;
  dietary_json: string;
  sleep_target_minutes: number | null;
  hydration_target_ml: number | null;
  step_goal: number | null;
  onboarding_completed_at: string | null;
};

/**
 * The remote `profiles.id` is the auth user id, not the local row id — a profile is a singleton per account.
 * `timezone` is an existing `public.profiles` column. The coach uses it to decide which calendar day
 * "today" is. The device zone is passed in at upload time because the local profile row does not store one.
 */
export function buildProfilePayload(row: LocalProfileRow, userId: string, timezone: string) {
  return {
    id: userId,
    display_name: row.display_name,
    age_years: row.age_years,
    sex: row.sex,
    height_cm: row.height_cm,
    weight_kg: row.weight_kg,
    fitness_level: row.fitness_level,
    activity_level: row.activity_level,
    goal: row.goal,
    unit_system: row.unit_system,
    workout_preference: row.workout_preference,
    dietary: JSON.parse(row.dietary_json) as string[],
    sleep_target_minutes: row.sleep_target_minutes,
    hydration_target_ml: row.hydration_target_ml,
    step_goal: row.step_goal,
    onboarding_completed_at: row.onboarding_completed_at,
    timezone,
  };
}

/**
 * After one outbox item is accepted (or the local row is already gone), every pending row for the
 * same record that is not newer than the one just handled can be dropped. Re-saving a record
 * enqueues several rows; uploading the current row once already includes those edits.
 */
export function outboxIdsToClear(processed: OutboxItem, pending: readonly OutboxItem[]): string[] {
  return pending
    .filter(
      (item) =>
        item.entity === processed.entity &&
        item.entityId === processed.entityId &&
        item.createdAt <= processed.createdAt,
    )
    .map((item) => item.id);
}

export type LocalNutritionLogRow = {
  id: string;
  day: string;
  timezone: string;
  meal: string;
  food_name: string;
  source: string;
  source_id: string | null;
  servings: number;
  kcal: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
  logged_at: string;
};

export function buildNutritionLogPayload(row: LocalNutritionLogRow, userId: string) {
  return {
    user_id: userId,
    client_id: row.id,
    day: row.day,
    timezone: row.timezone,
    meal: row.meal,
    food_name: row.food_name,
    source: row.source,
    source_id: row.source_id,
    servings: row.servings,
    kcal: row.kcal,
    protein_g: row.protein_g,
    carbs_g: row.carbs_g,
    fat_g: row.fat_g,
    fiber_g: row.fiber_g,
    sugar_g: row.sugar_g,
    sodium_mg: row.sodium_mg,
    logged_at: row.logged_at,
  };
}

export type LocalHydrationLogRow = {
  id: string;
  day: string;
  timezone: string;
  ml: number;
  logged_at: string;
};

export function buildHydrationLogPayload(row: LocalHydrationLogRow, userId: string) {
  return {
    user_id: userId,
    client_id: row.id,
    day: row.day,
    timezone: row.timezone,
    ml: row.ml,
    logged_at: row.logged_at,
  };
}

export type LocalSleepSessionRow = {
  id: string;
  day: string;
  timezone: string;
  asleep_start: string;
  asleep_end: string;
  source: string;
};

export function buildSleepSessionPayload(row: LocalSleepSessionRow, userId: string) {
  return {
    user_id: userId,
    client_id: row.id,
    day: row.day,
    timezone: row.timezone,
    asleep_start: row.asleep_start,
    asleep_end: row.asleep_end,
    source: row.source,
  };
}

export type LocalWorkoutSessionRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  timezone: string;
};

/** `title` exists locally but has no column on `public.workout_sessions` yet, so it is not sent. */
export function buildWorkoutSessionPayload(row: LocalWorkoutSessionRow, userId: string) {
  return {
    user_id: userId,
    client_id: row.id,
    started_at: row.started_at,
    ended_at: row.ended_at,
    timezone: row.timezone,
  };
}

export type LocalWorkoutSetRow = {
  id: string;
  session_id: string;
  exercise_id: string;
  exercise_name: string;
  set_index: number;
  reps: number | null;
  weight_kg: number | null;
  completed_at: string;
};

/** `duration_seconds` and `rpe` exist locally but have no column on `public.workout_sets` yet, so they are not sent. */
export function buildWorkoutSetPayload(row: LocalWorkoutSetRow, userId: string) {
  return {
    user_id: userId,
    client_id: row.id,
    session_client_id: row.session_id,
    exercise_id: row.exercise_id,
    exercise_name: row.exercise_name,
    set_index: row.set_index,
    reps: row.reps,
    weight_kg: row.weight_kg,
    completed_at: row.completed_at,
  };
}

export type LocalActivitySessionRow = {
  id: string;
  kind: string;
  started_at: string;
  ended_at: string | null;
  timezone: string;
  distance_meters: number;
  moving_seconds: number;
};

export function buildActivitySessionPayload(row: LocalActivitySessionRow, userId: string) {
  return {
    user_id: userId,
    client_id: row.id,
    kind: row.kind,
    started_at: row.started_at,
    ended_at: row.ended_at,
    timezone: row.timezone,
    distance_meters: row.distance_meters,
    moving_seconds: row.moving_seconds,
  };
}

export type LocalActivityPointRow = {
  id: string;
  session_id: string;
  latitude: number;
  longitude: number;
  altitude_meters: number | null;
  recorded_at_ms: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `public.activity_points` has no `client_id`/unique constraint of its own (unlike every
 * other syncable table), so the only way to make re-uploading a route idempotent is to
 * set its primary key ourselves and upsert on `id`. That only works when the local point
 * id is already a real UUID. The app's id generator (`createId()`) uses
 * `crypto.randomUUID()` whenever it is available, which it is on this Expo/RN version, so
 * this should hold in practice — but a point whose local id is not UUID-shaped is skipped
 * here rather than sent with a value the column would reject, since there is no spare
 * column to carry a non-UUID client id.
 */
export function buildActivityPointPayload(row: LocalActivityPointRow, userId: string): Record<string, unknown> | null {
  if (!UUID_PATTERN.test(row.id)) return null;
  return {
    id: row.id,
    user_id: userId,
    session_client_id: row.session_id,
    latitude: row.latitude,
    longitude: row.longitude,
    altitude_meters: row.altitude_meters,
    recorded_at: new Date(row.recorded_at_ms).toISOString(),
  };
}
