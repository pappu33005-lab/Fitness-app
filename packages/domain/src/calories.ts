import type { ActivityLevel, BodyGoal, ProfileMetrics, SexForEstimate } from "./profile";

export const CALORIE_DISCLAIMER =
  "This is an estimate from the Mifflin–St Jeor equation and an activity factor. It is not a measurement of what you burned, and it is not medical advice.";

const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
  athlete: 1.9,
};

/** Fractional change from estimated maintenance intake. */
const GOAL_FACTOR: Record<BodyGoal, number> = {
  maintain: 0,
  lose: -0.15,
  gain: 0.1,
  performance: 0.08,
};

export type CalorieEstimate =
  | {
      status: "estimated";
      kcal: number;
      bmr: number;
      maintenance: number;
      formula: "mifflin_st_jeor";
      assumptions: string[];
      disclaimer: string;
    }
  | {
      status: "unavailable";
      reason: "missing_profile" | "adult_formula_does_not_apply" | "metrics_out_of_range";
      missing: string[];
    };

function sexConstant(sex: SexForEstimate): number {
  if (sex === "male") return 5;
  if (sex === "female") return -161;
  return (5 + -161) / 2;
}

export function estimateDailyCalories(profile: ProfileMetrics): CalorieEstimate {
  const missing: string[] = [];
  if (profile.ageYears == null) missing.push("age");
  if (profile.sex == null) missing.push("sex");
  if (profile.heightCm == null) missing.push("height");
  if (profile.weightKg == null) missing.push("weight");
  if (profile.activityLevel == null) missing.push("activity");
  if (profile.goal == null) missing.push("goal");
  if (missing.length > 0) {
    return { status: "unavailable", reason: "missing_profile", missing };
  }

  const ageYears = profile.ageYears as number;
  const heightCm = profile.heightCm as number;
  const weightKg = profile.weightKg as number;
  const sex = profile.sex as SexForEstimate;
  const activityLevel = profile.activityLevel as ActivityLevel;
  const goal = profile.goal as BodyGoal;

  if (ageYears < 18) {
    return { status: "unavailable", reason: "adult_formula_does_not_apply", missing: [] };
  }

  const plausible =
    ageYears <= 120 && heightCm >= 90 && heightCm <= 250 && weightKg >= 25 && weightKg <= 350;
  if (!plausible) {
    return { status: "unavailable", reason: "metrics_out_of_range", missing: [] };
  }

  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * ageYears + sexConstant(sex);
  const maintenance = bmr * ACTIVITY_FACTOR[activityLevel];
  const kcal = Math.round(maintenance * (1 + GOAL_FACTOR[goal]));
  const assumptions = [
    "The activity factor estimates a typical day. It is not today's measured expenditure.",
  ];
  if (sex === "unspecified") {
    assumptions.push(
      "No sex was provided, so the estimate uses the midpoint of the male and female equation constants.",
    );
  }
  if (goal === "lose") assumptions.push("The loss target is 15% under estimated maintenance.");
  if (goal === "gain") assumptions.push("The gain target is 10% over estimated maintenance.");
  if (goal === "performance") {
    assumptions.push("The performance target is 8% over estimated maintenance.");
  }

  return {
    status: "estimated",
    kcal,
    bmr: Math.round(bmr),
    maintenance: Math.round(maintenance),
    formula: "mifflin_st_jeor",
    assumptions,
    disclaimer: CALORIE_DISCLAIMER,
  };
}
