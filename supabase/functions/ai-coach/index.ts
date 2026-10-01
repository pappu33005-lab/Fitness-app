import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Self-contained VitaCore AI Coach Edge Function for Supabase dashboard deployment.
 * The dashboard editor only provides index.ts, so coach decision logic is inlined here
 * (same behavior as supabase/functions/_shared/coach-logic.ts / packages/domain/src/coach.ts).
 *
 * Model id checked against https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
 * on 1 Oct 2026. GEMINI_MODEL can override it. Google's migration notes for this model
 * say to omit temperature, topP, and topK. This function does not enable billing.
 * Published pricing for this model is a paid introductory rate, not a confirmed free quota.
 *
 * Secrets (set in the Supabase project, never in the mobile app):
 * - GEMINI_API_KEY (required)
 * - GEMINI_MODEL (optional)
 * Supabase injects SUPABASE_URL and SUPABASE_ANON_KEY for Edge Functions.
 */

const FREE_MODEL = "gemini-3.8-flash";
const GEMINI_TIMEOUT_MS = 25_000;
/** History is fetched a little past the window so windowConversationHistory has real slack to trim from. */
const HISTORY_FETCH_LIMIT = 60;

// --- Inlined coach logic (from _shared/coach-logic.ts) --------------------------------

type ChatRole = "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 8000;
const RATE_LIMIT_MAX_MESSAGES = 20;

type MessageValidation = { ok: true; message: string } | { ok: false; reason: string };

/** Empty/whitespace-only is rejected; an overlong message is rejected with the limit stated, not silently truncated. */
function validateCoachMessage(raw: string | null | undefined): MessageValidation {
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
function windowConversationHistory(
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

type GeminiContent = { role: "user" | "model"; parts: Array<{ text: string }> };

/** Gemini calls the assistant turn "model", not "assistant" — the stored role is translated here, once, in one place. */
function toGeminiContents(history: ChatMessage[], newMessage: string): GeminiContent[] {
  return [
    ...history.map((item) => ({ role: (item.role === "assistant" ? "model" : "user") as "model" | "user", parts: [{ text: item.content }] })),
    { role: "user" as const, parts: [{ text: newMessage }] },
  ];
}

type CoachProfileFacts = {
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

type CoachNutritionFacts = { kcal: number; proteinG: number; carbsG: number; fatG: number } | null;
type CoachHydrationFacts = { ml: number } | null;
type CoachSleepFacts = { day: string; asleepMinutes: number } | null;
type CoachWorkoutFact = { startedAt: string; setCount: number };
type CoachActivityFact = { kind: string; startedAt: string; distanceMeters: number; movingSeconds: number };

type CoachContext = {
  profile: CoachProfileFacts | null;
  nutritionToday: CoachNutritionFacts;
  hydrationToday: CoachHydrationFacts;
  latestSleep: CoachSleepFacts;
  recentWorkouts: CoachWorkoutFact[];
  recentActivity: CoachActivityFact[];
};

/**
 * Turns whatever of `context` is actually populated into plain-language facts for the
 * model's system instruction. Every line either states a real value or explicitly says
 * that value is not recorded — nothing is guessed, and a missing field never becomes a
 * silently-omitted line (which the model could not distinguish from "not asked about").
 */
function buildContextFacts(context: CoachContext): string[] {
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
      ? `Recent finished workouts: ${context.recentWorkouts.map((w) => `${w.startedAt.slice(0, 10)} (${w.setCount} set${w.setCount === 1 ? "" : "s"})`).join("; ")}.`
      : "No finished workout has been recorded and synced.",
    context.recentActivity.length
      ? `Recent GPS activity: ${context.recentActivity.map((a) => `${a.kind} on ${a.startedAt.slice(0, 10)}, ${(a.distanceMeters / 1000).toFixed(1)} km`).join("; ")}.`
      : "No GPS activity has been recorded and synced.",
    "Step count, heart rate, heart-rate variability, and a recovery score are not available to this assistant, even if the phone has recently measured them. Only what the person states in the conversation is known — treat it as their report, not a measurement you have access to.",
    "A precise daily calorie target is calculated in the VitaCore app itself from the profile fields above and is not recalculated here. If asked for a number, give only a clearly-labeled rough estimate and point to the Nutrition tab for the app's own figure.",
  ];
  return facts;
}

const HIGH_RISK_PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "medical_emergency", pattern: /chest pain|can.?t breathe|trouble breathing|fainted|severe bleeding|suicid|kill myself|hurt myself/i },
  { id: "eating_disorder", pattern: /\bpurg(e|ing)\b|starv(e|ing) myself|binge and purge/i },
  { id: "extreme_restriction", pattern: /\b(zero|0|no)\s*(kcal|calories)\b|water fast|dry fast/i },
  { id: "dangerous_substance", pattern: /\bsteroids?\b|clenbuterol|\bdnp\b|diuretics? to (lose|cut) weight/i },
];

/** Returns the ids of every high-risk pattern the message matches; an ordinary question matches none. */
function detectHighRiskTopics(message: string): string[] {
  return HIGH_RISK_PATTERNS.filter((entry) => entry.pattern.test(message)).map((entry) => entry.id);
}

/**
 * An extra line appended to the system instruction only when detectHighRiskTopics found
 * something — an ordinary fitness/nutrition question never sees this line, which is what
 * keeps the safety behavior from making everyday questions feel unusable.
 */
function safetyReminderFor(topics: string[]): string | null {
  if (topics.length === 0) return null;
  return "This message may involve a medical emergency, disordered eating, extreme calorie restriction, or an unsafe substance. Do not diagnose or prescribe. Give only general, safety-minded information and clearly recommend a qualified healthcare professional — or, for an emergency, local emergency services — before anything else.";
}

/** A simple fixed-window limit: true once this many user messages have already landed inside the current window. */
function isRateLimited(recentUserMessageCount: number, max: number = RATE_LIMIT_MAX_MESSAGES): boolean {
  return recentUserMessageCount >= max;
}

// --- Edge Function handler ------------------------------------------------------------

const safety = [
  "You are the VitaCore coach. You help with training, meals, hydration, sleep habits, and recovery.",
  "You are not a clinician. You do not diagnose, prescribe, or interpret medication.",
  "If the person describes chest pain, trouble breathing, fainting, an eating disorder, a serious injury, or any emergency, tell them to contact a licensed clinician or local emergency services.",
  "Never invent steps, calories burned, heart rate, HRV, sleep stages, workouts, or meals.",
  "If a measurement is not in the context below, say plainly that it was not recorded — do not guess a plausible-sounding number.",
  "Calorie and protein figures you discuss are estimates, not prescriptions.",
  "Ordinary fitness, nutrition, sleep, and recovery questions should be answered directly and usefully — the cautions above are for genuinely risky requests, not every message.",
].join(" ");

function localDayString(timezone: string, date: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const model = Deno.env.get("GEMINI_MODEL")?.trim() || FREE_MODEL;
  if (!authorization || !supabaseUrl || !anonKey) {
    return Response.json({ error: "Sign in is required. The coach does not run without an account." }, { status: 401 });
  }
  if (!geminiKey) {
    return Response.json(
      { error: "The coach is waiting on the Gemini API key. Set GEMINI_API_KEY as a server secret. The app does not call a paid model on its own." },
      { status: 503 },
    );
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return Response.json({ error: "The session is not valid. Sign in again." }, { status: 401 });
  }
  const userId = userData.user.id;

  let body: { message?: string; conversationId?: string };
  try {
    body = (await request.json()) as { message?: string; conversationId?: string };
  } catch {
    return Response.json({ error: "The request body was not valid JSON." }, { status: 400 });
  }
  const validated = validateCoachMessage(body.message);
  if (!validated.ok) return Response.json({ error: validated.reason }, { status: 400 });
  const message = validated.message;

  // Rate limit: a light, app-level cap independent of Gemini's own 429s, so one account cannot burn through
  // the shared free-tier allowance (or run up a bill if billing were ever mistakenly enabled) on its own.
  const rateWindowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: recentCount } = await userClient
    .from("ai_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("role", "user")
    .gte("created_at", rateWindowStart);
  if (isRateLimited(recentCount ?? 0)) {
    return Response.json({ error: "You've sent a lot of messages in a short time. Wait a few minutes and try again." }, { status: 429 });
  }

  // Conversation: reuse the given id if it is real and belongs to this user (RLS already guarantees that —
  // a stale or someone-else's id simply will not be found, and a new conversation is started instead of erroring).
  let conversationId: string | null = null;
  if (body.conversationId) {
    const { data: existing } = await userClient.from("ai_conversations").select("id").eq("id", body.conversationId).maybeSingle();
    if (existing?.id) conversationId = existing.id;
  }

  let history: ChatMessage[] = [];
  if (conversationId) {
    const { data: pastMessages } = await userClient
      .from("ai_messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(HISTORY_FETCH_LIMIT);
    history = (pastMessages ?? []).map((row) => ({ role: row.role as ChatMessage["role"], content: row.content }));
  }

  // --- Personalized context: only ever real, synced data. A field with nothing to show says so explicitly. ---
  const { data: profileRow } = await userClient
    .from("profiles")
    .select(
      "age_years, sex, height_cm, weight_kg, fitness_level, activity_level, goal, workout_preference, dietary, sleep_target_minutes, hydration_target_ml, step_goal, timezone",
    )
    .eq("id", userId)
    .maybeSingle();
  const timezone = profileRow?.timezone || "UTC";
  const today = localDayString(timezone, new Date());

  const [{ data: nutritionRows }, { data: hydrationRows }, { data: sleepRows }, { data: workoutRows }, { data: activityRows }] = await Promise.all([
    userClient.from("nutrition_logs").select("kcal, protein_g, carbs_g, fat_g").eq("user_id", userId).eq("day", today),
    userClient.from("hydration_logs").select("ml").eq("user_id", userId).eq("day", today),
    userClient.from("sleep_sessions").select("day, asleep_start, asleep_end").eq("user_id", userId).order("day", { ascending: false }).limit(1),
    userClient
      .from("workout_sessions")
      .select("client_id, started_at")
      .eq("user_id", userId)
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(3),
    userClient
      .from("activity_sessions")
      .select("kind, started_at, distance_meters, moving_seconds")
      .eq("user_id", userId)
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(3),
  ]);

  const recentWorkouts = await Promise.all(
    (workoutRows ?? []).map(async (session) => {
      const { count } = await userClient
        .from("workout_sets")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("session_client_id", session.client_id);
      return { startedAt: session.started_at as string, setCount: count ?? 0 };
    }),
  );

  const context: CoachContext = {
    profile: profileRow
      ? {
          ageYears: profileRow.age_years,
          sex: profileRow.sex,
          heightCm: profileRow.height_cm,
          weightKg: profileRow.weight_kg,
          fitnessLevel: profileRow.fitness_level,
          activityLevel: profileRow.activity_level,
          goal: profileRow.goal,
          workoutPreference: profileRow.workout_preference,
          dietary: profileRow.dietary ?? [],
          sleepTargetMinutes: profileRow.sleep_target_minutes,
          hydrationTargetMl: profileRow.hydration_target_ml,
          stepGoal: profileRow.step_goal,
        }
      : null,
    nutritionToday:
      nutritionRows && nutritionRows.length > 0
        ? nutritionRows.reduce(
            (sum, row) => ({
              kcal: sum.kcal + (row.kcal ?? 0),
              proteinG: sum.proteinG + (row.protein_g ?? 0),
              carbsG: sum.carbsG + (row.carbs_g ?? 0),
              fatG: sum.fatG + (row.fat_g ?? 0),
            }),
            { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
          )
        : null,
    hydrationToday:
      hydrationRows && hydrationRows.length > 0 ? { ml: hydrationRows.reduce((sum, row) => sum + (row.ml ?? 0), 0) } : null,
    latestSleep:
      sleepRows && sleepRows[0]
        ? {
            day: sleepRows[0].day as string,
            asleepMinutes: Math.round(
              (new Date(sleepRows[0].asleep_end as string).getTime() - new Date(sleepRows[0].asleep_start as string).getTime()) / 60000,
            ),
          }
        : null,
    recentWorkouts,
    recentActivity: (activityRows ?? []).map((row) => ({
      kind: row.kind as string,
      startedAt: row.started_at as string,
      distanceMeters: row.distance_meters as number,
      movingSeconds: row.moving_seconds as number,
    })),
  };

  const facts = buildContextFacts(context);
  const reminder = safetyReminderFor(detectHighRiskTopics(message));
  const systemInstruction = [safety, "", "Context:", ...facts, ...(reminder ? ["", reminder] : [])].join("\n");
  const contents = toGeminiContents(windowConversationHistory(history), message);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let completion: Response;
  try {
    completion = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: { maxOutputTokens: 800 },
        }),
        signal: controller.signal,
      },
    );
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof DOMException && error.name === "AbortError") {
      return Response.json({ error: "The coach took too long to answer. Try again." }, { status: 504 });
    }
    return Response.json({ error: "The coach could not reach Gemini. No answer was invented on the phone." }, { status: 502 });
  }
  clearTimeout(timeout);

  if (completion.status === 429) {
    return Response.json(
      { error: "Gemini is rate-limiting this key right now. Wait a bit and try again." },
      { status: 429 },
    );
  }
  if (!completion.ok) {
    const detail = await completion.text();
    const billing = /billing|quota|RESOURCE_EXHAUSTED|free tier is not available/i.test(detail);
    return Response.json(
      {
        error: billing
          ? "Gemini refused this request because of quota or billing on the API key. This function does not turn billing on."
          : "The coach could not reach Gemini. No answer was invented on the phone.",
      },
      { status: 502 },
    );
  }

  let payload: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  try {
    payload = await completion.json();
  } catch {
    return Response.json({ error: "Gemini returned a response that could not be read." }, { status: 502 });
  }
  const reply = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!reply) return Response.json({ error: "Gemini returned an empty reply." }, { status: 502 });

  // Only ever persisted together, and only after a real reply exists — a failed request never leaves a
  // dangling user message with no answer, and never creates an assistant message that was not actually said.
  if (!conversationId) {
    const { data: created } = await userClient.from("ai_conversations").insert({ user_id: userId }).select("id").single();
    conversationId = created?.id ?? null;
  }
  if (conversationId) {
    await userClient.from("ai_messages").insert([
      { conversation_id: conversationId, user_id: userId, role: "user", content: message },
      { conversation_id: conversationId, user_id: userId, role: "assistant", content: reply },
    ]);
  }
  return Response.json({ reply, model, conversationId });
});
