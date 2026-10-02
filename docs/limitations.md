# Platform limits that are already decided

The product is the iOS app and the Android app. The browser is a development preview. These are not placeholders. The app refuses to invent a value when a source is missing.

## Health

- The browser has no Apple Health or Health Connect. Step and sleep cards say that.
- The browser preview stores its guest session in an in-memory SQLite database plus an IndexedDB snapshot, because the OPFS path in `expo-sqlite` 57 throws `xFileControl` under Metro. That store is for clicking through screens. iOS and Android open `vitacore.db` on disk.
- The browser preview's outbox helper runs feature writes sequentially when `withTransactionAsync` is unavailable. That path is not crash-atomic. Native SQLite keeps real transactions. Do not treat browser preview durability as production behavior.
- The browser preview does not start a location watch. Background GPS is implemented in code for the iOS and Android builds (`expo-location` background updates through `expo-task-manager`, writing to the same activity tables as the foreground screen). It has not been run on a physical device, so keeping a route recording with the screen locked is unverified. Battery use has not been measured.
- Reminder notifications (workout, hydration, daily goal) are implemented in code using `expo-notifications`, which was already a dependency and is already registered as a config plugin — no new package was needed. Scheduling, cancellation, and the settings screen have not been run on a device. See `docs/notifications.md`.
- There is no true smart alarm. A smart alarm needs to read sleep signal overnight and choose a wake moment inside a window, which nothing in this app does. What exists is a fixed-time goal reminder.
- HealthKit and Health Connect code is in the iOS and Android bundles. It runs only in a development build, not Expo Go. This environment has not produced that binary, because Apple, Google Play, and Expo accounts are not set up.
- Distance, active energy, and read-only external workouts are implemented in code for both platforms, extending Phase 1's steps/sleep/heart-rate readers. Not run on a device — see `docs/health.md`, which also flags the workout reader specifically as the least-certain piece, since nothing in this codebase queried a workout record before this phase.
- The Supabase `health_samples` table exists (`client_id`/`source_record_id` unique constraints, RLS ready) but is deliberately left unused — no health metric syncs to Supabase yet. Reasoning and what a future phase would need to do is in `docs/health.md`.
- No third-party wearable (WHOOP, Fitbit, Garmin) is connected. Each requires OAuth, a registered developer app, and — for Garmin — a non-self-serve approval process. None was bypassed or faked. See `docs/wearables.md`.
- Apple Watch has no separate integration and needs none for data it already writes into Apple Health, which this app already reads. A watchOS companion app (for on-watch features) is a materially larger, separate project and was not started.
- Phone pedometer steps are labeled “This iPhone” or “This phone”. They are not added to a HealthKit or Health Connect total.
- Sleep stages are mapped from HealthKit category values and Health Connect stage numbers. They are not inferred from the microphone.

## Maps

- `expo-maps` was not installed. On Android it uses Google Maps, which is a paid dependency that was not approved.
- Route display is implemented in code and has not been run anywhere. See `docs/maps.md`.
- One implementation serves both phones: a route outline drawn from the stored points (works offline, in the browser preview, and with no configuration), and an optional MapLibre base map on iOS and Android when `EXPO_PUBLIC_MAP_TILE_STYLE_URL` is an HTTPS style you have licensed.
- `@maplibre/maplibre-react-native` 11.4.0 is installed and the Expo config plugin is registered. Tiles still require a rebuilt development build and `EXPO_PUBLIC_MAP_TILE_STYLE_URL`. Until that build exists, a missing native module falls back to the outline. Apple MapKit is not used.
- The route outline has no roads or labels. It is not a map.
- GPS distance, pace, splits, and elevation do not depend on any map.

## Wearables

- A native Apple Watch app is not in this build. `startWatchApp` exists in the HealthKit library and is not called.
- Garmin’s Connect Developer Program is not accepting new API applications.
- The legacy Fitbit Web API is being replaced by the Google Health API, which requires a restricted-scope review. No Fitbit or Garmin client is implemented.
- If a watch or band already writes into Apple Health or Health Connect, those samples can be read from there.

## Sound

- White, pink, brown, fan, and soft-air loops are synthesized in the app. On the web they play from a blob URL. On iOS and Android they are written into the cache directory. `expo-file-system`'s `File.write` throws `validatePath is not a function` in the browser, so that path is not used there.
- Rain, ocean, forest, and spoken stories are listed and do not play. No copyrighted audio is bundled.
- Snoring, cough, and speech classification has a retention policy (no raw upload, deleteable metadata, explicit consent) and no model. The microphone permission is not requested.

## Coach

Status: implemented in code. Not run against a live Supabase project or a real Gemini key. See `docs/coach.md` for the full picture.

- The Edge Function calls Google Gemini. The default model id `gemini-3.8-flash` was still the documented stable id on 1 Oct 2026. Google's own page lists introductory paid pricing ($0.75 / 1M input tokens through 31 Dec 2026), not a confirmed free quota. `GEMINI_MODEL` can override the id. The function does not enable billing and no longer sends `temperature` (the 3.8 migration notes say to omit it).
- A 429 or a quota/billing refusal returns a retry message. The app does not fall back to another model. Whether a free quota still exists was not tested with a live key.
- Google's data-use terms for the API key's project may allow prompts to be used to improve Google products. That is stated on the coach screen. This pass did not re-read the current terms.
- The phone never holds the key. Guests cannot use the coach, because the function requires a signed-in session and reads context through Row Level Security.
- Conversation history is now sent back to Gemini (bounded to the last 12 messages or 8,000 characters, whichever is smaller). Previously each message was a fresh, isolated exchange — see `docs/coach.md` for why that was worth fixing and how the fix was verified.
- Personalized context now includes the full profile (age, sex, height, weight, goal, activity level, fitness level, workout preference, dietary preferences, step/water/sleep targets), today's synced nutrition and water totals, the most recent synced sleep session, and recent synced workouts/GPS activity. A field with nothing to show says so explicitly rather than being left out.
- Step count, heart rate, HRV, and a recovery score are still never sent to or claimed by the coach — nothing syncs them to Supabase yet (see the Phase 1/2 notes above). Only what the person types about them is known to the model.
- A precise daily calorie target is not recomputed server-side; the coach can only give a rough, clearly-labeled estimate and points to the app's own Nutrition tab for the exact figure, to avoid two different numbers disagreeing.

## Progress

- Charts use meals, water, sleep notes, GPS activities, and finished strength sets stored on the device. A day with no record is a gap, not a zero.
- Editing or deleting a food or water entry updates the local device and enqueues a remote upsert/delete for the same `client_id` when the account binding allows sync.
- Editing a food entry changes its stored totals (name, meal, macros, notes) directly. It does not store or let you change a separate per-serving amount — only the final logged totals are kept locally, the same as before this phase.
- Food added by search or barcode scan is always logged to today; the nutrition screen's date picker is for reviewing and editing past days, not for logging into them. A manually-entered food (the "Add food manually" screen) does respect the selected day.
- Step history is not stored, so steps are not charted. The profile holds one current weight, so there is no weight trend.

## Accounts

- Core logging works before signup and stays in SQLite.
- Local data is bound to the first signed-in account only after the user explicitly confirms associating unbound guest/local data with that account. A different account cannot upload that local outbox until the user signs back in as the owner or deletes local data.
- Upload of that history runs only after Supabase env vars exist and the person signs in. Cloud sync is backup/upload-only in this build — restoring cloud history onto a new phone is not implemented.
- The outbox is written now. A live sync worker is not claiming success without those credentials.
