import { describe, expect, it } from "vitest";
import { canUploadForSession, decideAccountSync, type LocalAccountBinding } from "./account";
import { aggregatePlatformSleep, platformSleepQueryBounds, subtractUnionMinutes, unionMinutes } from "./platformSleep";
import { durationSeconds, movingSeconds } from "./geo";

describe("decideAccountSync", () => {
  const unbound: LocalAccountBinding = { status: "unbound" };
  const boundA: LocalAccountBinding = { status: "bound", userId: "user-a" };

  it("skips upload when signed out", () => {
    expect(decideAccountSync(unbound, null)).toEqual({ action: "skip_signed_out" });
    expect(canUploadForSession(boundA, null)).toBe(false);
  });

  it("claims unbound guest data for the first signed-in user, then allows sync", () => {
    expect(decideAccountSync(unbound, "user-a")).toEqual({ action: "claim_and_sync", bindUserId: "user-a" });
    expect(canUploadForSession(unbound, "user-a")).toBe(true);
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
