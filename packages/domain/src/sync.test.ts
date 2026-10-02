import { describe, expect, it } from "vitest";
import {
  buildActivityPointPayload,
  buildNutritionLogPayload,
  buildProfilePayload,
  canStartSync,
  classifySupabaseError,
  dedupeOutboxItems,
  isSupportedEntity,
  nextSyncStatus,
  outboxIdsToClear,
  shouldAbortBatch,
  shouldMarkSynced,
  type OutboxItem,
  type SyncOutcome,
} from "./sync";

describe("isSupportedEntity", () => {
  it("accepts every entity the app actually enqueues", () => {
    for (const entity of ["profile", "nutrition_logs", "hydration_logs", "sleep_sessions", "workout_sessions", "activity_sessions"]) {
      expect(isSupportedEntity(entity)).toBe(true);
    }
  });

  it("rejects an unknown entity so it is surfaced as an error rather than silently dropped", () => {
    expect(isSupportedEntity("some_future_table")).toBe(false);
  });
});

describe("successful upload", () => {
  it("rolls an all-synced batch up to status synced", () => {
    const outcomes: SyncOutcome[] = [{ kind: "synced", itemId: "a" }, { kind: "synced", itemId: "b" }];
    expect(nextSyncStatus(outcomes, true)).toBe("synced");
    expect(outcomes.every(shouldMarkSynced)).toBe(true);
  });

  it("an empty pending queue is also status synced (nothing owed)", () => {
    expect(nextSyncStatus([], true)).toBe("synced");
  });
});

describe("failed upload remains queued", () => {
  it("a row_error outcome is not marked synced", () => {
    const outcome: SyncOutcome = { kind: "row_error", itemId: "a", message: "constraint violation" };
    expect(shouldMarkSynced(outcome)).toBe(false);
  });

  it("an unsupported entity is not marked synced, and is not batch-aborting either", () => {
    const outcome: SyncOutcome = { kind: "unsupported_entity", itemId: "a", entity: "mystery_table" };
    expect(shouldMarkSynced(outcome)).toBe(false);
    expect(shouldAbortBatch(outcome)).toBe(false);
  });
});

describe("retry succeeds", () => {
  it("a failed-then-retried item ends synced once the second attempt returns a synced outcome", () => {
    const firstAttempt: SyncOutcome = { kind: "network_error", itemId: "a", message: "network request failed" };
    expect(shouldMarkSynced(firstAttempt)).toBe(false);
    expect(shouldAbortBatch(firstAttempt)).toBe(true);

    const retryAttempt: SyncOutcome = { kind: "synced", itemId: "a" };
    expect(shouldMarkSynced(retryAttempt)).toBe(true);
  });
});

describe("duplicate / idempotent upload", () => {
  it("building the same local row's payload twice yields an identical, deterministic payload", () => {
    const row = {
      id: "row-1",
      day: "2026-09-28",
      timezone: "UTC",
      meal: "lunch",
      food_name: "Chicken bowl",
      source: "manual",
      source_id: null,
      servings: 1,
      kcal: 550,
      protein_g: 40,
      carbs_g: 50,
      fat_g: 15,
      fiber_g: null,
      sugar_g: null,
      sodium_mg: null,
      logged_at: "2026-09-28T12:00:00.000Z",
      notes: "extra salt",
    };
    const first = buildNutritionLogPayload(row, "user-1");
    const second = buildNutritionLogPayload(row, "user-1");
    expect(first).toEqual(second);
    expect(first.client_id).toBe("row-1");
    expect(first.user_id).toBe("user-1");
    expect(first.notes).toBe("extra salt");
  });

  it("activity points always carry client_id; UUID local ids also set remote id", () => {
    const base = {
      session_id: "session-1",
      latitude: 1,
      longitude: 2,
      altitude_meters: null,
      recorded_at_ms: 1_700_000_000_000,
    };
    const withUuid = buildActivityPointPayload({ ...base, id: "3fa85f64-5717-4562-b3fc-2c963f66afa6" }, "user-1");
    expect(withUuid.client_id).toBe("3fa85f64-5717-4562-b3fc-2c963f66afa6");
    expect(withUuid.id).toBe("3fa85f64-5717-4562-b3fc-2c963f66afa6");

    const withFallbackId = buildActivityPointPayload({ ...base, id: "id_1700000000000_abc123" }, "user-1");
    expect(withFallbackId.client_id).toBe("id_1700000000000_abc123");
    expect(withFallbackId.id).toBeUndefined();
  });

  it("sends the device timezone on the existing profiles.timezone column", () => {
    const row = {
      id: "local-profile-1",
      display_name: "Alex",
      age_years: 30,
      sex: "unspecified" as const,
      height_cm: 170,
      weight_kg: 70,
      fitness_level: null,
      activity_level: null,
      goal: null,
      unit_system: "metric",
      workout_preference: null,
      dietary_json: "[]",
      sleep_target_minutes: null,
      hydration_target_ml: null,
      step_goal: null,
      onboarding_completed_at: null,
    };
    const payload = buildProfilePayload(row, "auth-user-1", "America/New_York");
    expect(payload.id).toBe("auth-user-1"); // remote profiles.id is the auth user id, not the local row id
    expect(payload.timezone).toBe("America/New_York");
  });
});

describe("signed-out state", () => {
  it("with no session, status is idle rather than an error, even with outcomes present", () => {
    expect(nextSyncStatus([{ kind: "synced", itemId: "a" }], false)).toBe("idle");
  });
});

describe("multiple queued records", () => {
  it("dedupes repeated edits of the same local record down to the newest queued item", () => {
    const items: OutboxItem[] = [
      { id: "o1", entity: "profile", entityId: "p1", createdAt: "2026-09-28T10:00:00.000Z", operation: "upsert" },
      { id: "o2", entity: "profile", entityId: "p1", createdAt: "2026-09-28T10:05:00.000Z", operation: "upsert" },
      { id: "o3", entity: "nutrition_logs", entityId: "n1", createdAt: "2026-09-28T10:01:00.000Z", operation: "upsert" },
    ];
    const deduped = dedupeOutboxItems(items);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((item) => item.entity === "profile")?.id).toBe("o2");
    expect(deduped.find((item) => item.entity === "nutrition_logs")?.id).toBe("o3");
  });

  it("a later delete replaces an earlier upsert for the same record", () => {
    const items: OutboxItem[] = [
      { id: "o1", entity: "nutrition_logs", entityId: "n1", createdAt: "2026-09-28T10:00:00.000Z", operation: "upsert" },
      { id: "o2", entity: "nutrition_logs", entityId: "n1", createdAt: "2026-09-28T10:05:00.000Z", operation: "delete" },
    ];
    const deduped = dedupeOutboxItems(items);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.operation).toBe("delete");
  });

  it("clears older queued copies of a record once the newest copy is accepted", () => {
    const items: OutboxItem[] = [
      { id: "o1", entity: "profile", entityId: "p1", createdAt: "2026-09-28T10:00:00.000Z", operation: "upsert" },
      { id: "o2", entity: "profile", entityId: "p1", createdAt: "2026-09-28T10:05:00.000Z", operation: "upsert" },
      { id: "o3", entity: "nutrition_logs", entityId: "n1", createdAt: "2026-09-28T10:01:00.000Z", operation: "upsert" },
      { id: "o4", entity: "profile", entityId: "p1", createdAt: "2026-09-28T10:06:00.000Z", operation: "upsert" },
    ];
    const processed = items[1]!;
    expect(outboxIdsToClear(processed, items).sort()).toEqual(["o1", "o2"]);
  });

  it("leaves distinct records untouched and in their original relative order", () => {
    const items: OutboxItem[] = [
      { id: "o1", entity: "hydration_logs", entityId: "h1", createdAt: "2026-09-28T10:00:00.000Z", operation: "upsert" },
      { id: "o2", entity: "hydration_logs", entityId: "h2", createdAt: "2026-09-28T10:01:00.000Z", operation: "upsert" },
    ];
    expect(dedupeOutboxItems(items)).toEqual(items);
  });
});

describe("partial failure", () => {
  it("one bad row does not flip already-synced items back to pending, but does flip the overall status to error", () => {
    const outcomes: SyncOutcome[] = [
      { kind: "synced", itemId: "a" },
      { kind: "row_error", itemId: "b", message: "check constraint" },
      { kind: "synced", itemId: "c" },
    ];
    expect(nextSyncStatus(outcomes, true)).toBe("error");
    expect(outcomes.filter(shouldMarkSynced).map((outcome) => outcome.itemId)).toEqual(["a", "c"]);
  });

  it("a row-level error does not abort the batch, so remaining items still get processed", () => {
    const outcome: SyncOutcome = { kind: "row_error", itemId: "b", message: "bad payload" };
    expect(shouldAbortBatch(outcome)).toBe(false);
  });

  it("an auth or network error does abort the batch, leaving the rest of the queue untouched", () => {
    expect(shouldAbortBatch({ kind: "auth_error", itemId: "x", message: "jwt expired" })).toBe(true);
    expect(shouldAbortBatch({ kind: "network_error", itemId: "x", message: "network request failed" })).toBe(true);
  });
});

describe("concurrent sync protection", () => {
  it("refuses to start a new pass while one is already syncing", () => {
    expect(canStartSync("syncing")).toBe(false);
  });

  it("allows starting from every other status", () => {
    for (const status of ["idle", "synced", "offline", "auth_required", "error"] as const) {
      expect(canStartSync(status)).toBe(true);
    }
  });
});

describe("classifySupabaseError", () => {
  it("recognizes common auth failure shapes", () => {
    expect(classifySupabaseError({ code: "PGRST301" })).toBe("auth");
    expect(classifySupabaseError({ status: 401 })).toBe("auth");
    expect(classifySupabaseError({ message: "JWT expired" })).toBe("auth");
  });

  it("recognizes common network failure shapes", () => {
    expect(classifySupabaseError({ message: "TypeError: Network request failed" })).toBe("network");
    expect(classifySupabaseError({ message: "fetch failed" })).toBe("network");
  });

  it("falls back to other for anything else, including no error at all", () => {
    expect(classifySupabaseError({ message: "check constraint violated" })).toBe("other");
    expect(classifySupabaseError(null)).toBe("other");
  });
});
