import { describe, expect, it } from "vitest";
import { createProductEvent } from "./analytics";
import { estimateDailyCalories } from "./calories";
import { buildSplits, elevationGainMeters, haversineMeters, trackDistanceMeters, type GeoPoint } from "./geo";
import { resolveTileProvider } from "./maps";
import { recommendNextAction } from "./nextAction";
import { displayKcal, sumNutrients } from "./nutrition";
import { scoreRecovery } from "./recovery";
import { dedupeDailySteps } from "./samples";
import { scoreSleep } from "./sleep";
import { soundModelAvailability } from "./sound";
import { bestLifts, fillDailyRange, recordedSummary, seriesForRange, sleepMinutesByDay } from "./history";
import { localDay, overnightSleepBounds, zonedDayBounds } from "./time";
import { cmToFeetAndInches, feetAndInchesToCm, formatDuration, lbToKg } from "./units";

const adult = {
  ageYears: 32,
  sex: "female" as const,
  heightCm: 168,
  weightKg: 64,
  activityLevel: "moderate" as const,
  goal: "maintain" as const,
};

describe("estimateDailyCalories", () => {
  it("uses Mifflin-St Jeor for an adult and rounds to a whole kcal", () => {
    const result = estimateDailyCalories(adult);
    expect(result.status).toBe("estimated");
    if (result.status !== "estimated") return;
    expect(result.formula).toBe("mifflin_st_jeor");
    expect(result.kcal).toBe(Math.round(result.maintenance));
    expect(result.disclaimer).toMatch(/not medical advice/i);
  });

  it("does not run the adult equation for a minor", () => {
    const result = estimateDailyCalories({ ...adult, ageYears: 16 });
    expect(result).toMatchObject({ status: "unavailable", reason: "adult_formula_does_not_apply" });
  });

  it("names the midpoint assumption when sex is unspecified", () => {
    const result = estimateDailyCalories({ ...adult, sex: "unspecified" });
    expect(result.status).toBe("estimated");
    if (result.status !== "estimated") return;
    expect(result.assumptions.join(" ")).toMatch(/midpoint/i);
  });

  it("lists missing fields instead of inventing them", () => {
    const result = estimateDailyCalories({ ...adult, weightKg: null });
    expect(result).toMatchObject({ status: "unavailable", reason: "missing_profile", missing: ["weight"] });
  });
});

describe("scoreSleep", () => {
  it("returns no score when nothing was measured or entered", () => {
    expect(
      scoreSleep({
        asleepMinutes: null,
        inBedMinutes: null,
        targetMinutes: 480,
        bedtimeDeviationMinutes: null,
        disturbanceCount: null,
        stageMinutes: null,
      }).status,
    ).toBe("unavailable");
  });

  it("scores duration alone and lists the omitted factors", () => {
    const result = scoreSleep({
      asleepMinutes: 462,
      inBedMinutes: null,
      targetMinutes: 480,
      bedtimeDeviationMinutes: null,
      disturbanceCount: null,
      stageMinutes: null,
    });
    expect(result.status).toBe("scored");
    if (result.status !== "scored") return;
    expect(result.factors.map((factor) => factor.id)).toEqual(["duration"]);
    expect(result.omitted).toContain("stages");
    expect(Number.isInteger(result.score)).toBe(true);
  });
});

describe("scoreRecovery", () => {
  it("refuses a score from a single input", () => {
    expect(scoreRecovery({
      sleepScore: 80,
      restingHr: null,
      restingHrBaseline: null,
      hrvMs: null,
      hrvBaselineMs: null,
      recentLoad: null,
      chronicLoad: null,
    }).status).toBe("unavailable");
  });

  it("scores when sleep and heart-rate baseline are both present", () => {
    const result = scoreRecovery({
      sleepScore: 80,
      restingHr: 58,
      restingHrBaseline: 54,
      hrvMs: null,
      hrvBaselineMs: null,
      recentLoad: null,
      chronicLoad: null,
    });
    expect(result.status).toBe("scored");
    if (result.status !== "scored") return;
    expect(result.factors.map((factor) => factor.id).sort()).toEqual(["resting_hr", "sleep"]);
  });
});

describe("dedupeDailySteps", () => {
  it("keeps HealthKit and does not add the phone pedometer", () => {
    const [total] = dedupeDailySteps([
      { metric: "steps", source: "healthkit", sourceRecordId: "a", day: "2026-09-24", value: 8000 },
      { metric: "steps", source: "healthkit", sourceRecordId: "a", day: "2026-09-24", value: 8000 },
      { metric: "steps", source: "core_motion", sourceRecordId: "b", day: "2026-09-24", value: 7900 },
    ]);
    expect(total).toMatchObject({ value: 8000, source: "healthkit", ignoredSources: ["core_motion"] });
  });
});

describe("timezone day bounds", () => {
  it("covers a New York day across the spring-forward boundary", () => {
    const day = "2026-03-08";
    const { start, end } = zonedDayBounds(day, "America/New_York");
    expect(localDay(start, "America/New_York")).toBe(day);
    expect(localDay(new Date(end.getTime() - 1), "America/New_York")).toBe(day);
    expect(localDay(end, "America/New_York")).not.toBe(day);
    expect(end.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });
});

describe("geo", () => {
  it("measures about 111.2 km per degree of latitude", () => {
    const from: GeoPoint = { latitude: 0, longitude: 0, altitudeMeters: null, recordedAtMs: 0 };
    const to: GeoPoint = { latitude: 1, longitude: 0, altitudeMeters: null, recordedAtMs: 60_000 };
    expect(haversineMeters(from, to)).toBeGreaterThan(110_000);
    expect(haversineMeters(from, to)).toBeLessThan(112_000);
  });

  it("builds one split per kilometer", () => {
    const points: GeoPoint[] = [];
    for (let index = 0; index <= 20; index += 1) {
      points.push({
        latitude: index * 0.01,
        longitude: 0,
        altitudeMeters: index,
        recordedAtMs: index * 60_000,
      });
    }
    const distance = trackDistanceMeters(points);
    const splits = buildSplits(points, 1000);
    expect(splits.length).toBe(Math.floor(distance / 1000));
    expect(elevationGainMeters(points)).toBeGreaterThan(0);
  });
});

describe("units and nutrition", () => {
  it("round-trips pounds and feet", () => {
    expect(lbToKg(154)).toBeCloseTo(69.85, 1);
    expect(cmToFeetAndInches(feetAndInchesToCm(5, 10)).feet).toBe(5);
  });

  it("formats duration without extra precision", () => {
    expect(formatDuration(462)).toBe("7h 42m");
    expect(displayKcal(1850.4)).toBe("1850");
  });

  it("leaves missing micronutrients null instead of zero", () => {
    const total = sumNutrients([
      { kcal: 100, proteinG: 10, carbsG: 5, fatG: 2, fiberG: null, sugarG: 1, sodiumMg: null },
      { kcal: 50, proteinG: 1, carbsG: 8, fatG: 1, fiberG: null, sugarG: null, sodiumMg: null },
    ]);
    expect(total.fiberG).toBeNull();
    expect(total.sugarG).toBe(1);
    expect(total.kcal).toBe(150);
  });
});

describe("history", () => {
  it("leaves days with no record empty", () => {
    const points = fillDailyRange("2026-09-07", 7, [{ day: "2026-09-05", value: 12 }]);
    expect(points).toHaveLength(7);
    expect(points.find((point) => point.day === "2026-09-05")?.value).toBe(12);
    expect(points.find((point) => point.day === "2026-09-04")?.value).toBeNull();
    expect(recordedSummary(points)).toEqual({ total: 12, daysWithData: 1 });
  });

  it("sums a week only from days that were recorded", () => {
    const points = seriesForRange("2026-09-25", [{ day: "2026-09-20", value: 3 }, { day: "2026-09-21", value: 4 }], 14, 7);
    expect(points.some((point) => point.value === 7)).toBe(true);
    expect(points.some((point) => point.value == null)).toBe(true);
  });

  it("keeps the longer sleep note when a night is saved twice", () => {
    const days = sleepMinutesByDay(
      [
        { asleepStart: "2026-09-24T22:00:00Z", asleepEnd: "2026-09-25T06:00:00Z" },
        { asleepStart: "2026-09-24T23:00:00Z", asleepEnd: "2026-09-25T07:30:00Z" },
      ],
      "UTC",
    );
    expect(days).toEqual([{ day: "2026-09-25", value: 510 }]);
  });

  it("ignores sets that have no weight when finding a record", () => {
    expect(
      bestLifts([
        { exerciseName: "Squat", weightKg: null, reps: 10 },
        { exerciseName: "Squat", weightKg: 40, reps: 8 },
        { exerciseName: "Squat", weightKg: 42.5, reps: 5 },
      ]),
    ).toEqual([{ exerciseName: "Squat", weightKg: 42.5, reps: 5 }]);
  });
});

describe("product boundaries", () => {
  it("rejects unknown analytics events and health values in the subject", () => {
    expect(() => createProductEvent({ name: "page_view", occurredAt: "2026-09-25T00:00:00Z" })).toThrow();
    expect(() =>
      createProductEvent({ name: "meal_logged", occurredAt: "2026-09-25T00:00:00Z", subjectId: "steps:8000" }),
    ).toThrow();
  });

  it("does not fall back to a public tile server", () => {
    expect(resolveTileProvider(undefined).status).toBe("not_configured");
    expect(resolveTileProvider("http://tile.openstreetmap.org/style.json").status).toBe("not_configured");
    expect(resolveTileProvider("https://tiles.example.com/style.json").status).toBe("ready");
  });

  it("does not claim a sound model exists", () => {
    expect(soundModelAvailability("granted")).toMatchObject({ status: "unavailable", reason: "model_not_bundled" });
  });

  it("sends a web session toward a meal or activity rather than a health connection", () => {
    expect(
      recommendNextAction({
        platform: "web",
        health: "unavailable",
        hasMealToday: false,
        hasActivityToday: false,
      }),
    ).toBe("log_meal");
  });
});

describe("overnightSleepBounds", () => {
  it("places bedtime on the previous day for a normal overnight sleep ending on the wake day", () => {
    const result = overnightSleepBounds({
      wakeDay: "2026-10-02",
      bedTime: "23:00",
      wakeTime: "07:00",
      timeZone: "UTC",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.day).toBe("2026-10-02");
    expect(result.startIso).toBe("2026-10-01T23:00:00.000Z");
    expect(result.endIso).toBe("2026-10-02T07:00:00.000Z");
    expect(result.asleepMinutes).toBe(8 * 60);
  });

  it("keeps same-day naps on the wake day", () => {
    const result = overnightSleepBounds({
      wakeDay: "2026-10-02",
      bedTime: "14:00",
      wakeTime: "15:30",
      timeZone: "UTC",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.startIso).toBe("2026-10-02T14:00:00.000Z");
    expect(result.endIso).toBe("2026-10-02T15:30:00.000Z");
    expect(result.asleepMinutes).toBe(90);
  });

  it("rejects identical or invalid clock times", () => {
    expect(overnightSleepBounds({ wakeDay: "2026-10-02", bedTime: "07:00", wakeTime: "07:00", timeZone: "UTC" }).ok).toBe(false);
    expect(overnightSleepBounds({ wakeDay: "2026-10-02", bedTime: "25:00", wakeTime: "07:00", timeZone: "UTC" }).ok).toBe(false);
  });
});
