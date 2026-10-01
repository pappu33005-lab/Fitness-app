export type UnitSystem = "metric" | "imperial";

export type FitnessLevel = "beginner" | "intermediate" | "advanced";

export type ActivityLevel = "sedentary" | "light" | "moderate" | "very" | "athlete";

export type BodyGoal = "maintain" | "lose" | "gain" | "performance";

/** Used only by the adult calorie equation. "unspecified" is an explicit choice. */
export type SexForEstimate = "female" | "male" | "unspecified";

export type WorkoutPreference = "strength" | "cardio" | "mixed" | "mobility";

export type DietaryPreference =
  | "none"
  | "vegetarian"
  | "vegan"
  | "pescatarian"
  | "gluten_free"
  | "dairy_free";

export type ProfileMetrics = {
  ageYears: number | null;
  sex: SexForEstimate | null;
  heightCm: number | null;
  weightKg: number | null;
  activityLevel: ActivityLevel | null;
  goal: BodyGoal | null;
};
