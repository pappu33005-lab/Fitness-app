# Health data architecture

Status: implemented in code. Not run on any device — everything about whether a permission
prompt, a HealthKit/Health Connect query, or the status screen actually works as described is
unverified. See "Verified and unverified" at the end.

## Layering

```
platform source (HealthKit / Health Connect / a wearable's own cloud — see docs/wearables.md)
  -> permission layer   (apps/mobile/src/health: connectPlatformHealth, request*PermissionsAsync)
  -> platform adapter   (apps/mobile/src/health/native.ios.ts, native.android.ts)
  -> normalized sample  (packages/domain/src/health.ts: NormalizedHealthSample, normalizeHealthSample)
  -> domain layer       (packages/domain/src/samples.ts's multi-source daily totals;
                          recovery.ts / sleep.ts, unchanged by this phase)
  -> UI / coach         (apps/mobile screens; the AI coach's context builder, unchanged — see below)
```

This phase did not invent this shape — Phase 1 already built the permission-layer/adapter split
for steps, sleep, resting heart rate, and HRV. This phase:
- extends the adapter with distance, active energy, and read-only external workouts,
- adds the normalized-sample and dedup layer that was missing above the adapter,
- **discovers and wires up `packages/domain/src/samples.ts`**, which already existed with a
  multi-source dedup algorithm (including `apple_watch`, `fitbit`, `garmin` as source types) but
  was never imported anywhere in the app — this phase generalizes it from steps-only to also
  cover distance and active energy, without changing its behavior for existing steps-only callers
  (the existing `domain.test.ts` test for it was re-run by hand and still passes unchanged).

## What is new

| Metric | iOS source | Android source | Notes |
| --- | --- | --- | --- |
| Steps | HealthKit (Phase 1) | Health Connect (Phase 1) | Unchanged |
| Sleep | HealthKit (Phase 1) | Health Connect (Phase 1) | Unchanged |
| Resting HR / HRV | HealthKit (Phase 1) | Health Connect (Phase 1) | Unchanged |
| **Distance** | `HKQuantityTypeIdentifierDistanceWalkingRunning` | `Distance` record | New this phase |
| **Active energy** | `HKQuantityTypeIdentifierActiveEnergyBurned` | `ActiveCaloriesBurned` record | New this phase |
| **Workouts (read-only)** | `queryWorkoutSamples` | `ExerciseSession` record | Function and field names match the installed type definitions. Device reads are still unverified. |

Distance and active energy have **no phone-sensor fallback** the way steps has one (Core
Motion's pedometer only reports a step count) — without HealthKit/Health Connect access, these
two simply report `unavailable`, honestly.

## What is unverified, and how much

Every reader in this file follows the same try/catch-to-`unavailable` shape Phase 1 established,
so a wrong guess fails closed (an honest "unavailable", never a crash or invented number) rather
than silently, but the specific field/API names below have **not** been checked against an
installed package, for the same reason as Phase 1: no `node_modules` in this environment.

- `readDistance`/`readActiveEnergy` on iOS reuse the exact `queryStatisticsForQuantity` pattern
  Phase 1 already used successfully for resting heart rate — same confidence level as Phase 1's
  own unverified pieces.
- `readDistance`/`readActiveEnergy` on Android assume Health Connect's `Distance`/
  `ActiveCaloriesBurned` records expose `.distance.inMeters` / `.energy.inKilocalories`, mirroring
  the native Kotlin `Length`/`Energy` value-object shape. Not checked against
  `react-native-health-connect`'s actual TypeScript types.
- `readRecentWorkouts` (both platforms) is the **least certain** piece in this phase. Nothing
  elsewhere in this codebase ever queried a workout/exercise record before, so there was no
  established, already-proven pattern in this project to mirror (unlike the quantity/category
  readers, which extend a pattern Phase 1 already got right). `queryWorkoutSamples` as a function
  name is a guess at `@kingstinct/react-native-healthkit`'s API, matching its other functions'
  naming convention (`queryCategorySamples`, `queryStatisticsForQuantity`) but not confirmed.
  **Check this function specifically, first, against the installed package.**

## Normalization and deduplication

`packages/domain/src/health.ts`:
- `normalizeHealthSample` rejects a non-finite or negative value, an unparseable timestamp, an
  end before its start, and a missing unit — returning `null` rather than throwing, so one bad
  sample from a misbehaving source never stops a batch.
- `dedupeHealthSamples` prefers a platform record id when one exists (the strongest "same
  record" signal a platform can give); only for samples without one does it fall back to an
  identical (metric, source, start, end, value) tuple.
- `isWorkoutAlreadyRepresented` / `newExternalWorkouts` decide whether an external workout (say,
  one an Apple Watch recorded on its own) overlaps a workout or activity already logged in
  VitaCore, so the same session is never shown as new twice. **This never writes to or alters
  VitaCore's own `workout_sessions`/`activity_sessions` tables** — it only filters a read-only
  list for the Health & Devices screen. Manually logged data is never overwritten.

`packages/domain/src/samples.ts` (extended, not rewritten): `dedupeDailyHealthSamples` merges
same-day samples from multiple sources for steps/distance/active-energy specifically (a
"sum the day, one source wins" metric shape) using a fixed source priority
(`apple_watch` > `healthkit` > `health_connect` > `garmin` > `fitbit` > phone sensors > `manual`).
Heart rate, HRV, and sleep are deliberately **not** run through this — they are not
same-day-sum metrics, and Phase 1 already gave them their own correct today-plus-baseline shape.

## Sync / privacy: a deliberate decision not to sync yet

The Supabase migration already has a `health_samples` table — `client_id`/`source_record_id`
unique constraints, RLS scoped to `user_id = auth.uid()`, ready to receive exactly the shape
`NormalizedHealthSample` produces. **It is intentionally left unused in this phase.**

Why: the instruction for this phase was explicit — sync only what is actually required, not
everything available. Nothing currently consumes server-side health samples: the AI coach
(Phase 7) was deliberately built to state that step count, heart rate, HRV, and recovery are
**not** available to it, precisely because nothing syncs them — wiring `health_samples` now
without a consumer would mean sending a phone's continuous heart-rate stream to a server for no
functional reason, which is the opposite of what a "highly sensitive, only what's needed" privacy
posture calls for.

**What is stored locally:** nothing new, persistently — samples are read live from
HealthKit/Health Connect each time a screen needs them (the same pattern Phase 1 established for
steps/sleep/HR/HRV). The Health & Devices screen persists exactly one small preference value
(`health_last_successful_read_at`, a timestamp) in the existing local `preferences` table, purely
so the status screen can say when it last read successfully — this is not health data itself.

**What is stored remotely:** nothing from this phase. The `health_samples` table remains empty.

**If a later phase wires this up**, it should: batch samples locally, run them through
`normalizeHealthSample`/`dedupeHealthSamples` before upload, map to `health_samples`' columns
(`client_id`, `source`, `metric`, `source_record_id`, value/unit/timestamps), upload through the
existing Phase 2 sync-worker pattern (RLS-scoped client, never the service role), and — given the
volume a continuous heart-rate stream implies — almost certainly needs its own batching/interval
strategy rather than one outbox row per sample.

## AI coach compatibility

Phase 7's coach context builder (`packages/domain/src/coach.ts` /
`supabase/functions/_shared/coach-logic.ts`) is **unchanged** by this phase. It already states
explicitly that step count, heart rate, HRV, and recovery are not available to it — which remains
true, since this phase does not sync any of that data server-side (see above). The normalized
`NormalizedHealthSample` shape this phase introduces is what a future phase would feed into the
coach's context once (and if) that data starts syncing; duplicating the coach's context logic was
not necessary and was not done.

## UI: Health & Devices screen

`apps/mobile/src/app/health.tsx`, reachable from Profile:
- States the real platform (Apple Health / Health Connect / "not available" in the browser
  preview) and a real status line via `describeHealthConnection`.
- **iOS and Android are not assumed identical.** HealthKit deliberately never reports whether a
  *read* permission was individually denied (Apple's documented privacy design — this is not a
  bug in this app, it is how HealthKit works) — so on iOS this screen can only ever say
  "connected, but what was granted isn't reported back; check Settings" (with a direct button to
  open Settings), never a specific "steps: denied". Health Connect on Android does report
  granted/denied accurately, so Android's status line is more precise.
- Shows the last successful read time, from the one persisted preference described above.
- Shows recent external workouts, filtered through `newExternalWorkouts` so one already logged in
  VitaCore is not duplicated — read-only, clearly labeled as such.
- Lists WHOOP/Fitbit/Garmin/Apple Watch with their real status from `docs/wearables.md`, as plain
  text — no non-functional "Connect" button for something that cannot actually connect yet.
- No fake connected state, anywhere: if `connectPlatformHealth()` reports unavailable/denied, the
  screen says exactly that.

## Verified and unverified

**Executed here:** 26 checks in `packages/domain/src/health.test.ts` (normalization of valid and
invalid samples, unit handling, timestamp validation including an end-before-start rejection and
a zero-length-instant acceptance, invalid-value handling including NaN and negative values, empty
and partial batches, duplicate handling by record id and by the composite-key fallback including
confirming two different sources are never deduped against each other, external-workout overlap
detection including a cross-day non-match and an open-ended local session, and permission-state
descriptions confirming iOS never claims a denied read permission while Android does report one)
— run under `ts-node` with a small stand-in for Vitest, not Vitest itself. The pre-existing
`dedupeDailySteps` test in `domain.test.ts` was also re-run by hand against the generalized
`samples.ts` and still passes, unchanged.

**Not run:** `pnpm test` (real Vitest), `pnpm typecheck`, lint, and everything involving
HealthKit/Health Connect themselves.

**Needs a physical iPhone:** the HealthKit permission prompt itself, `readDistance`/
`readActiveEnergy`/`readRecentWorkouts` actually returning real data, the Settings deep link, and
whether `queryWorkoutSamples` is even the right function name.

**Needs a physical Android device:** the Health Connect permission prompt and per-permission
status, `readDistance`/`readActiveEnergy`/`readRecentWorkouts` actually returning real data, and
whether the assumed `Distance`/`ActiveCaloriesBurned`/`ExerciseSession` field shapes are correct.

**Needs external wearable accounts/APIs:** none of this phase's code — by design, nothing here
calls WHOOP, Fitbit, or Garmin (see `docs/wearables.md` for why).
