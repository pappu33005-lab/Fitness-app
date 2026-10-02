# AI Coach

Status: implemented in code. Not run against a live Supabase project or a real Gemini key —
nothing in this document is a claim that a message was actually sent and answered. See the
"Verified and unverified" section at the end for exactly what was and was not checked.

## What changed from the previous version

The earlier implementation (Phase 0's audit) called Gemini with only the current message —
every exchange was a fresh, isolated request, and a new `ai_conversations` row was created on
every single message, so there was no real multi-turn conversation at the database level either.
Context was limited to five profile fields.

This phase:
- Sends real conversation history back to Gemini, bounded so it cannot grow unbounded.
- Reuses a conversation across turns, so a "conversation" in the database is what it sounds like.
- Expands personalized context to the full profile plus today's synced nutrition/water, the most
  recent synced sleep session, and recent synced workouts/activity.
- Adds a light per-user rate limit independent of Gemini's own.
- Adds a request timeout.
- Adds a lightweight, narrowly-targeted safety reminder for messages that look like a medical
  emergency, disordered eating, extreme calorie restriction, or a dangerous substance — an
  ordinary question never sees this extra line.
- Rewrites the coach screen for multi-turn chat: message bubbles, conversation history, New
  conversation, Retry, loading and error states.

## Architecture

- **`supabase/functions/ai-coach/index.ts`** — the Edge Function (self-contained for Supabase
  dashboard deployment). Auth, the Gemini call, Supabase queries, and the inlined coach
  decision logic all live in this single file. Paste only this file into the dashboard editor.
- **`supabase/functions/_shared/coach-logic.ts`** — the same pure decision logic kept as a
  readable shared reference (history windowing, Gemini request shape, message validation,
  personalized-context text, safety/rate-limit checks). No longer imported by the Edge Function.
- **`packages/domain/src/coach.ts`** — a copy of `coach-logic.ts` whose executable logic matches and whose header comment differs, kept solely
  so this logic can run under the project's real Vitest setup. A Deno edge function is outside
  the pnpm workspace/Vitest module graph, so this is the only way to get it under the project's
  actual test runner. **This copy is never imported by the mobile app or the edge function** —
  said again because it is easy to assume otherwise.
- **`packages/domain/src/coach.test.ts`** — the tests, run against the copy above.
- **`ai_conversations` / `ai_messages`** — unchanged schema, no migration. They already had
  everything this phase needed: a `conversation_id` to group turns, a `role`, `content`, and RLS
  scoped to `user_id = auth.uid()`.

## Conversation memory

- The mobile app sends `conversationId` with every message after the first. The function looks
  it up under RLS; a real, current user's own conversation is reused, and anything else (a typo,
  a stale id, one that belongs to another account — which RLS would refuse to return regardless)
  quietly starts a new conversation instead of erroring.
- History is fetched for that conversation, then passed through `windowConversationHistory`:
  at most the last 12 messages, and if that is still over roughly 8,000 characters, trimmed
  further from the oldest end (never dropping the most recent messages, and never emptying the
  window entirely if at least one message exists). This bounds both the request size and the
  cost of every turn as a conversation grows, at the cost of the model eventually losing the
  earliest part of a very long conversation — that tradeoff is what "sensible window" means here.
- Because the assistant's stored role is `"assistant"` but Gemini's own role for that turn is
  `"model"`, the translation happens in exactly one place (`toGeminiContents`).
- A conversation is only ever created and messages only ever persisted **after** a real reply
  comes back from Gemini. A failed request leaves nothing behind — no orphaned user message with
  no answer, and no assistant message that was never actually said. The mobile UI mirrors this:
  a failed send removes the optimistic user bubble and offers Retry instead of leaving a message
  that looks like it went somewhere it didn't.

## Personalized context

Sent only when it actually exists, read via the same authenticated, RLS-scoped Supabase client
used everywhere else in this project — never the service role:

| Sent | Source | Sent | Source |
|---|---|---|---|
| Age, sex, height, weight | `profiles` | Today's nutrition totals | `nutrition_logs` (today, synced) |
| Goal, activity level, fitness level | `profiles` | Today's water total | `hydration_logs` (today, synced) |
| Workout preference, dietary prefs | `profiles` | Most recent sleep session | `sleep_sessions` (latest, synced) |
| Step / water / sleep targets | `profiles` | Up to 3 recent finished workouts, with set counts | `workout_sessions` + `workout_sets` (synced) |
| | | Up to 3 recent finished GPS activities | `activity_sessions` (synced) |

**Never sent, because nothing syncs it anywhere yet:** step count, heart rate, HRV, a recovery
score. The system instruction states this outright, so the model does not need to infer it from
absence — it is told plainly that these are unavailable even if the phone has recently measured
them, and that anything the person types about them is their own report, not a measurement the
assistant has access to.

**Deliberately not recomputed:** a precise daily calorie target. That number already has one
canonical implementation (`packages/domain/src/calories.ts`, shown on the Nutrition tab); giving
the Edge Function a second implementation in Deno risked the two disagreeing, which is worse than
not having the number at all. The coach can still give a rough, clearly-labeled estimate if asked
and points to the app's own figure for the exact one.

The Gemini request uses `generateContent` and no longer sends `temperature`. Google's 3.8 Flash migration notes (checked 1 Oct 2026) say to omit `temperature`, `topP`, and `topK`. The model id is still `gemini-3.8-flash`. Published pricing that day was a paid introductory rate, not a confirmed free quota. No live request was made.

**A real, pre-existing limit worth restating:** everything above is server-side data, which means
it only reflects what has actually synced (Phase 2's outbox worker). A device that has never
synced, or synced a while ago, gives the coach a stale or empty picture — the coach cannot see
today's SQLite rows directly, only what has made it to Supabase. Profile uploads now include the
device timezone on the existing `profiles.timezone` column so "today" is not stuck on the SQL default of UTC.

## Safety

The base system instruction is unchanged in spirit (not a clinician, no diagnosis or medication
guidance, emergency language for emergencies) and now also says explicitly that ordinary
questions should be answered directly — the caution is for genuinely risky requests, not a
blanket hedge on every message. On top of that, `detectHighRiskTopics` pattern-matches the
incoming message for medical-emergency, disordered-eating, extreme-restriction, or
dangerous-substance language; only when it matches does `safetyReminderFor` add one extra,
stronger line to the system instruction for that turn. A question like "how much protein after
leg day" never triggers it.

This is keyword matching, not model-based classification — it will miss rephrasings and can
false-positive on an unusual but harmless phrasing. It is a floor under the model's own judgment,
not a replacement for it.

## Rate limiting and timeouts

- At most 20 user messages per rolling 10-minute window per account (checked against
  `ai_messages`, independent of whatever limit Gemini's free tier itself enforces).
- The Gemini call aborts after 25 seconds with a clear "took too long" message rather than
  hanging the function invocation indefinitely.

## Privacy

- The Gemini free-tier disclosure on the coach screen is unchanged: Google may use the content
  to improve its products, and the app never turns on billing.
- Nothing new is sent to Gemini beyond what is described above — no secrets, no other user's
  data (RLS makes that structurally impossible for the queries this function runs), and no data
  this phase didn't need for the conversation at hand.
- The Supabase service-role key is not used anywhere in this function, same as before.

## Mobile UI

- Multi-turn chat: user and assistant bubbles, auto-scrolling to the newest message.
- **New** starts a clean conversation (clears `conversationId` and the thread; the next message
  creates a fresh row server-side).
- **History** loads up to the last 20 conversations directly from `ai_conversations`/`ai_messages`
  via the authenticated client (RLS-scoped, no Edge Function needed for a plain read), showing
  each one's first message as a preview; tapping one reopens its full thread.
  An account with no past conversations sees a plain "No past conversations yet" line, not an
  error or a blank screen.
- A failed send shows **Retry**, which resends the exact same text.
- A small line appears once any message has been sent or a past conversation is open, stating
  that the coach is using saved profile/app data where available — this is the "clear indication
  it is using user data" requirement; it does not try to enumerate exactly which fields were sent
  for a given reply, since that would need its own round trip to be accurate.
- Wrapped in `KeyboardAvoidingView` so the input bar clears the keyboard on iOS; Android's default
  resize behavior handles this without extra code.

## Database

No migration. `ai_conversations` and `ai_messages` already supported everything this phase
needed — a conversation id to group turns under, `role`/`content` per message, and RLS scoped to
`user_id = auth.uid()` on both tables. Nothing was added, changed, or removed in
`supabase/migrations/`.

## Verified and unverified

**Executed here:** 26 checks in `packages/domain/src/coach.test.ts` (history-window ordering and
truncation by both message count and character budget, role translation to Gemini's `model`,
message validation, context text for both an empty account and a fully-populated one — confirming
every "not saved" fallback line and every real-value line, confirming steps/HR/HRV/recovery are
always stated as unavailable regardless of what else is known, safety-pattern detection for all
four categories and confirming ordinary questions never trigger it, and the rate-limit threshold),
run under `ts-node` with a small stand-in for Vitest — not Vitest itself. A looser TypeScript pass
over `ai-coach/index.ts` and `coach-logic.ts`, with `Deno` and the `jsr:` import stubbed out,
turned up no errors beyond the implicit-`any` cascade that stubbing causes — no evidence of a
real bug, but also not a real typecheck.

**Not run:** `pnpm test` (real Vitest), `pnpm typecheck`, lint, an actual Supabase Edge Function
deploy, an actual Gemini API call, and the mobile UI on any device or in the browser preview.

**Needs a live Supabase project + a real Gemini key:** everything about whether a message
actually round-trips — the Edge Function deploying without error (paste the self-contained
`ai-coach/index.ts` into the Supabase dashboard editor), the Supabase queries returning the
shapes assumed here, a real Gemini response parsing correctly, conversation reuse and history
actually improving the model's answers turn to turn, the rate limit and timeout firing correctly,
and the mobile screen's history list and retry behaving as described.

**Needs a physical iPhone and Android phone:** the keyboard-avoiding behavior, scrolling, and
general usability of the chat screen; whether the coach's answers meaningfully change once real
synced nutrition/workout/sleep data exists on an account.
