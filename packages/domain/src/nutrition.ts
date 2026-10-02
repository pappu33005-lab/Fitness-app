export type NutrientTotals = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
};

/**
 * Open Food Facts `serving_quantity` is only safe as grams when the source unit is
 * explicitly grams. Units such as serving/ml/oz must not be treated as grams.
 * Returns null when the quantity cannot honestly be used as a gram serving (caller
 * should fall back to per-100 g values).
 */
export function resolveServingQuantityGrams(
  quantity: number | string | null | undefined,
  unit: string | null | undefined,
): number | null {
  const parsed =
    typeof quantity === "number"
      ? quantity
      : typeof quantity === "string" && quantity.trim()
        ? Number(quantity)
        : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const normalized = (unit ?? "").trim().toLowerCase();
  if (normalized !== "g" && normalized !== "gram" && normalized !== "grams") return null;
  if (parsed > 1000) return null;
  return parsed;
}

/** Honest log/display label for an OFF-derived amount: only "N g" or the 100 g fallback. */
export function openFoodFactsServingLabel(servingQuantityG: number | null): string {
  if (servingQuantityG != null && Number.isFinite(servingQuantityG) && servingQuantityG > 0) {
    return `${Math.round(servingQuantityG)} g`;
  }
  return "100 g";
}

export type NutrientLine = NutrientTotals & { servings: number };

function scale(value: number | null, servings: number): number | null {
  if (value == null) return null;
  return value * servings;
}

export function scaleNutrients(line: NutrientLine): NutrientTotals {
  return {
    kcal: line.kcal * line.servings,
    proteinG: line.proteinG * line.servings,
    carbsG: line.carbsG * line.servings,
    fatG: line.fatG * line.servings,
    fiberG: scale(line.fiberG, line.servings),
    sugarG: scale(line.sugarG, line.servings),
    sodiumMg: scale(line.sodiumMg, line.servings),
  };
}

export function sumNutrients(lines: NutrientTotals[]): NutrientTotals {
  const sum = {
    kcal: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    sugarG: 0,
    sodiumMg: 0,
  };
  let fiber = false;
  let sugar = false;
  let sodium = false;
  for (const line of lines) {
    sum.kcal += line.kcal;
    sum.proteinG += line.proteinG;
    sum.carbsG += line.carbsG;
    sum.fatG += line.fatG;
    if (line.fiberG != null) {
      fiber = true;
      sum.fiberG += line.fiberG;
    }
    if (line.sugarG != null) {
      sugar = true;
      sum.sugarG += line.sugarG;
    }
    if (line.sodiumMg != null) {
      sodium = true;
      sum.sodiumMg += line.sodiumMg;
    }
  }
  return {
    kcal: sum.kcal,
    proteinG: sum.proteinG,
    carbsG: sum.carbsG,
    fatG: sum.fatG,
    fiberG: fiber ? sum.fiberG : null,
    sugarG: sugar ? sum.sugarG : null,
    sodiumMg: sodium ? sum.sodiumMg : null,
  };
}

export function displayKcal(kcal: number): string {
  return String(Math.round(kcal));
}

export function displayMacro(grams: number): string {
  return grams.toFixed(1);
}

// --- Phase 6: entry validation, targets, and multi-day aggregation --------------------

/**
 * Parses a food-entry form field into a safe, non-negative finite number, or null for an
 * empty/invalid value. Used for every numeric nutrient field (kcal, protein, carbs, fat,
 * fiber) so a stray letter or a blank box can never reach storage as NaN or a negative
 * number.
 */
export function sanitizeNutrientInput(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/** A required nutrient (kcal) is the same rule, but blank/invalid becomes 0 rather than null — there is no "unknown calories" state to log. */
export function sanitizeRequiredNutrientInput(raw: string | number | null | undefined): number {
  return sanitizeNutrientInput(raw) ?? 0;
}

const MAX_SINGLE_WATER_ENTRY_ML = 10_000;

/** Whole millilitres, greater than zero, no larger than one very large bottle. Rejects NaN, negative, and non-integer amounts. */
export function isValidWaterAmountMl(ml: number): boolean {
  return Number.isFinite(ml) && Number.isInteger(ml) && ml > 0 && ml <= MAX_SINGLE_WATER_ENTRY_ML;
}

/**
 * Calories left against a configured goal. Not clamped at zero: a negative result means
 * over the goal, which is the point of showing it.
 */
export function remainingCalories(targetKcal: number | null, consumedKcal: number): number | null {
  return targetKcal == null ? null : Math.round(targetKcal - consumedKcal);
}

/** Water left against the profile's hydration target. Also not clamped, for the same reason. */
export function remainingWaterMl(targetMl: number | null, consumedMl: number): number | null {
  return targetMl == null ? null : Math.round(targetMl - consumedMl);
}

export type DatedNutrientTotals = NutrientTotals & { day: string };

/**
 * Sums logged entries per calendar day. A day with no entries is simply absent from the
 * result — callers show a real zero state for a missing key rather than treating it as an
 * error. Two entries with identical values on the same day are both counted, not
 * deduplicated: logging the same food twice is a real, distinct event.
 */
export function groupNutritionByDay(entries: DatedNutrientTotals[]): Record<string, NutrientTotals> {
  const byDay = new Map<string, NutrientTotals[]>();
  for (const entry of entries) {
    const list = byDay.get(entry.day);
    if (list) list.push(entry);
    else byDay.set(entry.day, [entry]);
  }
  const result: Record<string, NutrientTotals> = {};
  for (const [day, lines] of byDay) result[day] = sumNutrients(lines);
  return result;
}

/** Totals for a day with no logged entries — the explicit empty state, never left undefined. */
export function emptyNutrientTotals(): NutrientTotals {
  return { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: null, sugarG: null, sodiumMg: null };
}
