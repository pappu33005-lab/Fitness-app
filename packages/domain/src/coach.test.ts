import { describe, expect, it } from "vitest";
import {
  buildContextFacts,
  detectHighRiskTopics,
  emptyCoachContext,
  isRateLimited,
  MAX_HISTORY_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_CHARS,
  RATE_LIMIT_MAX_MESSAGES,
  safetyReminderFor,
  toGeminiContents,
  validateCoachMessage,
  windowConversationHistory,
  type ChatMessage,
  type CoachContext,
} from "./coach";

function turn(role: "user" | "assistant", content: string): ChatMessage {
  return { role, content };
}

describe("conversation history construction", () => {
  it("keeps order (oldest to newest) and translates assistant turns to Gemini's 'model' role", () => {
    const history = [turn("user", "Hi"), turn("assistant", "Hello")];
    const contents = toGeminiContents(history, "How's my week going?");
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(contents.map((c) => c.parts[0]?.text)).toEqual(["Hi", "Hello", "How's my week going?"]);
  });

  it("an empty history still produces the new message as the only content", () => {
    expect(toGeminiContents([], "Hello")).toEqual([{ role: "user", parts: [{ text: "Hello" }] }]);
  });
});

describe("history/window limiting", () => {
  it("keeps at most MAX_HISTORY_MESSAGES, the most recent ones, in order", () => {
    const messages = Array.from({ length: 30 }, (_, i) => turn(i % 2 === 0 ? "user" : "assistant", `msg ${i}`));
    const windowed = windowConversationHistory(messages);
    expect(windowed.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
    expect(windowed[windowed.length - 1]?.content).toBe("msg 29");
    expect(windowed[0]?.content).toBe(`msg ${30 - MAX_HISTORY_MESSAGES}`);
  });

  it("also trims by total character budget, from the oldest end, when messages are long", () => {
    const messages = [turn("user", "a".repeat(5000)), turn("assistant", "b".repeat(5000)), turn("user", "c".repeat(100))];
    const windowed = windowConversationHistory(messages, 12, MAX_HISTORY_CHARS);
    expect(windowed.some((m) => m.content === "c".repeat(100))).toBe(true);
    const total = windowed.reduce((sum, m) => sum + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_HISTORY_CHARS + 5000); // budget may still exceed with a single oversized remaining message
  });

  it("never returns an empty window when given at least one message, even if it alone exceeds the budget", () => {
    const windowed = windowConversationHistory([turn("user", "x".repeat(20000))], 12, MAX_HISTORY_CHARS);
    expect(windowed).toHaveLength(1);
  });

  it("an empty conversation windows to an empty array", () => {
    expect(windowConversationHistory([])).toEqual([]);
  });
});

describe("empty conversation and multiple turns", () => {
  it("a fresh conversation has no history to send, only the new message", () => {
    expect(toGeminiContents(windowConversationHistory([]), "First question")).toEqual([{ role: "user", parts: [{ text: "First question" }] }]);
  });

  it("a multi-turn conversation preserves every turn's content and role up to the window", () => {
    const history = [turn("user", "Q1"), turn("assistant", "A1"), turn("user", "Q2"), turn("assistant", "A2")];
    const contents = toGeminiContents(windowConversationHistory(history), "Q3");
    expect(contents).toHaveLength(5);
    expect(contents[4]).toEqual({ role: "user", parts: [{ text: "Q3" }] });
  });
});

describe("message validation", () => {
  it("rejects empty or whitespace-only messages", () => {
    expect(validateCoachMessage("")).toEqual({ ok: false, reason: "Send a question." });
    expect(validateCoachMessage("   ")).toEqual({ ok: false, reason: "Send a question." });
    expect(validateCoachMessage(undefined)).toEqual({ ok: false, reason: "Send a question." });
    expect(validateCoachMessage(null)).toEqual({ ok: false, reason: "Send a question." });
  });

  it("rejects a message over the character limit, stating the limit", () => {
    const result = validateCoachMessage("a".repeat(MAX_MESSAGE_CHARS + 1));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain(String(MAX_MESSAGE_CHARS));
  });

  it("trims and accepts an ordinary message, including right at the limit", () => {
    expect(validateCoachMessage("  What should I eat today?  ")).toEqual({ ok: true, message: "What should I eat today?" });
    expect(validateCoachMessage("a".repeat(MAX_MESSAGE_CHARS))).toEqual({ ok: true, message: "a".repeat(MAX_MESSAGE_CHARS) });
  });
});

describe("context selection: missing user data", () => {
  it("every fact line states that data is not saved/recorded when context is entirely empty", () => {
    const facts = buildContextFacts(emptyCoachContext());
    expect(facts.some((f) => f.includes("Age is not saved"))).toBe(true);
    expect(facts.some((f) => f.includes("No food has been logged"))).toBe(true);
    expect(facts.some((f) => f.includes("No water has been logged"))).toBe(true);
    expect(facts.some((f) => f.includes("No sleep session has been recorded"))).toBe(true);
    expect(facts.some((f) => f.includes("No finished workout has been recorded"))).toBe(true);
    expect(facts.some((f) => f.includes("No GPS activity has been recorded"))).toBe(true);
  });

  it("never invents steps, heart rate, HRV, or a recovery score — states plainly they are unavailable", () => {
    const facts = buildContextFacts(emptyCoachContext()).join(" ");
    expect(facts).toContain("Step count, heart rate, heart-rate variability, and a recovery score are not available");
  });

  it("a missing profile alone (no logs) is still reported field by field, not as one generic error", () => {
    const context: CoachContext = { ...emptyCoachContext() };
    const facts = buildContextFacts(context);
    expect(facts.filter((f) => f.endsWith("is not saved.")).length).toBeGreaterThan(5);
  });
});

describe("context selection: available user data", () => {
  const fullContext: CoachContext = {
    profile: {
      ageYears: 30,
      sex: "female",
      heightCm: 168,
      weightKg: 62,
      fitnessLevel: "intermediate",
      activityLevel: "moderate",
      goal: "build_muscle",
      workoutPreference: "strength",
      dietary: ["vegetarian"],
      sleepTargetMinutes: 480,
      hydrationTargetMl: 2200,
      stepGoal: 9000,
    },
    nutritionToday: { kcal: 1450, proteinG: 90, carbsG: 140, fatG: 45 },
    hydrationToday: { ml: 1200 },
    latestSleep: { day: "2026-09-27", asleepMinutes: 410 },
    recentWorkouts: [{ startedAt: "2026-09-26T18:00:00Z", setCount: 12 }],
    recentActivity: [{ kind: "run", startedAt: "2026-09-25T07:00:00Z", distanceMeters: 5200, movingSeconds: 1800 }],
  };

  it("reports real stored values instead of the not-saved fallback", () => {
    const facts = buildContextFacts(fullContext).join(" | ");
    expect(facts).toContain("Age: 30 years");
    expect(facts).toContain("Dietary preferences: vegetarian");
    expect(facts).toContain("Daily step goal: 9000 steps");
  });

  it("reports today's real nutrition and hydration totals", () => {
    const facts = buildContextFacts(fullContext).join(" | ");
    expect(facts).toContain("1450 kcal");
    expect(facts).toContain("90 g protein");
    expect(facts).toContain("Water logged today: 1200 ml");
  });

  it("reports the most recent sleep session's real duration", () => {
    const facts = buildContextFacts(fullContext).join(" | ");
    expect(facts).toContain("2026-09-27");
    expect(facts).toMatch(/6\.8 h asleep/);
  });

  it("reports recent workouts and activity with real set counts and distances", () => {
    const facts = buildContextFacts(fullContext).join(" | ");
    expect(facts).toContain("12 sets");
    expect(facts).toContain("5.2 km");
  });

  it("still never claims a step count, HR, HRV, or recovery score even with everything else available", () => {
    const facts = buildContextFacts(fullContext).join(" ");
    expect(facts).toContain("Step count, heart rate, heart-rate variability, and a recovery score are not available");
  });
});

describe("safety behavior", () => {
  it("flags a medical emergency phrase and produces a strengthened reminder", () => {
    const topics = detectHighRiskTopics("I have chest pain during my run, what should I do?");
    expect(topics).toContain("medical_emergency");
    expect(safetyReminderFor(topics)).toMatch(/qualified healthcare professional|emergency services/);
  });

  it("flags disordered-eating and extreme-restriction language", () => {
    expect(detectHighRiskTopics("I've been trying to purge after meals")).toContain("eating_disorder");
    expect(detectHighRiskTopics("Is it safe to eat zero calories for a week?")).toContain("extreme_restriction");
  });

  it("flags a dangerous substance mention", () => {
    expect(detectHighRiskTopics("Should I take steroids to build muscle faster?")).toContain("dangerous_substance");
  });

  it("does not flag an ordinary fitness or nutrition question, and adds no reminder for it", () => {
    const topics = detectHighRiskTopics("How much protein should I eat after a leg workout?");
    expect(topics).toEqual([]);
    expect(safetyReminderFor(topics)).toBeNull();
  });

  it("does not flag ordinary calorie or diet questions that merely mention a number", () => {
    expect(detectHighRiskTopics("Is 1800 calories a day reasonable for weight loss?")).toEqual([]);
  });
});

describe("rate limiting", () => {
  it("is not limited below the threshold, and is limited at or above it", () => {
    expect(isRateLimited(RATE_LIMIT_MAX_MESSAGES - 1)).toBe(false);
    expect(isRateLimited(RATE_LIMIT_MAX_MESSAGES)).toBe(true);
    expect(isRateLimited(RATE_LIMIT_MAX_MESSAGES + 5)).toBe(true);
  });

  it("zero recent messages is never limited", () => {
    expect(isRateLimited(0)).toBe(false);
  });
});
