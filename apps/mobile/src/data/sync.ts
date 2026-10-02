/**
 * Local-first outbox sync worker.
 *
 * Local SQLite stays the source of truth at all times. This module reads local rows and
 * pushes upserts (or remote deletes for food/water) to Supabase — it never rewrites local
 * feature data as part of a sync pass. When there is no session, or no network, or Supabase
 * is not configured, every local feature keeps working exactly as it does today; this file
 * just quietly has nothing to do.
 *
 * The actual decisions (what counts as an error worth stopping for, what an outbox row's
 * remote payload looks like, when a pass is allowed to start) live in
 * @vitacore/domain's sync.ts, where they can be unit-tested without a device, a database,
 * or a network connection. This file is the thin, unverified-in-this-sandbox shell that
 * wires those decisions to SQLite and the Supabase client.
 */
import { useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildActivityPointPayload,
  buildActivitySessionPayload,
  buildHydrationLogPayload,
  buildNutritionLogPayload,
  buildProfilePayload,
  buildSleepSessionPayload,
  buildWorkoutSessionPayload,
  buildWorkoutSetPayload,
  canStartSync,
  classifySupabaseError,
  decideAccountSync,
  dedupeOutboxItems,
  deviceTimeZone,
  isSupportedEntity,
  nextSyncStatus,
  outboxIdsToClear,
  shouldAbortBatch,
  shouldMarkSynced,
  isDeletableEntity,
  type LocalActivityPointRow,
  type LocalActivitySessionRow,
  type LocalHydrationLogRow,
  type LocalNutritionLogRow,
  type LocalProfileRow,
  type LocalSleepSessionRow,
  type LocalWorkoutSessionRow,
  type LocalWorkoutSetRow,
  type OutboxItem,
  type SyncOutcome,
  type SyncStatus,
} from "@vitacore/domain";
import { getSupabase, supabaseConfigStatus } from "@/auth/supabase";
import {
  clearOutboxItem,
  getDatabase,
  listPendingOutbox,
  onOutboxChange,
  readSyncOwnerUserId,
  writeSyncOwnerUserId,
  type OutboxRow,
} from "./db";

// --- Status store (no extra state-management dependency; React 19's useSyncExternalStore is enough) ---

type Listener = () => void;
let status: SyncStatus = "idle";
let lastMessage: string | null = null;
/** One-shot consent for binding unbound guest/local data to the current session user. */
let claimConfirmedForSession = false;
const listeners = new Set<Listener>();

function setStatus(next: SyncStatus, message: string | null = null): void {
  status = next;
  lastMessage = message;
  for (const listener of listeners) listener();
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function getSyncMessage(): string | null {
  return lastMessage;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSyncStatus(): { status: SyncStatus; message: string | null } {
  const current = useSyncExternalStore(subscribe, getSyncStatus, getSyncStatus);
  const message = useSyncExternalStore(subscribe, getSyncMessage, getSyncMessage);
  return { status: current, message };
}

// --- Per-entity upload ---

async function uploadOne(client: SupabaseClient, userId: string, item: OutboxItem): Promise<SyncOutcome> {
  if (!isSupportedEntity(item.entity)) {
    return { kind: "unsupported_entity", itemId: item.id, entity: item.entity };
  }
  const db = await getDatabase();

  try {
    if (item.operation === "delete") {
      if (!isDeletableEntity(item.entity)) {
        return { kind: "unsupported_entity", itemId: item.id, entity: item.entity };
      }
      const { error } = await client.from(item.entity).delete().eq("user_id", userId).eq("client_id", item.entityId);
      if (error) throw error;
      return { kind: "synced", itemId: item.id };
    }

    switch (item.entity) {
      case "profile": {
        const row = await db.getFirstAsync<LocalProfileRow>("SELECT * FROM profile WHERE id = ?", item.entityId);
        if (!row) return { kind: "skipped_missing_local_row", itemId: item.id };
        const { error } = await client.from("profiles").upsert(buildProfilePayload(row, userId, deviceTimeZone()), { onConflict: "id" });
        if (error) throw error;
        return { kind: "synced", itemId: item.id };
      }
      case "nutrition_logs": {
        const row = await db.getFirstAsync<LocalNutritionLogRow>("SELECT * FROM nutrition_logs WHERE id = ?", item.entityId);
        if (!row) return { kind: "skipped_missing_local_row", itemId: item.id };
        const { error } = await client
          .from("nutrition_logs")
          .upsert(buildNutritionLogPayload(row, userId), { onConflict: "user_id,client_id" });
        if (error) throw error;
        return { kind: "synced", itemId: item.id };
      }
      case "hydration_logs": {
        const row = await db.getFirstAsync<LocalHydrationLogRow>("SELECT * FROM hydration_logs WHERE id = ?", item.entityId);
        if (!row) return { kind: "skipped_missing_local_row", itemId: item.id };
        const { error } = await client
          .from("hydration_logs")
          .upsert(buildHydrationLogPayload(row, userId), { onConflict: "user_id,client_id" });
        if (error) throw error;
        return { kind: "synced", itemId: item.id };
      }
      case "sleep_sessions": {
        const row = await db.getFirstAsync<LocalSleepSessionRow>("SELECT * FROM sleep_sessions WHERE id = ?", item.entityId);
        if (!row) return { kind: "skipped_missing_local_row", itemId: item.id };
        const { error } = await client
          .from("sleep_sessions")
          .upsert(buildSleepSessionPayload(row, userId), { onConflict: "user_id,client_id" });
        if (error) throw error;
        return { kind: "synced", itemId: item.id };
      }
      case "workout_sessions": {
        const row = await db.getFirstAsync<LocalWorkoutSessionRow>(
          "SELECT id, started_at, ended_at, timezone FROM workout_sessions WHERE id = ?",
          item.entityId,
        );
        if (!row) return { kind: "skipped_missing_local_row", itemId: item.id };
        const { error: sessionError } = await client
          .from("workout_sessions")
          .upsert(buildWorkoutSessionPayload(row, userId), { onConflict: "user_id,client_id" });
        if (sessionError) throw sessionError;

        const sets = await db.getAllAsync<LocalWorkoutSetRow>(
          "SELECT id, session_id, exercise_id, exercise_name, set_index, reps, weight_kg, completed_at FROM workout_sets WHERE session_id = ?",
          item.entityId,
        );
        if (sets.length > 0) {
          const { error: setsError } = await client
            .from("workout_sets")
            .upsert(sets.map((set) => buildWorkoutSetPayload(set, userId)), { onConflict: "user_id,client_id" });
          if (setsError) throw setsError;
        }
        return { kind: "synced", itemId: item.id };
      }
      case "activity_sessions": {
        const row = await db.getFirstAsync<LocalActivitySessionRow>(
          "SELECT id, kind, started_at, ended_at, timezone, distance_meters, moving_seconds FROM activity_sessions WHERE id = ?",
          item.entityId,
        );
        if (!row) return { kind: "skipped_missing_local_row", itemId: item.id };
        const { error: sessionError } = await client
          .from("activity_sessions")
          .upsert(buildActivitySessionPayload(row, userId), { onConflict: "user_id,client_id" });
        if (sessionError) throw sessionError;

        const points = await db.getAllAsync<LocalActivityPointRow>(
          "SELECT id, session_id, latitude, longitude, altitude_meters, recorded_at_ms FROM activity_points WHERE session_id = ?",
          item.entityId,
        );
        const pointPayloads = points.map((point) => buildActivityPointPayload(point, userId));
        if (pointPayloads.length > 0) {
          const { error: pointsError } = await client
            .from("activity_points")
            .upsert(pointPayloads, { onConflict: "user_id,client_id" });
          if (pointsError) throw pointsError;
        }
        return { kind: "synced", itemId: item.id };
      }
      default:
        // isSupportedEntity already guarded this; kept only so TypeScript sees an exhaustive switch.
        return { kind: "unsupported_entity", itemId: item.id, entity: item.entity };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const asSupabaseError = typeof error === "object" && error !== null ? (error as { code?: string; status?: number }) : {};
    const kind = classifySupabaseError({ message, code: asSupabaseError.code, status: asSupabaseError.status });
    if (kind === "auth") return { kind: "auth_error", itemId: item.id, message };
    if (kind === "network") return { kind: "network_error", itemId: item.id, message };
    return { kind: "row_error", itemId: item.id, message };
  }
}

// --- Batch runner ---

let running = false;

/**
 * Runs one sync pass: pending outbox rows, oldest first, deduped to one attempt per
 * (entity, entityId). Stops early on the first auth/network failure so the rest of the
 * queue is left untouched for the next pass rather than failing every remaining row one
 * at a time. A row-level failure (bad payload, etc.) is skipped and the rest of the batch
 * still runs.
 */
export async function runSync(): Promise<void> {
  if (!canStartSync(status)) return; // concurrency guard: a pass is already in flight
  running = true;
  setStatus("syncing");

  try {
    if (supabaseConfigStatus() !== "ready") {
      setStatus("idle");
      return;
    }
    const client = getSupabase();
    if (!client) {
      setStatus("idle");
      return;
    }
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) {
      setStatus("auth_required", sessionError.message);
      return;
    }
    const session = sessionData.session;
    if (!session) {
      setStatus(nextSyncStatus([], false));
      return;
    }
    const userId = session.user.id;

    const ownerId = await readSyncOwnerUserId();
    const binding = ownerId ? ({ status: "bound", userId: ownerId } as const) : ({ status: "unbound" } as const);
    const decision = decideAccountSync(binding, userId, { claimConfirmed: claimConfirmedForSession });
    if (decision.action === "skip_signed_out") {
      setStatus("idle");
      return;
    }
    if (decision.action === "block_mismatch") {
      setStatus(
        "error",
        "Local data on this device belongs to a different account. Sign in as that account to sync, or delete local data from Profile first.",
      );
      return;
    }
    if (decision.action === "await_claim_confirmation") {
      setStatus(
        "claim_required",
        "This device has local data. Signing in will associate this local data with this account. Confirm on the Account screen to continue.",
      );
      return;
    }
    if (decision.action === "claim_and_sync") {
      await writeSyncOwnerUserId(decision.bindUserId);
      claimConfirmedForSession = false;
    }

    const pendingRows = await listPendingOutbox();
    const items: OutboxItem[] = pendingRows.map((row: OutboxRow) => ({
      id: row.id,
      entity: row.entity,
      entityId: row.entity_id,
      createdAt: row.created_at,
      operation: row.operation,
    }));
    const deduped = dedupeOutboxItems(items);

    const outcomes: SyncOutcome[] = [];
    for (const item of deduped) {
      const outcome = await uploadOne(client, userId, item);
      outcomes.push(outcome);
      if (shouldMarkSynced(outcome)) {
        for (const id of outboxIdsToClear(item, items)) {
          await clearOutboxItem(id);
        }
      }
      if (shouldAbortBatch(outcome)) break;
    }

    setStatus(
      nextSyncStatus(outcomes, true),
      outcomes.find((outcome) => outcome.kind === "row_error" || outcome.kind === "auth_error" || outcome.kind === "network_error")
        ?.message,
    );
  } catch (error) {
    setStatus("error", error instanceof Error ? error.message : String(error));
  } finally {
    running = false;
  }
}

// --- Triggers: sign-in, new local mutations, and a light periodic safety net ---

let debounceHandle: ReturnType<typeof setTimeout> | null = null;
let periodicHandle: ReturnType<typeof setInterval> | null = null;
let initialized = false;

function kick(delayMs: number): void {
  if (debounceHandle) clearTimeout(debounceHandle);
  debounceHandle = setTimeout(() => {
    debounceHandle = null;
    void runSync();
  }, delayMs);
}

/**
 * Call once from the app root. Wires: an attempt shortly after any local mutation
 * (debounced so a burst of writes only triggers one pass), an attempt on sign-in, and a
 * slow (60s) periodic retry that only ever does anything if there is still pending work —
 * this is the "retry/backoff" behavior, kept deliberately simple rather than an
 * exponential-backoff scheduler: a fixed, infrequent interval that is a no-op whenever the
 * queue is already empty or a pass is already running.
 */
export function initSync(): () => void {
  if (initialized) return () => undefined;
  initialized = true;

  const unsubscribeOutbox = onOutboxChange(() => kick(2000));

  let unsubscribeAuth: (() => void) | null = null;
  const client = getSupabase();
  if (client) {
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") kick(0);
      if (event === "SIGNED_OUT") {
        claimConfirmedForSession = false;
        setStatus("idle");
      }
    });
    unsubscribeAuth = () => data.subscription.unsubscribe();
  }

  periodicHandle = setInterval(() => void runSync(), 60_000);
  kick(0); // pick up any pending work already queued from a previous session

  return () => {
    initialized = false;
    unsubscribeOutbox();
    unsubscribeAuth?.();
    if (periodicHandle) clearInterval(periodicHandle);
    if (debounceHandle) clearTimeout(debounceHandle);
  };
}

/** For the manual "Sync now" affordance. Same worker, same guards — just triggered immediately instead of waiting on a timer. */
export function syncNow(): void {
  void runSync();
}

/**
 * Explicit user confirmation that unbound local/guest data on this device may be
 * associated with the currently signed-in account. Does not weaken mismatch blocking
 * for an already-bound different user.
 */
export function confirmLocalDataClaim(): void {
  claimConfirmedForSession = true;
  void runSync();
}

export function isSyncRunning(): boolean {
  return running;
}
