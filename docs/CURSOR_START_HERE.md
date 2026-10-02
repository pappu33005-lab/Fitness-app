You are taking over an existing project. Do not assume previous implementation claims are
correct. Every status in `docs/HANDOFF_TO_CURSOR.md` was written by an AI with no network
access, no device, and no way to run this project's real build/test commands — verify
everything yourself before trusting it.

For each step below, record one of: **PASS**, **FAIL**, **BLOCKED**, **UNVERIFIED**,
**REQUIRES DEVICE**, **REQUIRES EXTERNAL SERVICE**. Don't skip a step because an earlier
report said it would work.

## Recorded on 1 October 2026

- STEP 1 `pnpm install`: **PASS**
- STEP 2 `pnpm typecheck`: **PASS** after fixes (the first run, before those fixes, also passed)
- STEP 3 `pnpm test`: **PASS** (175 tests)
- STEP 4 lint: **FAIL** on the first run (4 errors). **PASS** after the fixes.
- STEP 5 MapLibre: **installed** `@maplibre/maplibre-react-native@11.4.0` and the config plugin. Tile rendering remains **REQUIRES DEVICE** / a development build.
- STEP 6 live Supabase: **REQUIRES EXTERNAL SERVICE**
- STEP 7 EAS development builds: **BLOCKED** (no Apple, Google Play, or EAS credentials in this environment)
- STEPS 8–9 physical devices: **REQUIRES DEVICE**

### Auth repair before device testing (same day)

Password fields were cleartext (`secureTextEntry` missing). Sign-out was absent from the Account screen despite the auth checklist. Both were fixed. Re-ran typecheck, test, lint, and expo-doctor — all **PASS**. Live sign-in/sign-out against a Supabase project remains **REQUIRES EXTERNAL SERVICE** / **REQUIRES DEVICE**.

## STEP 1 — Install dependencies
```
pnpm install
```
This has never succeeded in any environment this project has been audited in (no registry
access in the sandbox). It may just work for you. If it doesn't, read the actual error —
don't assume it's the same cause.

## STEP 2 — Typecheck
```
pnpm typecheck
```
Expect real errors the first time this runs for real — in particular, check every file with a
`NOTE:` comment in `apps/mobile/src/health/native.ios.ts` and `native.android.ts` first; those
are the places most likely to have a wrong field/function name, by design (they were written
from documented API shape, never checked against the installed package's real types).

## STEP 3 — Run tests
```
pnpm test
```
This is `packages/domain`'s real Vitest suite — 8 files, no mocks, no device needed. If this
fails, that is a real bug in the pure logic layer; fix it before touching anything that depends
on it. A hand-rolled stand-in runner was used throughout this project's development to get
*some* signal without Vitest available — that is not the same thing as this command passing,
and its results (quoted in old phase reports) should not be treated as equivalent to a real
Vitest run.

## STEP 4 — Run lint
```
pnpm --filter @vitacore/mobile lint
```

## STEP 5 — Inspect Expo configuration
Read `apps/mobile/app.config.ts` in full. Cross-check every plugin listed against what's
actually in `package.json` — `@maplibre/maplibre-react-native` is used in code
(`apps/mobile/src/components/route-map/TileMap.tsx`) but is **not** in `package.json` and has
**no** config plugin entry yet. Install it, then decide whether its docs require a plugin entry
for the version you resolve, and add one only if they say so.

## STEP 6 — Inspect Supabase configuration
Read `supabase/migrations/0001_foundation.sql` end to end before creating the project. Create a
real Supabase project, apply the migration, and confirm RLS behaves as every table's policy
claims (one user cannot read another's rows) — don't just trust the SQL by inspection.

## STEP 7 — Build development version
```
cd apps/mobile
npx expo install expo-task-manager
npx expo install @maplibre/maplibre-react-native
eas build --profile development --platform ios
eas build --profile development --platform android
```
Needs Apple Developer, Google Play, and EAS accounts/credentials this environment never had.

## STEP 8 — Test iOS
Work through every row marked `REQUIRES PHYSICAL DEVICE` in `docs/HANDOFF_TO_CURSOR.md` section 6
for iOS specifically: HealthKit permission flow and every reader (steps, sleep, resting HR, HRV,
distance, active energy, workouts — the last one is the least certain, check it first), background
GPS with the screen locked, barcode camera scan, local notification delivery and tap routing,
MapLibre tile rendering, the AI coach chat screen's keyboard behavior.

## STEP 9 — Test Android
The same list for Health Connect, plus: the Android foreground-service notification for
background GPS (distinct from the three reminder notification channels — don't confuse them),
the `POST_NOTIFICATIONS` permission prompt (API 33+), Health Connect's per-permission granted/
denied status (this one Android *can* report accurately, unlike iOS — see `docs/health.md`).

## STEP 10 — Audit every major feature
Walk `docs/HANDOFF_TO_CURSOR.md` section 6 top to bottom. For each row, actually exercise the
feature and update its status — don't leave a stale "UNVERIFIED" once you've verified it, and
don't leave a stale "IMPLEMENTED" if it turns out broken.

## STEP 11 — Fix failures
Start with anything Step 2/3 found (real typecheck/test failures) before device-only bugs — a
logic bug in `packages/domain` likely affects more than one feature.

## STEP 12 — Regression test
After any fix, re-run Steps 2–4 and re-check any feature that shares code with what you changed.
`packages/domain` functions are reused across screens on purpose (see "Important architectural
decisions" in the handoff doc) — a fix in one place can affect several features.

## STEP 13 — Production preparation
Resolve every item in `docs/POST_HANDOFF_TODO.md`'s CRITICAL and HIGH sections before
considering this release-track work.

## STEP 14 — Store-readiness audit
Privacy policy, App Privacy / Data Safety forms, background-location justification for both
stores, screenshots, and a full device QA pass. None of this exists yet — see
`docs/HANDOFF_TO_CURSOR.md` section 17.
