import { describe, expect, it } from "vitest";
import {
  buildSplits,
  elevationGainMeters,
  estimatedActivityKcal,
  mergeGeoPoints,
  shouldAcceptLocationUpdate,
  shouldPersistBackgroundLocation,
  trackDistanceMeters,
  type GeoPoint,
} from "./geo";

const point = (recordedAtMs: number, latitude = 0, longitude = 0): GeoPoint => ({
  latitude,
  longitude,
  altitudeMeters: null,
  recordedAtMs,
});

describe("shouldAcceptLocationUpdate", () => {
  it("accepts only while a session is open and not paused", () => {
    expect(shouldAcceptLocationUpdate({ hasActiveSession: true, paused: false })).toBe(true);
    expect(shouldAcceptLocationUpdate({ hasActiveSession: true, paused: true })).toBe(false);
  });

  it("never accepts once the workout has been stopped (no active session)", () => {
    expect(shouldAcceptLocationUpdate({ hasActiveSession: false, paused: false })).toBe(false);
    expect(shouldAcceptLocationUpdate({ hasActiveSession: false, paused: true })).toBe(false);
  });
});

describe("shouldPersistBackgroundLocation", () => {
  it("records when the screen is locked or the app is backgrounded (no foreground writer)", () => {
    expect(shouldPersistBackgroundLocation({ hasActiveSession: true, paused: false, foregroundWriterActive: false })).toBe(true);
  });

  it("stays quiet while the foreground watcher is writing, so a fix is never stored twice", () => {
    expect(shouldPersistBackgroundLocation({ hasActiveSession: true, paused: false, foregroundWriterActive: true })).toBe(false);
  });

  it("stays quiet while paused and after the workout is stopped", () => {
    expect(shouldPersistBackgroundLocation({ hasActiveSession: true, paused: true, foregroundWriterActive: false })).toBe(false);
    expect(shouldPersistBackgroundLocation({ hasActiveSession: false, paused: false, foregroundWriterActive: false })).toBe(false);
  });
});

describe("mergeGeoPoints", () => {
  it("adds points recorded in the background to the in-memory route in time order", () => {
    const merged = mergeGeoPoints([point(1000), point(2000)], [point(4000), point(3000)]);
    expect(merged.map((p) => p.recordedAtMs)).toEqual([1000, 2000, 3000, 4000]);
  });

  it("dedupes the same fix seen by both sources", () => {
    const merged = mergeGeoPoints([point(1000), point(2000)], [point(2000), point(3000)]);
    expect(merged.map((p) => p.recordedAtMs)).toEqual([1000, 2000, 3000]);
  });

  it("returns an empty route for two empty inputs and does not mutate its inputs", () => {
    expect(mergeGeoPoints([], [])).toEqual([]);
    const existing = [point(2000), point(1000)];
    mergeGeoPoints(existing, [point(3000)]);
    expect(existing.map((p) => p.recordedAtMs)).toEqual([2000, 1000]);
  });
});

describe("existing route calculations are unchanged", () => {
  const route = [point(0, 0, 0), point(60_000, 0, 0.001), point(120_000, 0, 0.002)];

  it("still computes distance, splits and elevation from a merged route", () => {
    const merged = mergeGeoPoints([route[0]!], [route[2]!, route[1]!]);
    expect(trackDistanceMeters(merged)).toBeCloseTo(trackDistanceMeters(route), 6);
    expect(buildSplits(merged, 100).length).toBe(buildSplits(route, 100).length);
    expect(elevationGainMeters(merged)).toBeNull();
  });

  it("still exports the activity energy estimate", () => {
    expect(estimatedActivityKcal({ kind: "walk", durationSeconds: 3600, weightKg: 70 })?.kcal).toBe(Math.round(3.5 * 70));
    expect(estimatedActivityKcal({ kind: "run", durationSeconds: 0, weightKg: 70 })).toBeNull();
  });
});
