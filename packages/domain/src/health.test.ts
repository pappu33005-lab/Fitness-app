import { describe, expect, it } from "vitest";
import {
  dedupeHealthSamples,
  describeHealthConnection,
  isWorkoutAlreadyRepresented,
  newExternalWorkouts,
  normalizeHealthSample,
  normalizeHealthSamples,
  type ExternalWorkout,
  type HealthConnectionSummary,
  type LocalSessionWindow,
  type RawHealthSample,
} from "./health";

function sample(patch: Partial<RawHealthSample> = {}): RawHealthSample {
  return {
    metric: "steps",
    value: 1000,
    unit: "count",
    startedAt: "2026-09-28T00:00:00.000Z",
    endedAt: "2026-09-28T01:00:00.000Z",
    source: "healthkit",
    sourceRecordId: "rec-1",
    ...patch,
  };
}

describe("normalization", () => {
  it("accepts a well-formed sample and normalizes its timestamps to ISO", () => {
    const result = normalizeHealthSample(sample({ startedAt: "2026-09-28T00:00:00Z" }));
    expect(result).not.toBeNull();
    expect(result?.startedAt).toBe("2026-09-28T00:00:00.000Z");
  });

  it("coerces a numeric-looking value that arrived as a string", () => {
    expect(normalizeHealthSample(sample({ value: "1200" as unknown as number }))?.value).toBe(1200);
  });
});

describe("units", () => {
  it("keeps whatever unit string the platform reported, and rejects a missing one", () => {
    expect(normalizeHealthSample(sample({ unit: "m" }))?.unit).toBe("m");
    expect(normalizeHealthSample(sample({ unit: "" }))).toBeNull();
  });
});

describe("timestamps", () => {
  it("rejects an end before its start", () => {
    expect(normalizeHealthSample(sample({ startedAt: "2026-09-28T02:00:00Z", endedAt: "2026-09-28T01:00:00Z" }))).toBeNull();
  });

  it("rejects an unparseable timestamp", () => {
    expect(normalizeHealthSample(sample({ startedAt: "not-a-date" }))).toBeNull();
  });

  it("accepts a zero-length instant sample (startedAt equal to endedAt)", () => {
    expect(normalizeHealthSample(sample({ startedAt: "2026-09-28T01:00:00Z", endedAt: "2026-09-28T01:00:00Z" }))).not.toBeNull();
  });
});

describe("invalid data", () => {
  it("rejects a negative value", () => {
    expect(normalizeHealthSample(sample({ value: -5 }))).toBeNull();
  });

  it("rejects NaN and non-numeric garbage", () => {
    expect(normalizeHealthSample(sample({ value: NaN }))).toBeNull();
    expect(normalizeHealthSample(sample({ value: "not a number" as unknown as number }))).toBeNull();
  });

  it("accepts zero as a legitimate value (e.g. zero steps this hour)", () => {
    expect(normalizeHealthSample(sample({ value: 0 }))).not.toBeNull();
  });
});

describe("empty and partial data", () => {
  it("an empty batch normalizes to an empty batch with nothing rejected", () => {
    expect(normalizeHealthSamples([])).toEqual({ samples: [], rejectedCount: 0 });
  });

  it("a batch with some bad samples keeps the good ones and counts the rest as rejected", () => {
    const result = normalizeHealthSamples([sample(), sample({ value: -1 }), sample({ unit: "" }), sample({ sourceRecordId: "rec-2" })]);
    expect(result.samples).toHaveLength(2);
    expect(result.rejectedCount).toBe(2);
  });
});

describe("duplicate handling", () => {
  it("dedupes by (source, sourceRecordId) even if the reported value differs slightly", () => {
    const a = normalizeHealthSample(sample({ sourceRecordId: "rec-1", value: 1000 }))!;
    const b = normalizeHealthSample(sample({ sourceRecordId: "rec-1", value: 1000.4 }))!;
    expect(dedupeHealthSamples([a, b])).toHaveLength(1);
  });

  it("does not dedupe the same record id across two different sources", () => {
    const a = normalizeHealthSample(sample({ source: "healthkit", sourceRecordId: "shared" }))!;
    const b = normalizeHealthSample(sample({ source: "apple_watch", sourceRecordId: "shared" }))!;
    expect(dedupeHealthSamples([a, b])).toHaveLength(2);
  });

  it("falls back to a composite key when there is no source record id, and still dedupes an exact repeat", () => {
    const a = normalizeHealthSample(sample({ sourceRecordId: null }))!;
    const b = normalizeHealthSample(sample({ sourceRecordId: null }))!;
    expect(dedupeHealthSamples([a, b])).toHaveLength(1);
  });

  it("keeps two record-id-less samples that genuinely differ", () => {
    const a = normalizeHealthSample(sample({ sourceRecordId: null, value: 100 }))!;
    const b = normalizeHealthSample(sample({ sourceRecordId: null, value: 200 }))!;
    expect(dedupeHealthSamples([a, b])).toHaveLength(2);
  });
});

describe("external workouts vs. manually logged sessions", () => {
  const workout: ExternalWorkout = {
    sourceRecordId: "w1",
    source: "apple_watch",
    kind: "running",
    startedAt: "2026-09-28T07:00:00Z",
    endedAt: "2026-09-28T07:30:00Z",
  };

  it("counts an overlapping local session as already representing the workout", () => {
    const local: LocalSessionWindow[] = [{ startedAt: "2026-09-28T06:50:00Z", endedAt: "2026-09-28T07:20:00Z" }];
    expect(isWorkoutAlreadyRepresented(workout, local)).toBe(true);
    expect(newExternalWorkouts([workout], local)).toEqual([]);
  });

  it("does not match a local session on a different day", () => {
    const local: LocalSessionWindow[] = [{ startedAt: "2026-09-27T07:00:00Z", endedAt: "2026-09-27T07:30:00Z" }];
    expect(isWorkoutAlreadyRepresented(workout, local)).toBe(false);
    expect(newExternalWorkouts([workout], local)).toEqual([workout]);
  });

  it("treats a still-open local session (no ended_at) as covering roughly an hour from its start", () => {
    const local: LocalSessionWindow[] = [{ startedAt: "2026-09-28T07:10:00Z", endedAt: null }];
    expect(isWorkoutAlreadyRepresented(workout, local)).toBe(true);
  });

  it("never modifies the local sessions list, and never invents a merged record", () => {
    const local: LocalSessionWindow[] = [{ startedAt: "2026-09-28T06:50:00Z", endedAt: "2026-09-28T07:20:00Z" }];
    const copy = JSON.parse(JSON.stringify(local));
    newExternalWorkouts([workout], local);
    expect(local).toEqual(copy);
  });

  it("an account with no local sessions treats every external workout as new", () => {
    expect(newExternalWorkouts([workout], [])).toEqual([workout]);
  });
});

describe("permission states", () => {
  it("iOS granted is reported plainly, with the last read time when known", () => {
    const summary: HealthConnectionSummary = { platform: "healthkit", status: "granted", lastSuccessfulReadAt: "2026-09-28T08:00:00Z" };
    expect(describeHealthConnection(summary)).toContain("2026-09-28T08:00:00Z");
  });

  it("iOS never claims a denied read permission — 'unknown' is described honestly, not as granted or denied", () => {
    const summary: HealthConnectionSummary = { platform: "healthkit", status: "unknown", lastSuccessfulReadAt: null };
    const text = describeHealthConnection(summary);
    expect(text).toContain("not reported back");
    expect(text).not.toContain("denied");
  });

  it("Android denied is reported as denied, since Health Connect does report this accurately", () => {
    const summary: HealthConnectionSummary = { platform: "health_connect", status: "denied", lastSuccessfulReadAt: null };
    expect(describeHealthConnection(summary)).toContain("off");
  });
});

describe("unavailable platform", () => {
  it("an unsupported platform (e.g. the browser preview) is stated plainly", () => {
    const summary: HealthConnectionSummary = { platform: "unsupported", status: "unavailable", lastSuccessfulReadAt: null };
    expect(describeHealthConnection(summary)).toBe("Health data is not available on this device.");
  });

  it("a supported platform that is not installed/available is distinguished from a denied permission", () => {
    const summary: HealthConnectionSummary = { platform: "health_connect", status: "unavailable", lastSuccessfulReadAt: null };
    expect(describeHealthConnection(summary)).toContain("not available on this device");
  });
});

describe("error handling", () => {
  it("a completely malformed raw sample is rejected, not thrown", () => {
    expect(() => normalizeHealthSample(sample({ value: undefined as unknown as number }))).not.toThrow();
    expect(normalizeHealthSample(sample({ value: undefined as unknown as number }))).toBeNull();
  });
});
