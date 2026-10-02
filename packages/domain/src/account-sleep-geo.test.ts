import { describe, expect, it } from "vitest";
import { canUploadForSession, decideAccountSync, type LocalAccountBinding } from "./account";
import { aggregatePlatformSleep, platformSleepQueryBounds, subtractUnionMinutes, unionMinutes } from "./platformSleep";
import {
  buildSplits,
  durationSeconds,
  movingSeconds,
  shouldAutoPauseForegroundRecording,
  type GeoPoint,
} from "./geo";
import { openFoodFactsServingLabel, resolveServingQuantityGrams } from "./nutrition";

describe("decideAccountSync", () => {
  const unbound: LocalAccountBinding = { status: "unbound" };
  const boundA: LocalAccountBinding = { status: "bound", userId: "user-a" };

  it("skips upload when signed out", () => {
    expect(decideAccountSync(unbound, null)).toEqual({ action: "skip_signed_out" });
    expect(canUploadForSession(boundA, null)).toBe(false);
  });

  it("requires confirmation before the first account claims unbound guest data", () => {
    expect(decideAccountSync(unbound, "user-a")).toEqual({
      action: "await_claim_confirmation",
      bindUserId: "user-a",
    });
    expect(canUploadForSession(unbound, "user-a")).toBe(false);
  });

  it("claims unbound guest data only after explicit confirmation", () => {
    expect(decideAccountSync(unbound, "user-a", { claimConfirmed: true })).toEqual({
      action: "claim_and_sync",
      bindUserId: "user-a",
    });
    expect(canUploadForSession(unbound, "user-a", { claimConfirmed: true })).toBe(true);
  });

  it("allows sync when the session matches the bound user", () => {
    expect(decideAccountSync(boundA, "user-a")).toEqual({ action: "sync" });
    expect(canUploadForSession(boundA, "user-a")).toBe(true);
  });

  it("blocks User A local data from uploading as User B", () => {
    expect(decideAccountSync(boundA, "user-b")).toEqual({
      action: "block_mismatch",
      boundUserId: "user-a",
      sessionUserId: "user-b",
    });
    expect(canUploadForSession(boundA, "user-b")).toBe(false);
    // Confirmation must never rebind an already-owned database to a different account.
    expect(decideAccountSync(boundA, "user-b", { claimConfirmed: true }).action).toBe("block_mismatch");
  });

  it("allows a wipe/reclaim flow: unbound again then confirm for a new account", () => {
    expect(decideAccountSync(unbound, "user-b")).toEqual({
      action: "await_claim_confirmation",
      bindUserId: "user-b",
    });
    expect(decideAccountSync(unbound, "user-b", { claimConfirmed: true })).toEqual({
      action: "claim_and_sync",
      bindUserId: "user-b",
    });
  });
});

describe("resolveServingQuantityGrams", () => {
  it("accepts serving_quantity = 50 with unit g", () => {
    expect(resolveServingQuantityGrams(50, "g")).toBe(50);
    expect(openFoodFactsServingLabel(50)).toBe("50 g");
  });

  it("rejects serving_quantity = 1 with unit serving (never treat as 1 g)", () => {
    expect(resolveServingQuantityGrams(1, "serving")).toBeNull();
    expect(resolveServingQuantityGrams(1, "servings")).toBeNull();
    expect(openFoodFactsServingLabel(null)).toBe("100 g");
  });

  it("rejects serving_quantity = 250 with unit ml", () => {
    expect(resolveServingQuantityGrams(250, "ml")).toBeNull();
    expect(resolveServingQuantityGrams(250, "milliliter")).toBeNull();
    expect(resolveServingQuantityGrams(250, "milliliters")).toBeNull();
  });

  it("rejects missing unit", () => {
    expect(resolveServingQuantityGrams(50, null)).toBeNull();
    expect(resolveServingQuantityGrams(50, undefined)).toBeNull();
    expect(resolveServingQuantityGrams(50, "")).toBeNull();
  });

  it("rejects invalid/non-finite serving quantity", () => {
    expect(resolveServingQuantityGrams(NaN, "g")).toBeNull();
    expect(resolveServingQuantityGrams(Infinity, "g")).toBeNull();
    expect(resolveServingQuantityGrams(-10, "g")).toBeNull();
    expect(resolveServingQuantityGrams(0, "g")).toBeNull();
    expect(resolveServingQuantityGrams("not-a-number", "g")).toBeNull();
  });

  it("falls back label to 100 g when grams cannot be resolved", () => {
    expect(openFoodFactsServingLabel(resolveServingQuantityGrams(1, "oz"))).toBe("100 g");
    expect(openFoodFactsServingLabel(resolveServingQuantityGrams(50, "grams"))).toBe("50 g");
    expect(resolveServingQuantityGrams(40, "gram")).toBe(40);
  });
});

describe("aggregatePlatformSleep", () => {
  const zone = "UTC";

  it("keeps overnight sleep ending on the wake day and ignores the previous night", () => {
    const now = new Date("2026-10-02T12:00:00.000Z");
    const result = aggregatePlatformSleep({
      now,
      timeZone: zone,
      intervals: [
        // Previous night (ended Oct 1 morning) — must not be included for Oct 2 wake day.
        { startMs: Date.parse("2026-09-30T23:00:00.000Z"), endMs: Date.parse("2026-10-01T07:00:00.000Z"), kind: "asleep" },
        // Target overnight ending Oct 2.
        { startMs: Date.parse("2026-10-01T23:00:00.000Z"), endMs: Date.parse("2026-10-02T07:00:00.000Z"), kind: "asleep" },
        { startMs: Date.parse("2026-10-01T23:00:00.000Z"), endMs: Date.parse("2026-10-02T07:30:00.000Z"), kind: "in_bed" },
      ],
    });
    expect(result.status).toBe("value");
    if (result.status !== "value") return;
    expect(result.wakeDay).toBe("2026-10-02");
    expect(result.asleepMinutes).toBe(8 * 60);
    expect(result.inBedMinutes).toBe(8.5 * 60);
  });

  it("does not double-count overlapping unspecified asleep and stage samples", () => {
    const now = new Date("2026-10-02T12:00:00.000Z");
    const start = Date.parse("2026-10-01T23:00:00.000Z");
    const end = Date.parse("2026-10-02T07:00:00.000Z");
    const mid = Date.parse("2026-10-02T03:00:00.000Z");
    const result = aggregatePlatformSleep({
      now,
      timeZone: zone,
      intervals: [
        { startMs: start, endMs: end, kind: "asleep" },
        { startMs: start, endMs: mid, kind: "light" },
        { startMs: mid, endMs: end, kind: "deep" },
      ],
    });
    expect(result.status).toBe("value");
    if (result.status !== "value") return;
    expect(result.asleepMinutes).toBe(8 * 60);
    expect(result.stages?.light).toBe(4 * 60);
    expect(result.stages?.deep).toBe(4 * 60);
  });

  it("prefers the longest overnight bout over a short nap", () => {
    const now = new Date("2026-10-02T18:00:00.000Z");
    const result = aggregatePlatformSleep({
      now,
      timeZone: zone,
      intervals: [
        { startMs: Date.parse("2026-10-01T23:00:00.000Z"), endMs: Date.parse("2026-10-02T07:00:00.000Z"), kind: "asleep" },
        { startMs: Date.parse("2026-10-02T14:00:00.000Z"), endMs: Date.parse("2026-10-02T14:30:00.000Z"), kind: "asleep" },
      ],
    });
    expect(result.status).toBe("value");
    if (result.status !== "value") return;
    expect(result.asleepMinutes).toBe(8 * 60);
  });

  it("leaves in-bed unknown instead of inventing it from asleep", () => {
    const now = new Date("2026-10-02T12:00:00.000Z");
    const result = aggregatePlatformSleep({
      now,
      timeZone: zone,
      intervals: [{ startMs: Date.parse("2026-10-01T23:00:00.000Z"), endMs: Date.parse("2026-10-02T07:00:00.000Z"), kind: "asleep" }],
    });
    expect(result.status).toBe("value");
    if (result.status !== "value") return;
    expect(result.inBedMinutes).toBeNull();
  });

  it("returns empty when only a session envelope exists with no asleep/stage intervals", () => {
    const now = new Date("2026-10-02T12:00:00.000Z");
    const result = aggregatePlatformSleep({
      now,
      timeZone: zone,
      intervals: [{ startMs: Date.parse("2026-10-01T23:00:00.000Z"), endMs: Date.parse("2026-10-02T07:00:00.000Z"), kind: "in_bed" }],
    });
    expect(result.status).toBe("empty");
  });

  it("handles DST-safe query bounds for a wake day", () => {
    const now = new Date("2026-03-09T15:00:00.000Z"); // US DST spring-forward week
    const bounds = platformSleepQueryBounds(now, "America/New_York");
    expect(bounds.wakeDay).toBe("2026-03-09");
    expect(bounds.end.getTime()).toBeGreaterThan(bounds.start.getTime());
  });
});

describe("interval union helpers", () => {
  it("merges overlapping intervals without double-counting", () => {
    expect(
      unionMinutes([
        { startMs: 0, endMs: 60_000 },
        { startMs: 30_000, endMs: 90_000 },
      ]),
    ).toBe(1.5);
  });

  it("subtracts masked spans from a base interval", () => {
    expect(
      subtractUnionMinutes([{ startMs: 0, endMs: 120_000 }], [{ startMs: 30_000, endMs: 90_000 }]),
    ).toBe(1);
  });
});

describe("movingSeconds", () => {
  it("matches wall-clock duration when points are continuous", () => {
    const points = [
      { latitude: 0, longitude: 0, altitudeMeters: null, recordedAtMs: 0 },
      { latitude: 0, longitude: 0.001, altitudeMeters: null, recordedAtMs: 60_000 },
      { latitude: 0, longitude: 0.002, altitudeMeters: null, recordedAtMs: 120_000 },
    ];
    expect(durationSeconds(points)).toBe(120);
    expect(movingSeconds(points)).toBe(120);
  });

  it("excludes a pause gap longer than the threshold", () => {
    const points = [
      { latitude: 0, longitude: 0, altitudeMeters: null, recordedAtMs: 0 },
      { latitude: 0, longitude: 0.001, altitudeMeters: null, recordedAtMs: 60_000 },
      // 10-minute pause
      { latitude: 0, longitude: 0.002, altitudeMeters: null, recordedAtMs: 660_000 },
      { latitude: 0, longitude: 0.003, altitudeMeters: null, recordedAtMs: 720_000 },
    ];
    expect(durationSeconds(points)).toBe(720);
    expect(movingSeconds(points)).toBe(120);
  });

  it("excludes multiple pauses", () => {
    const points = [
      { latitude: 0, longitude: 0, altitudeMeters: null, recordedAtMs: 0 },
      { latitude: 0, longitude: 0.001, altitudeMeters: null, recordedAtMs: 30_000 },
      { latitude: 0, longitude: 0.002, altitudeMeters: null, recordedAtMs: 300_000 },
      { latitude: 0, longitude: 0.003, altitudeMeters: null, recordedAtMs: 330_000 },
      { latitude: 0, longitude: 0.004, altitudeMeters: null, recordedAtMs: 900_000 },
      { latitude: 0, longitude: 0.005, altitudeMeters: null, recordedAtMs: 930_000 },
    ];
    expect(movingSeconds(points)).toBe(90);
  });

  it("returns 0 for fewer than two points", () => {
    expect(movingSeconds([])).toBe(0);
    expect(movingSeconds([{ latitude: 0, longitude: 0, altitudeMeters: null, recordedAtMs: 1 }])).toBe(0);
  });
});

describe("buildSplits pause handling", () => {
  /** Dense points along latitude so gaps stay under the default 90s pause threshold. */
  function denseLeg(fromMeters: number, toMeters: number, fromMs: number, toMs: number, steps = 20): GeoPoint[] {
    const points: GeoPoint[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      points.push({
        latitude: (fromMeters + (toMeters - fromMeters) * t) / 111_320,
        longitude: 0,
        altitudeMeters: null,
        recordedAtMs: Math.round(fromMs + (toMs - fromMs) * t),
      });
    }
    return points;
  }

  it("matches continuous movement moving time across splits", () => {
    const points = denseLeg(0, 2200, 0, 660_000, 40);
    const splits = buildSplits(points, 1000);
    expect(splits.length).toBeGreaterThanOrEqual(2);
    const splitMoving = splits.slice(0, 2).reduce((sum, split) => sum + split.durationSeconds, 0);
    expect(splitMoving).toBeGreaterThan(0);
    expect(splitMoving).toBeLessThanOrEqual(movingSeconds(points) + 0.5);
    expect(splits[0]!.paceSecondsPerKilometer).toBeGreaterThan(0);
  });

  it("excludes a pause gap from split duration/pace", () => {
    const beforePause = denseLeg(0, 500, 0, 150_000, 15);
    const afterPause = denseLeg(501, 1100, 750_000, 930_000, 15);
    const points = [...beforePause, ...afterPause];
    const splits = buildSplits(points, 1000);
    expect(splits.length).toBeGreaterThanOrEqual(1);
    expect(splits[0]!.durationSeconds).toBeLessThan(400);
    expect(splits[0]!.paceSecondsPerKilometer).not.toBeNull();
    expect(splits[0]!.paceSecondsPerKilometer!).toBeLessThan(400);
    // Wall-clock across the pause would be ~930s; moving/split time must exclude it.
    expect(durationSeconds(points)).toBe(930);
    expect(movingSeconds(points)).toBeLessThan(400);
    expect(splits[0]!.durationSeconds).toBeLessThanOrEqual(movingSeconds(points) + 0.5);
  });

  it("keeps overall moving time and split moving time consistent when a split crosses a pause", () => {
    const beforePause = denseLeg(0, 800, 0, 240_000, 16);
    const afterPause = denseLeg(801, 1600, 840_000, 1_080_000, 16);
    const points = [...beforePause, ...afterPause];
    const splits = buildSplits(points, 1000);
    expect(splits.length).toBeGreaterThanOrEqual(1);
    const accounted = splits.reduce((sum, split) => sum + split.durationSeconds, 0);
    // Remaining partial kilometer is not emitted as a split; accounted moving time ≤ total moving.
    expect(accounted).toBeLessThanOrEqual(movingSeconds(points) + 0.5);
    expect(splits[0]!.durationSeconds).toBeLessThan(500);
  });

  it("supports resume after pause without inventing GPS points", () => {
    const first = denseLeg(0, 1100, 0, 300_000, 20);
    const second = denseLeg(1101, 2200, 1_200_000, 1_500_000, 20);
    const points = [...first, ...second];
    const splits = buildSplits(points, 1000);
    expect(splits.length).toBeGreaterThanOrEqual(2);
    const accounted = splits.reduce((sum, split) => sum + split.durationSeconds, 0);
    expect(accounted).toBeLessThanOrEqual(movingSeconds(points) + 0.5);
    expect(accounted).toBeGreaterThan(0);
  });
});

describe("shouldAutoPauseForegroundRecording", () => {
  it("auto-pauses when leaving without background tracking", () => {
    expect(
      shouldAutoPauseForegroundRecording({
        hasActiveSession: true,
        alreadyPaused: false,
        backgroundTrackingActive: false,
        stopping: false,
      }),
    ).toBe(true);
  });

  it("does not auto-pause when background tracking is active", () => {
    expect(
      shouldAutoPauseForegroundRecording({
        hasActiveSession: true,
        alreadyPaused: false,
        backgroundTrackingActive: true,
        stopping: false,
      }),
    ).toBe(false);
  });

  it("does not auto-pause when already paused, stopping, or idle", () => {
    expect(
      shouldAutoPauseForegroundRecording({
        hasActiveSession: true,
        alreadyPaused: true,
        backgroundTrackingActive: false,
        stopping: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoPauseForegroundRecording({
        hasActiveSession: true,
        alreadyPaused: false,
        backgroundTrackingActive: false,
        stopping: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoPauseForegroundRecording({
        hasActiveSession: false,
        alreadyPaused: false,
        backgroundTrackingActive: false,
        stopping: false,
      }),
    ).toBe(false);
  });
});
