## Cursor verification — 1 October 2026

This section was added after a networked verification pass. It overrides the older "never executed" claims below where they conflict.

| Check | Result |
| --- | --- |
| Tracked files before this pass | 122, excluding `.git`. The handoff's count of 123 and its list of root files did not match the tree: `.env.example`, `.gitignore`, `.npmrc`, and `.nvmrc` were absent, and the readme was named `README 2.md`. |
| `pnpm install` | PASS |
| `pnpm typecheck` | PASS after the repairs in this pass |
| `pnpm test` | PASS — 8 files, 175 tests (the handoff's "~250" was not the Vitest count) |
| `pnpm --filter @vitacore/mobile lint` | PASS (0 errors) after the repairs |
| `npx expo-doctor` | FAIL on the original pins (missing `expo-asset` peer, five SDK 57 patch mismatches). After `npx expo install` aligned those packages, a second run passed 21/21. |
| `npx expo config --type public` | PASS. Config loads, including the MapLibre plugin. |
| Development build, device, Supabase project, Gemini request | NOT RUN |

Repairs in that pass: MapLibre 11.4 plus its config plugin and a v11 `TileMap`; `expo-task-manager` aligned to 57.0.21; Expo patch alignment and `expo-asset`; microphone recording permissions turned off for playback-only `expo-audio`; Gemini `temperature` removed; profile sync writes `profiles.timezone`; older duplicate outbox rows are cleared with the row that was uploaded; Health Connect out-of-bed sleep is counted as awake; health readers use the installed library types instead of casts; lint errors in the coach, food editor, and route map.

Still not done here: a live Supabase project, RLS proof against two users, delete synchronization, a development build, and any physical device.

---

THIS DOCUMENT IS A HANDOFF, NOT A CLAIM THAT THE APPLICATION IS PRODUCTION READY.

Everything in this document was written by an AI (Claude) working in a sandbox with **no
network access** — no `pnpm install`, no real `pnpm typecheck`/`pnpm test`/lint run, no Expo
build, no physical device, no live Supabase project, no real Gemini key. Every "implemented"
claim below means "implemented in code, reasoned about carefully, and checked as far as a
sandbox without `node_modules` allows" — never "confirmed working." Phase-by-phase reports
exist in the conversation history that produced this project; this document supersedes their
status claims where the two differ, because this audit re-checked rather than assumed.

---

## 1. Project overview

VitaCore is an Expo/React Native (SDK 57) fitness, nutrition, sleep, recovery, and AI-coach app
for iOS and Android, local-first (SQLite on-device) with optional Supabase sync. It was
originally built in Cursor, migrated here for continued work across 8 phases (see section 5).

## 2. Architecture

```
apps/mobile          Expo Router app (iOS, Android, and a browser preview for quick iteration)
  src/app/            screens (file-based routing)
  src/data/           SQLite (db.ts), mutation functions (logs.ts), outbox sync (sync.ts)
  src/health/         HealthKit/Health Connect platform adapter (native.ios.ts / native.android.ts / native.ts)
  src/activity/       background GPS location task
  src/notifications/  local reminder scheduling
  src/components/     shared UI primitives + the route-map subsystem
  src/auth/           Supabase client + SecureStore session persistence

packages/domain       Framework-free TypeScript: every pure calculation and decision rule.
                       Has its own Vitest suite. Imported by apps/mobile as @vitacore/domain.
packages/brand        Static brand constants (name, colors reference).

supabase/
  migrations/          one SQL file (0001_foundation.sql) — the entire remote schema
  functions/ai-coach/  self-contained Gemini Edge Function (single index.ts for dashboard deploy)
  functions/_shared/   coach-logic reference copy (inlined into ai-coach; mirrored in packages/domain for tests)
```

**Why domain logic is duplicated for the AI coach specifically**: a Supabase Edge Function runs
on Deno, outside the pnpm workspace / Vitest module graph. `ai-coach/index.ts` is self-contained
for dashboard deployment; `supabase/functions/_shared/coach-logic.ts` and
`packages/domain/src/coach.ts` keep content-identical copies for readability and Vitest.
`packages/domain/src/coach.ts` is never imported by the app or the function.
**Local-first, sync-optional**: SQLite (`apps/mobile/src/data/db.ts`) is the source of truth.
Supabase is an opt-in backup/sync layer (Phase 2) that requires sign-in; every feature works fully
signed-out. Row Level Security scopes every Supabase table to `auth.uid()`; the mobile app never
holds the service-role key.

## 3. Repository structure

See the inventory this audit produced — 123 files, none unexpected, no build junk, no `node_modules`,
no `.git` (this upload has never been a git repository; Cursor or you will need to `git init` it).

```
.env.example   .gitignore   .npmrc   .nvmrc   README.md   package.json
pnpm-lock.yaml   pnpm-workspace.yaml
apps/mobile/        (82 .ts/.tsx files — see apps/mobile/src/app for all 24 screens)
packages/domain/     (23 .ts files, 8 of them *.test.ts)
packages/brand/      (1 file)
supabase/            (migration + 2 edge-function files)
docs/                (11 files after this audit, see section 9)
```

## 4. Technology stack

Pinned versions and the reasoning behind each are in `docs/versions.md` (written before this
audit, not changed by it): Expo SDK 57.0.25, React Native 0.86.3, React 19.2.3, Expo Router
57.0.23, TypeScript 6.0.3 (**not** 7.x — Expo Doctor expects 6.0.3), Node 24.21.0 locally / the
EAS SDK-57 image runs Node 22.23.1, pnpm 12.6.0, EAS CLI 24.8.0.

## 5. Completed phases 1–8

| Phase | What it added |
| --- | --- |
| 1 | HealthKit/Health Connect readers for heart rate + HRV; recovery score wired onto Home |
| 2 | `sync_outbox` worker: local SQLite → Supabase, idempotent upsert, retry/backoff |
| 3 | Background GPS (`expo-task-manager` + `expo-location`), incremental point persistence |
| 4 | Route display: tile-free SVG outline always, optional MapLibre base map |
| 5 | Local reminders (workout/hydration/goal) via `expo-notifications` |
| 6 | Full nutrition + water CRUD, dashboard, date navigation |
| 7 | AI coach: multi-turn conversation memory, expanded personalized context, safety/rate-limit |
| 8 | Health-data normalization layer; distance/active-energy/workout readers; Health & Devices screen; WHOOP/Fitbit/Garmin/Watch research (no code integration) |
| Final | This document, repository-wide audit, dead-code removal, handoff packaging |

Every phase's own report in the conversation history states what it could and could not verify
in detail; this document's section 6 is the up-to-date, re-checked summary.

## 6. Feature-by-feature status

Status values used: **IMPLEMENTED** (code complete, internally consistent, passed what static
checking this sandbox allows) · **PARTIALLY IMPLEMENTED** · **MISSING** · **UNVERIFIED** (written,
plausible, never executed) · **BLOCKED BY ENVIRONMENT** · **REQUIRES PHYSICAL DEVICE** ·
**REQUIRES EXTERNAL ACCOUNT/API** · **REQUIRES FUTURE WORK**.

### Core
| Feature | Status | Notes |
| --- | --- | --- |
| Profile | IMPLEMENTED | Local SQLite singleton row; synced via Phase 2 |
| Goals (step/water/sleep/calorie) | IMPLEMENTED | Calorie goal computed client-side (Mifflin–St Jeor), never duplicated server-side on purpose |
| Local database | IMPLEMENTED; REQUIRES PHYSICAL DEVICE for migration verification | `expo-sqlite`; one additive migration (`nutrition_logs.notes`) added via a guarded `ALTER TABLE`, never run against a real pre-existing database |
| Authentication | IMPLEMENTED; UNVERIFIED | Supabase email/password, SecureStore session persistence; never run against a live project |
| Offline behavior | IMPLEMENTED | Every local feature works signed-out by design; this was a standing architectural rule all 8 phases respected |
| Data export | IMPLEMENTED | `exportLocalJson()`, local-only |
| Delete-all-data | IMPLEMENTED | `deleteAllLocalData()`, local-only |

### Fitness
| Feature | Status | Notes |
| --- | --- | --- |
| Steps | IMPLEMENTED; REQUIRES PHYSICAL DEVICE | HealthKit/Health Connect, Core Motion pedometer fallback on iOS |
| Activity tracking | IMPLEMENTED | Incremental local persistence (Phase 3) |
| GPS recording (foreground) | IMPLEMENTED; REQUIRES PHYSICAL DEVICE | `expo-location` watch |
| Background GPS | UNVERIFIED; REQUIRES PHYSICAL DEVICE | Written against `expo-task-manager`'s documented API, never run with the screen locked |
| Distance / Pace / Splits / Elevation | IMPLEMENTED | Pure, tested domain functions, unchanged since Phase 0 |
| Calories (activity estimate) | IMPLEMENTED | MET-based estimate, labeled as such in-app |
| Activity history | IMPLEMENTED | |
| Route display | UNVERIFIED; REQUIRES PHYSICAL DEVICE | SVG outline should work anywhere; MapLibre base map **cannot** work yet — see next row |
| Maps (MapLibre base map) | **MISSING dependency** | `@maplibre/maplibre-react-native` was never added to `package.json` — no network access to resolve a real version. The outline-only path uses only existing dependencies and is more likely to work as-is |

### Workouts
| Feature | Status |
| --- | --- |
| Workout creation / logging / sets | IMPLEMENTED |
| Progress / history | IMPLEMENTED |
| Personal records | IMPLEMENTED (`bestLifts` in domain) |
| Workout history | IMPLEMENTED |

### Nutrition
| Feature | Status |
| --- | --- |
| Food search (Open Food Facts) | IMPLEMENTED; REQUIRES NETWORK at runtime (public API, no key) |
| Barcode scanning | IMPLEMENTED; REQUIRES PHYSICAL DEVICE (camera) |
| Manual food entry | IMPLEMENTED (Phase 6) |
| Editing / Deleting | IMPLEMENTED (Phase 6); remote delete is NOT synced — see section 8 |
| Calories / Protein / Carbs / Fat | IMPLEMENTED |
| Water | IMPLEMENTED: quick-add, custom amount, delete, daily target |
| Daily goals | IMPLEMENTED |
| History | IMPLEMENTED (date navigation on the Nutrition tab) |

### Sleep
| Feature | Status |
| --- | --- |
| Sleep tracking | IMPLEMENTED | Manual entry + platform read |
| Sleep score | IMPLEMENTED | `scoreSleep` domain function |
| Sleep history | IMPLEMENTED |
| Recovery | IMPLEMENTED; REQUIRES PHYSICAL DEVICE | `scoreRecovery`, fed by resting-HR/HRV readers |
| Resting heart rate | IMPLEMENTED; REQUIRES PHYSICAL DEVICE | 28-day trailing baseline read directly from the platform store |
| HRV | IMPLEMENTED; REQUIRES PHYSICAL DEVICE | iOS reads SDNN, Android reads RMSSD — **different metrics, not cross-comparable**, documented in code |
| Sleep data from Apple Health | IMPLEMENTED; REQUIRES PHYSICAL DEVICE | |
| Sleep data from Health Connect | IMPLEMENTED; REQUIRES PHYSICAL DEVICE | |

### Health (Phase 1 + Phase 8)
| Feature | Status |
| --- | --- |
| Apple Health / HealthKit | IMPLEMENTED; REQUIRES PHYSICAL DEVICE | Steps, sleep, resting HR, HRV (Phase 1, more scrutinized); distance, active energy, workouts (Phase 8, less precedent to mirror — see `docs/health.md`) |
| Health Connect | IMPLEMENTED; REQUIRES PHYSICAL DEVICE | Same list, Android side |
| Heart rate / HRV | IMPLEMENTED; REQUIRES PHYSICAL DEVICE | |
| Steps | IMPLEMENTED; REQUIRES PHYSICAL DEVICE | |
| Sleep | IMPLEMENTED; REQUIRES PHYSICAL DEVICE | |
| Calories (active energy) | IMPLEMENTED; REQUIRES PHYSICAL DEVICE | Phase 8 |
| Distance | IMPLEMENTED; REQUIRES PHYSICAL DEVICE | Phase 8 |
| Workout data (read-only, external) | UNVERIFIED; REQUIRES PHYSICAL DEVICE | Least-certain reader in the project — no established API-shape precedent in this codebase before Phase 8 wrote it; fails closed if wrong |

### Wearables
| Wearable | Status | Detail |
| --- | --- | --- |
| Apple Watch | **Indirect only, via HealthKit** | Watch data an app can see arrives exactly like any other HealthKit entry; no separate Watch connection exists or is needed for that. A watchOS *companion app* (on-wrist features) is **MISSING / REQUIRES FUTURE WORK** — a materially larger, separate Xcode target, not started |
| WHOOP | **MISSING / REQUIRES EXTERNAL ACCOUNT/API** | Official OAuth API exists. Needs: a registered WHOOP developer app, OAuth client id/secret as server secrets, and the end user's own paid WHOOP membership. No code written |
| Fitbit | **MISSING / REQUIRES EXTERNAL ACCOUNT/API** | Official OAuth API exists, normally self-serve registration. **Possible indirect path**: some Fitbit devices write into Health Connect on Android already — if so, this app already reads that with zero extra code, but this was not confirmed on a device. No direct-API code written |
| Garmin | **MISSING / REQUIRES EXTERNAL ACCOUNT/API, non-self-serve** | Garmin's Connect Developer Program requires applying and being *approved* — not instant registration. No code written |

**None of the three is claimed as "supported" merely because data could theoretically flow
through HealthKit/Health Connect** — only Fitbit has a plausible such path, and it is marked
unconfirmed, not supported.

### AI Coach
| Feature | Status |
| --- | --- |
| Multi-turn conversations | IMPLEMENTED; UNVERIFIED | Real history sent to Gemini (windowed), was single-turn before Phase 7 |
| Conversation history (reopen past chats) | IMPLEMENTED; UNVERIFIED | Direct RLS-scoped Supabase reads from the mobile app, no edge function needed |
| Personalized context | IMPLEMENTED; UNVERIFIED | Full profile + today's synced nutrition/water + latest sleep + recent workouts/activity. Step count, HR, HRV, recovery are explicitly and correctly **never** sent — nothing syncs them |
| Safety handling | IMPLEMENTED; UNVERIFIED | Base system prompt + keyword-triggered extra caution for medical-emergency/disordered-eating/extreme-restriction/dangerous-substance language |
| Rate limiting | IMPLEMENTED; UNVERIFIED | 20 messages / 10 min / account, app-level, independent of Gemini's own |
| Gemini integration | IMPLEMENTED; REQUIRES EXTERNAL API KEY | `gemini-3.8-flash`, free tier, billing never enabled in code |
| Error handling | IMPLEMENTED; UNVERIFIED | Timeout, malformed JSON, empty reply, 429, generic failure all produce distinct user-facing messages; a failed request never leaves a dangling/misleading stored message |
| Privacy disclosure | IMPLEMENTED | Stated on the coach screen |

### Sync
| Feature | Status |
| --- | --- |
| `sync_outbox` | IMPLEMENTED; UNVERIFIED against a live project |
| Sign-in triggers sync | IMPLEMENTED; UNVERIFIED | `onAuthStateChange` listener |
| New-mutation triggers sync | IMPLEMENTED; UNVERIFIED | Debounced listener on every `enqueue()` |
| Retry | IMPLEMENTED; UNVERIFIED | 60s interval, no-op when nothing pending |
| Offline behavior | IMPLEMENTED | Local-first; a failed sync pass never touches local data |
| Idempotency | IMPLEMENTED; UNVERIFIED | `upsert(..., onConflict: 'user_id,client_id')` on every synced table except `activity_points`, which has no such column and instead reuses the local row's UUID as the remote primary key (works only when `createId()` produced a real UUID — flagged in code) |
| **Delete synchronization** | **MISSING** | Phase 2 only ever supports create/update. Deleting a food or water entry (Phase 6) removes it locally only; an already-synced remote copy is left behind. Documented, not silently broken |

### Notifications
| Feature | Status |
| --- | --- |
| Workout reminders | IMPLEMENTED; UNVERIFIED | Weekly native repeating trigger |
| Hydration reminders | IMPLEMENTED; UNVERIFIED | Date-based, re-planned on launch/foreground |
| Daily goal reminders | IMPLEMENTED; UNVERIFIED | Skips a day once the relevant goal is already met |
| Permission handling | IMPLEMENTED; UNVERIFIED | Requested only on first toggle-on, never repeated once blocked |
| Quiet hours | PARTIALLY IMPLEMENTED | Only hydration reminders honor them; workout/goal reminders use their own single configured time — documented, not an oversight |
| Scheduling | IMPLEMENTED; UNVERIFIED | Stable ids prevent duplicates on re-sync |
| Notification tap routing | IMPLEMENTED; UNVERIFIED | Allow-listed to `/`, `/workout`, `/nutrition` only |
| Android notification channels | IMPLEMENTED; UNVERIFIED | 3 channels, separate from Phase 3's foreground-service location notification |

## 7. Known bugs

**None found that reproduce in code** — this audit ran the most comprehensive static pass yet
(the entire `apps/mobile/src` + `packages/domain/src` tree as one `tsc` invocation, 491 raw
errors) and traced every single one to the same root cause: this sandbox has no `node_modules`,
so `react`, `react-native`, `expo-router`, and every native module are unresolved, which cascades
into "children prop missing" and "property does not exist" errors throughout — including in
files from every earlier phase that were never touched in this audit. Two errors looked different
enough to investigate individually (a `Card` prop-spread inside a `.map()`, and `this.props`
inside the one class component in the codebase); both were confirmed to have the identical
missing-`react`-types root cause by reproducing the same error in untouched, already-shipped
code. **This is not a substitute for `pnpm typecheck`.** If that command, once runnable, reports
something not explainable by missing packages, that is a real bug this audit did not have the
tooling to catch.

## 8. Known limitations

- `health_samples` table exists in the Supabase schema (RLS-ready, proper unique constraints) and
  is **deliberately unused** — no health metric syncs to Supabase. Reasoning in `docs/health.md`.
- Deleting a food/water entry, or any synced row generally, has no remote-delete propagation.
- `activity_points` has no `client_id` column (unlike every other synced table); idempotent
  upload relies on the local row's id already being a real UUID.
- MapLibre dependency was never installed (section 6).
- `@kingstinct/react-native-healthkit`'s exact API for `queryStatisticsForQuantity`'s
  `discreteAverage` result field, and its workout-query function name/shape, are best-effort
  guesses — flagged inline with `NOTE:` comments at every such call site.
- `react-native-health-connect`'s exact field names for several record types (resting HR, HRV,
  distance, active calories, exercise sessions) are likewise best-effort guesses, flagged inline.
- iOS cannot report per-permission *read*-grant status by Apple's own design (not a bug) — the
  Health & Devices screen is honest about this rather than faking granularity Android can report.
- Only hydration reminders honor quiet hours.
- No watchOS companion app; Apple Watch support is indirect-via-HealthKit only.
- No third-party wearable (WHOOP/Fitbit/Garmin) is connected — all require external accounts/
  developer approval not available in this environment.

## 9. Unverified functionality

Essentially everything that requires `node_modules`, a device, a live Supabase project, or a real
Gemini key — which is most of the app's runtime behavior. Section 6's table marks each feature
individually; nothing in this project has been confirmed to run.

## 10. Required physical-device testing

Every HealthKit/Health Connect reader; background GPS with the screen locked; the Android
foreground-service notification; MapLibre tile rendering (once installed); camera barcode
scanning; local-notification delivery and tap-routing on both platforms; the AI coach chat screen's
keyboard behavior; the full nutrition/water CRUD UI; SQLite migration against a pre-existing
database file; general performance and memory behavior over a real session.

## 11. Required accounts

Apple Developer account · Google Play / Android developer account · Expo/EAS account · a
Supabase project · a Google AI Studio (Gemini) account · a map-tile provider account (your
choice — none is hardcoded) · optionally, later: WHOOP developer account, Fitbit developer
account, Garmin Connect Developer Program approval.

## 12. Required API credentials

`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public, safe to ship — RLS-protected),
`GEMINI_API_KEY` + optionally `GEMINI_MODEL` (Supabase Edge Function secret, server-only),
`EXPO_PUBLIC_MAP_TILE_STYLE_URL` (public, compiled into the app — use a key restricted to this
app if the provider embeds one in the URL). `SUPABASE_SERVICE_ROLE_KEY` is referenced only in
comments as "never put this in the app" — it is not used anywhere.

## 13. Required environment variables

See `.env.example` at the repo root — it is the authoritative, complete list, with inline
comments explaining each one. Nothing in this project reads an environment variable not listed
there.

## 14. Required future work

In rough dependency order: resolve a real MapLibre version and install it; run a real `pnpm
install`/`typecheck`/`test`/lint pass and fix whatever it finds; create the Supabase project and
apply the migration; create a development build and fix whatever HealthKit/Health Connect API
guesses turn out wrong; verify background GPS on real hardware; decide whether to wire
`health_samples` sync; decide whether to build delete-sync propagation; decide on a wearable
integration (if any) and build its OAuth flow server-side; build a watchOS companion app (if
desired — this is optional, standalone future work, not a correctness gap).

## 15. Build instructions

```bash
pnpm install                      # has never succeeded in any sandbox this project has been audited in
cp .env.example .env               # then fill in real values
pnpm typecheck
pnpm test
pnpm --filter @vitacore/mobile lint
cd apps/mobile
npx expo install expo-task-manager                       # version was guessed in Phase 3, never resolved
npx expo install @maplibre/maplibre-react-native          # never installed at all
npx expo prebuild                                          # or use EAS Build directly
eas build --profile development --platform ios
eas build --profile development --platform android
```

## 16. Test instructions

```bash
pnpm test                 # real Vitest, packages/domain — 8 test files, ~250 test cases total
                            # across all phases (never executed in this sandbox; see section 4 of
                            # every phase report for the hand-rolled-stand-in numbers instead,
                            # which are NOT the same thing as this command passing)
```
There is no mobile-app-level test runner configured (no Jest/Detox/etc.) — `apps/mobile/package.json`
has no `test` script. Adding one is listed in `docs/POST_HANDOFF_TODO.md`.

## 17. Store-readiness work still remaining

Privacy policy, Apple App Privacy nutrition labels, Android Data Safety form, background-location
usage justification (both stores), screenshots/store listing copy, TestFlight/internal-testing
pass, crash reporting, and a real device QA pass across the feature list in section 6. None of
this was started in this project.

## 18. Security/privacy notes

- No secret was found committed anywhere in the repository (checked for common API-key patterns,
  PEM private-key headers, and the literal string "service_role" — only comments/warning-message
  references exist, never a usage).
- Service-role key: never read or referenced anywhere in `apps/mobile`.
- Gemini key: server-only (`Deno.env.get` inside the Edge Function), never reaches the app.
- RLS: every Supabase table is scoped to `auth.uid()`; every mobile-side query uses the
  anon-key + user-JWT client, never a privileged one.
- No GPS coordinate, health value, or other sensitive field was found logged to the console
  anywhere in the app.
- Health data: nothing syncs to Supabase from Phases 1/8 (see section 8) — a conservative,
  deliberate choice, not an oversight.
- This is **not** a legal/compliance review. A real privacy-policy and legal pass, specific to
  wherever this ships, still needs to happen before any public release — nothing in this project
  claims HIPAA, GDPR, or App Store health-data-policy compliance.

## 19. Important architectural decisions

- **Local-first always**: SQLite is truth; Supabase is optional backup. Never reverse this.
- **Pure logic lives in `packages/domain`**, tested there; `apps/mobile` is I/O glue. This pattern
  was followed consistently for all 8 phases (sync decisions, geo/GPS rules, map math, reminder
  planning, nutrition validation, coach context-building, health normalization).
- **Platform-specific files** (`native.ios.ts` / `native.android.ts` / `native.ts`) are Metro's
  own resolution convention — never add an `if (Platform.OS === ...)` branch inside a shared file
  for something that belongs in one of these instead.
- **The coach-logic duplication** (section 2) is a known, documented compromise, not an accident.
- **No calorie target is computed server-side** for the AI coach, on purpose, to avoid two
  different numbers (app vs. coach) ever disagreeing.
- **Health samples are not synced**, on purpose, because nothing currently consumes them
  server-side and health data is sensitive by default.

## 20. Files that are particularly important

`apps/mobile/src/data/db.ts` (entire local schema + migration mechanism), `packages/domain/src/index.ts`
(the full public domain API surface), `supabase/migrations/0001_foundation.sql` (entire remote
schema), `apps/mobile/src/health/*` (the platform-adapter pattern every health reader follows),
`apps/mobile/src/data/sync.ts` + `packages/domain/src/sync.ts` (the outbox worker split), `.env.example`
(the complete, authoritative configuration surface).

## 21. Known technical debt

1. `coach.ts` / `coach-logic.ts` duplication (section 2) — worth eliminating once a real Supabase
   CLI is available to test a direct cross-package Deno import.
2. Eleven `package.json` dependencies (`expo-image`, `expo-crypto`, `expo-device`,
   `expo-glass-effect`, `@expo/ui`, `expo-symbols`, `expo-web-browser`, `expo-linking`,
   `expo-constants`, `expo-font`, `expo-system-ui`) have **no matching import anywhere in
   `src/`** as of this audit. They were not removed — some may be intentional near-term
   scaffolding from before this project's 8-phase handoff — but Cursor should decide, with the
   project owner, whether each is still wanted.
3. No mobile-app-level test runner exists; all testing infrastructure is in `packages/domain`
   only.
4. Several `NOTE:`-flagged best-guess API shapes in `apps/mobile/src/health/native.*.ts` need
   checking against the real installed package types the first time this builds.
5. `apps/mobile/package.json` pins `expo-task-manager` and omits `@maplibre/maplibre-react-native`
   entirely — both need a real `npx expo install` pass.
6. `activity_points`'s lack of a `client_id` column (section 8) is a minor schema asymmetry worth
   reconsidering if sync reliability issues ever show up there specifically.

## 22. Recommended order for Cursor's work

See `docs/CURSOR_START_HERE.md` for the step-by-step sequence, and `docs/POST_HANDOFF_TODO.md`
for the prioritized task list.
