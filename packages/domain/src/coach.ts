/**
 * TEST-ONLY MIRROR of supabase/functions/_shared/coach-logic.ts.
 *
 * This file exists solely so the AI coach's pure decision logic (history windowing,
 * Gemini request shaping, context-fact text, safety/rate-limit checks) can run under this
 * project's real Vitest setup — a Deno edge function is not part of the pnpm workspace or
 * the Vitest module graph, so it cannot be exercised there directly.
 *
 * This copy is NEVER imported by the mobile app or by the edge function. The edge function
 * inlines the same logic in supabase/functions/ai-coach/index.ts for Supabase dashboard
 * deployment (single-file editor). KEEP THESE COPIES IN SYNC — see coach.test.ts for the
 * tests that exercise this file.
 */

export type ChatRole = "user" | "assistant";
export type ChatMessage = { role: ChatRole; content: string };

export const MAX_MESSAGE_CHARS = 2000;
export const MAX_HISTORY_MESSAGES = 12;
export const MAX_HISTORY_CHARS = 8000;
export const RATE_LIMIT_MAX_MESSAGES = 20;
export const RATE_LIMIT_WINDOW_MINUTES = 10;

export type MessageValidation = { ok: true; message: string } | { ok: false; reason: string };

/** Empty/whitespace-only is rejected; an overlong message is rejected with the limit stated, not silently truncated. */
export function validateCoachMessage(raw: string | null | undefined): MessageValidation {
  const message = (raw ?? "").trim();
  if (!message) return { ok: false, reason: "Send a question." };
  if (message.length > MAX_MESSAGE_CHARS) return { ok: false, reason: `Send a question under ${MAX_MESSAGE_CHARS} characters.` };
  return { ok: true, message };
}

/**
 * Bounds what gets sent to the model: the most recent `maxMessages`, then trimmed further
 * from the oldest end if the total character count still exceeds `maxChars`. Order
 * (oldest to newest) is preserved so the model reads the conversation forwards. At least
 * one message is always kept when the input is non-empty, even if it alone exceeds the
 * character budget — trimming a single message's content is not this function's job.
 */
export function windowConversationHistory(
  messages: ChatMessage[],
  maxMessages: number = MAX_HISTORY_MESSAGES,
  maxChars: number = MAX_HISTORY_CHARS,
): ChatMessage[] {
  const recent = messages.slice(-maxMessages);
  let totalChars = recent.reduce((sum, item) => sum + item.content.length, 0);
  let start = 0;
  while (totalChars > maxChars && start < recent.length - 1) {
    totalChars -= recent[start]!.content.length;
    start += 1;
  }
  return recent.slice(start);
}

export type GeminiContent = { role: "user" | "model"; parts: Array<{ text: string }> };

/** Gemini calls the assistant turn "model", not "assistant" — the stored role is translated here, once, in one place. */
export function toGeminiContents(history: ChatMessage[], newMessage: string): GeminiContent[] {
  return [
    ...history.map((item) => ({ role: (item.role === "assistant" ? "model" : "user") as "model" | "user", parts: [{ text: item.content }] })),
    { role: "user" as const, parts: [{ text: newMessage }] },
  ];
}

// --- Personalized context ------------------------------------------------------------

export type CoachProfileFacts = {
  ageYears: number | null;
  sex: string | null;
  heightCm: number | null;
  weightKg: number | null;
  fitnessLevel: string | null;
  activityLevel: string | null;
  goal: string | null;
  workoutPreference: string | null;
  dietary: string[];
  sleepTargetMinutes: number | null;
  hydrationTargetMl: number | null;
  stepGoal: number | null;
};

export type CoachNutritionFacts = { kcal: number; proteinG: number; carbsG: number; fatG: number } | null;
export type CoachHydrationFacts = { ml: number } | null;
export type CoachSleepFacts = { day: string; asleepMinutes: number } | null;
export type CoachWorkoutFact = { startedAt: string; setCount: number };
export type CoachActivityFact = { kind: string; startedAt: string; distanceMeters: number; movingSeconds: number };

export type CoachContext = {
  profile: CoachProfileFacts | null;
  nutritionToday: CoachNutritionFacts;
  hydrationToday: CoachHydrationFacts;
  latestSleep: CoachSleepFacts;
  recentWorkouts: CoachWorkoutFact[];
  recentActivity: CoachActivityFact[];
};

/** No data at all for anything: every line explicitly says so. Used both as a real state (a brand-new account) and as the base case in tests. */
export function emptyCoachContext(): CoachContext {
  return { profile: null, nutritionToday: null, hydrationToday: null, latestSleep: null, recentWorkouts: [], recentActivity: [] };
}

/** Calendar day for an ISO instant in `timeZone`. Falls back to the UTC date prefix if the zone is invalid. */
export function coachDayLabel(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * Turns whatever of `context` is actually populated into plain-language facts for the
 * model's system instruction. Every line either states a real value or explicitly says
 * that value is not recorded — nothing is guessed, and a missing field never becomes a
 * silently-omitted line (which the model could not distinguish from "not asked about").
 * Workout/activity dates use the profile timezone so near-midnight sessions are not
 * labeled with the UTC calendar day.
 */
export function buildContextFacts(context: CoachContext, timeZone = "UTC"): string[] {
  const p = context.profile;
  const facts: string[] = [
    p?.ageYears != null ? `Age: ${p.ageYears} years` : "Age is not saved.",
    p?.sex ? `Sex: ${p.sex}` : "Sex is not saved.",
    p?.heightCm != null ? `Height: ${p.heightCm} cm` : "Height is not saved.",
    p?.weightKg != null ? `Weight: ${p.weightKg} kg` : "Weight is not saved.",
    p?.goal ? `Goal: ${p.goal}` : "Goal is not saved.",
    p?.activityLevel ? `Activity level: ${p.activityLevel}` : "Activity level is not saved.",
    p?.fitnessLevel ? `Fitness experience: ${p.fitnessLevel}` : "Fitness experience is not saved.",
    p?.workoutPreference ? `Workout preference: ${p.workoutPreference}` : "Workout preference is not saved.",
    p?.dietary?.length ? `Dietary preferences: ${p.dietary.join(", ")}` : "No dietary preferences saved.",
    p?.stepGoal != null ? `Daily step goal: ${p.stepGoal} steps` : "No step goal saved.",
    p?.hydrationTargetMl != null ? `Daily water goal: ${p.hydrationTargetMl} ml` : "No water goal saved.",
    p?.sleepTargetMinutes != null ? `Sleep target: ${Math.round((p.sleepTargetMinutes / 60) * 10) / 10} h` : "No sleep target saved.",
    context.nutritionToday
      ? `Logged today so far: ${Math.round(context.nutritionToday.kcal)} kcal, ${Math.round(context.nutritionToday.proteinG)} g protein, ${Math.round(context.nutritionToday.carbsG)} g carbs, ${Math.round(context.nutritionToday.fatG)} g fat.`
      : "No food has been logged and synced for today.",
    context.hydrationToday ? `Water logged today: ${context.hydrationToday.ml} ml.` : "No water has been logged and synced for today.",
    context.latestSleep
      ? `Most recently recorded sleep (${context.latestSleep.day}): ${Math.round((context.latestSleep.asleepMinutes / 60) * 10) / 10} h asleep.`
      : "No sleep session has been recorded and synced.",
    context.recentWorkouts.length
      ? `Recent finished workouts: ${context.recentWorkouts.map((w) => `${coachDayLabel(w.startedAt, timeZone)} (${w.setCount} set${w.setCount === 1 ? "" : "s"})`).join("; ")}.`
      : "No finished workout has been recorded and synced.",
    context.recentActivity.length
      ? `Recent GPS activity: ${context.recentActivity.map((a) => `${a.kind} on ${coachDayLabel(a.startedAt, timeZone)}, ${(a.distanceMeters / 1000).toFixed(1)} km`).join("; ")}.`
      : "No GPS activity has been recorded and synced.",
    "Step count, heart rate, heart-rate variability, and a recovery score are not available to this assistant, even if the phone has recently measured them. Only what the person states in the conversation is known — treat it as their report, not a measurement you have access to.",
    "A precise daily calorie target is calculated in the VitaCore app itself from the profile fields above and is not recalculated here. If asked for a number, give only a clearly-labeled rough estimate and point to the Nutrition tab for the app's own figure.",
  ];
  return facts;
}

// --- Safety -----------------------------------------------------------------------

const HIGH_RISK_PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "medical_emergency", pattern: /chest pain|can.?t breathe|trouble breathing|fainted|severe bleeding|suicid|kill myself|hurt myself/i },
  { id: "eating_disorder", pattern: /\bpurg(e|ing)\b|starv(e|ing) myself|binge and purge/i },
  { id: "extreme_restriction", pattern: /\b(zero|0|no)\s*(kcal|calories)\b|water fast|dry fast/i },
  { id: "dangerous_substance", pattern: /\bsteroids?\b|clenbuterol|\bdnp\b|diuretics? to (lose|cut) weight/i },
];

/** Returns the ids of every high-risk pattern the message matches; an ordinary question matches none. */
export function detectHighRiskTopics(message: string): string[] {
  return HIGH_RISK_PATTERNS.filter((entry) => entry.pattern.test(message)).map((entry) => entry.id);
}

/**
 * An extra line appended to the system instruction only when detectHighRiskTopics found
 * something — an ordinary fitness/nutrition question never sees this line, which is what
 * keeps the safety behavior from making everyday questions feel unusable.
 */
export function safetyReminderFor(topics: string[]): string | null {
  if (topics.length === 0) return null;
  return "This message may involve a medical emergency, disordered eating, extreme calorie restriction, or an unsafe substance. Do not diagnose or prescribe. Give only general, safety-minded information and clearly recommend a qualified healthcare professional — or, for an emergency, local emergency services — before anything else.";
}

/** A simple fixed-window limit: true once this many user messages have already landed inside the current window. */
export function isRateLimited(recentUserMessageCount: number, max: number = RATE_LIMIT_MAX_MESSAGES): boolean {
  return recentUserMessageCount >= max;
}
