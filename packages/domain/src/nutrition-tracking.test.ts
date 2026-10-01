import { describe, expect, it } from "vitest";
import {
  emptyNutrientTotals,
  groupNutritionByDay,
  isValidWaterAmountMl,
  remainingCalories,
  remainingWaterMl,
  sanitizeNutrientInput,
  sanitizeRequiredNutrientInput,
  sumNutrients,
  type DatedNutrientTotals,
  type NutrientTotals,
} from "./nutrition";

function line(day: string, patch: Partial<NutrientTotals> = {}): DatedNutrientTotals {
  return { day, kcal: 500, proteinG: 30, carbsG: 40, fatG: 15, fiberG: null, sugarG: null, sodiumMg: null, ...patch };
}

describe("daily calorie and macro totals", () => {
  it("sums kcal and macros across several entries on one day", () => {
    const totals = sumNutrients([line("2026-09-28"), line("2026-09-28", { kcal: 300, proteinG: 10, carbsG: 20, fatG: 5 })]);
    expect(totals.kcal).toBe(800);
    expect(totals.proteinG).toBe(40);
    expect(totals.carbsG).toBe(60);
    expect(totals.fatG).toBe(20);
  });

  it("treats a single entry's totals as the day's totals", () => {
    expect(sumNutrients([line("2026-09-28")])).toEqual({ kcal: 500, proteinG: 30, carbsG: 40, fatG: 15, fiberG: null, sugarG: null, sodiumMg: null });
  });
});

describe("optional macros (fiber/sugar/sodium)", () => {
  it("stays null when no logged entry reported it", () => {
    const totals = sumNutrients([line("d"), line("d", { kcal: 200 })]);
    expect(totals.fiberG).toBeNull();
    expect(totals.sugarG).toBeNull();
    expect(totals.sodiumMg).toBeNull();
  });

  it("sums only the entries that reported it, ignoring entries that did not", () => {
    const totals = sumNutrients([line("d", { fiberG: 5 }), line("d", { fiberG: null }), line("d", { fiberG: 3 })]);
    expect(totals.fiberG).toBe(8);
  });
});

describe("water totals", () => {
  it("sums water log amounts for a day", () => {
    const amounts = [250, 500, 300];
    expect(amounts.reduce((sum, ml) => sum + ml, 0)).toBe(1050);
  });

  it("an empty day's water total is zero, not null or undefined", () => {
    const amounts: number[] = [];
    expect(amounts.reduce((sum, ml) => sum + ml, 0)).toBe(0);
  });
});

describe("remaining targets", () => {
  it("computes calories remaining against a configured goal", () => {
    expect(remainingCalories(2000, 1200)).toBe(800);
  });

  it("goes negative once over the goal, rather than clamping to zero", () => {
    expect(remainingCalories(2000, 2300)).toBe(-300);
  });

  it("is null with no configured goal, not zero", () => {
    expect(remainingCalories(null, 1200)).toBeNull();
  });

  it("computes water remaining the same way", () => {
    expect(remainingWaterMl(2000, 750)).toBe(1250);
    expect(remainingWaterMl(2000, 2500)).toBe(-500);
    expect(remainingWaterMl(null, 750)).toBeNull();
  });
});

describe("empty days", () => {
  it("sumNutrients of no entries is all-zero with optional macros null", () => {
    expect(sumNutrients([])).toEqual(emptyNutrientTotals());
  });

  it("a day missing from grouped history is simply absent, not a zero entry needing invention", () => {
    const grouped = groupNutritionByDay([line("2026-09-27"), line("2026-09-29")]);
    expect(Object.keys(grouped).sort()).toEqual(["2026-09-27", "2026-09-29"]);
    expect(grouped["2026-09-28"]).toBeUndefined();
  });
});

describe("invalid values", () => {
  it("sanitizes malformed numeric input to null rather than NaN", () => {
    expect(sanitizeNutrientInput("")).toBeNull();
    expect(sanitizeNutrientInput(undefined)).toBeNull();
    expect(sanitizeNutrientInput(null)).toBeNull();
    expect(sanitizeNutrientInput("abc")).toBeNull();
    expect(sanitizeNutrientInput("-5")).toBeNull();
    expect(sanitizeNutrientInput("NaN")).toBeNull();
    expect(sanitizeNutrientInput("Infinity")).toBeNull();
  });

  it("accepts valid numbers and numeric strings, including zero and decimals", () => {
    expect(sanitizeNutrientInput("12.5")).toBe(12.5);
    expect(sanitizeNutrientInput(0)).toBe(0);
    expect(sanitizeNutrientInput("0")).toBe(0);
  });

  it("a required field falls back to 0 instead of null for a blank/invalid entry", () => {
    expect(sanitizeRequiredNutrientInput("")).toBe(0);
    expect(sanitizeRequiredNutrientInput("nonsense")).toBe(0);
    expect(sanitizeRequiredNutrientInput("450")).toBe(450);
  });

  it("rejects invalid water amounts: negative, zero, non-integer, non-finite, and absurdly large", () => {
    expect(isValidWaterAmountMl(-100)).toBe(false);
    expect(isValidWaterAmountMl(0)).toBe(false);
    expect(isValidWaterAmountMl(250.5)).toBe(false);
    expect(isValidWaterAmountMl(NaN)).toBe(false);
    expect(isValidWaterAmountMl(Infinity)).toBe(false);
    expect(isValidWaterAmountMl(50_000)).toBe(false);
  });

  it("accepts ordinary positive whole amounts", () => {
    expect(isValidWaterAmountMl(250)).toBe(true);
    expect(isValidWaterAmountMl(1)).toBe(true);
    expect(isValidWaterAmountMl(10_000)).toBe(true);
  });
});

describe("date boundaries", () => {
  it("keeps entries on different days from bleeding into each other's totals", () => {
    const grouped = groupNutritionByDay([
      line("2026-09-28", { kcal: 100 }),
      line("2026-09-29", { kcal: 900 }),
    ]);
    expect(grouped["2026-09-28"]?.kcal).toBe(100);
    expect(grouped["2026-09-29"]?.kcal).toBe(900);
  });

  it("does not merge two different calendar days even when adjacent", () => {
    const grouped = groupNutritionByDay([line("2026-12-31", { kcal: 200 }), line("2027-01-01", { kcal: 300 })]);
    expect(grouped["2026-12-31"]?.kcal).toBe(200);
    expect(grouped["2027-01-01"]?.kcal).toBe(300);
  });
});

describe("editing and deleting entries (as totals recomputed from the remaining set)", () => {
  it("editing an entry's values changes the day's totals to the new values, not the old plus the new", () => {
    const original = [line("d", { kcal: 400 }), line("d", { kcal: 300 })];
    const afterEdit = [{ ...original[0]!, kcal: 700 }, original[1]!];
    expect(sumNutrients(original).kcal).toBe(700);
    expect(sumNutrients(afterEdit).kcal).toBe(1000);
  });

  it("deleting an entry removes exactly its contribution from the day's totals", () => {
    const entries = [line("d", { kcal: 400, proteinG: 20 }), line("d", { kcal: 300, proteinG: 10 }), line("d", { kcal: 250, proteinG: 5 })];
    const idToRemove = 1;
    const afterDelete = entries.filter((_, index) => index !== idToRemove);
    expect(sumNutrients(entries).kcal).toBe(950);
    expect(sumNutrients(afterDelete).kcal).toBe(650);
    expect(sumNutrients(afterDelete).proteinG).toBe(25);
  });

  it("deleting every entry for a day returns to the empty-day totals", () => {
    const entries = [line("d")];
    expect(sumNutrients(entries.filter(() => false))).toEqual(emptyNutrientTotals());
  });
});

describe("duplicate records", () => {
  it("logging the exact same food twice counts both, rather than collapsing them into one", () => {
    const sameFoodTwice = [line("d", { kcal: 250 }), line("d", { kcal: 250 })];
    expect(sumNutrients(sameFoodTwice).kcal).toBe(500);
    expect(groupNutritionByDay(sameFoodTwice)["d"]?.kcal).toBe(500);
  });
});
