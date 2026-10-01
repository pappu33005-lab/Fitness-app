import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildContextFacts,
  detectHighRiskTopics,
  isRateLimited,
  safetyReminderFor,
  toGeminiContents,
  validateCoachMessage,
  windowConversationHistory,
  type ChatMessage,
  type CoachContext,
} from "../_shared/coach-logic.ts";

/**
 * Free-tier Gemini model listed with free input and output on the standard
 * lane: https://ai.google.dev/gemini-api/docs/pricing (checked 25 Sep 2026,
 * model id gemini-3.8-flash). GEMINI_MODEL can override it. This function
 * never enables billing.
 */
const FREE_MODEL = "gemini-3.8-flash";
const GEMINI_TIMEOUT_MS = 25_000;
/** History is fetched a little past the window so windowConversationHistory has real slack to trim from. */
const HISTORY_FETCH_LIMIT = 60;

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
          generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
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
      { error: "The free Gemini allowance is used up for now. Wait a bit and try again. Nothing was billed." },
      { status: 429 },
    );
  }
  if (!completion.ok) {
    const detail = await completion.text();
    const billing = /billing|quota|RESOURCE_EXHAUSTED|free tier is not available/i.test(detail);
    return Response.json(
      {
        error: billing
          ? "Gemini did not accept this request on the free tier. Billing was not turned on."
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
