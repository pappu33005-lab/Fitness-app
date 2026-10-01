export const PRODUCT_EVENT_NAMES = [
  "onboarding_started",
  "onboarding_completed",
  "workout_started",
  "workout_completed",
  "meal_logged",
  "food_scanned",
  "sleep_recorded",
  "ai_interaction",
  "goal_completed",
  "health_connection",
  "wearable_connection",
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

export type ProductEvent = {
  name: ProductEventName;
  occurredAt: string;
  /** Opaque id such as a workout or food-log id. Never a health measurement. */
  subjectId: string | null;
};

const NAME_SET = new Set<string>(PRODUCT_EVENT_NAMES);

export function createProductEvent(input: {
  name: string;
  occurredAt: string;
  subjectId?: string | null;
}): ProductEvent {
  if (!NAME_SET.has(input.name)) {
    throw new Error(`Unknown product event: ${input.name}`);
  }
  if (input.subjectId && /heart|hrv|sleep|weight|steps|calorie/i.test(input.subjectId)) {
    throw new Error("Product events cannot carry health measurements in subjectId.");
  }
  return {
    name: input.name as ProductEventName,
    occurredAt: input.occurredAt,
    subjectId: input.subjectId ?? null,
  };
}
