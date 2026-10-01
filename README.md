# VitaCore

A native iOS and Android app for fitness, nutrition, sleep, and recovery. The product name lives in `packages/brand/brand.json`. The browser is a development preview of screens. It is not a shipping client. See `docs/platforms.md`.

Phase 1 is the foundation: Expo SDK 57, the design system, local guest data, native health adapters, and a Supabase schema. It does not invent health measurements.

## Requirements

- Node.js 22.13 or newer. The verification machine used Node 22.14.0. Node 24 is the Active LTS named in `docs/versions.md`; this repo does not require it.
- pnpm 12.6.0 (`packageManager` in the root `package.json`)

## iOS and Android

This app does not run in Expo Go. HealthKit, Health Connect, background location, haptics, and lock-screen audio need a development build. That needs an Expo account plus Apple Developer or Google Play credentials. Those accounts are not configured.

```bash
pnpm install
cp .env.example .env
pnpm --filter @vitacore/mobile start
```

When the accounts exist, install EAS CLI 24 and create a development build from `apps/mobile`. iOS uses `pnpm --filter @vitacore/mobile ios` only when Xcode and a simulator or device are available. Android uses `pnpm --filter @vitacore/mobile android` only when a device or emulator is available.

## Browser preview

```bash
pnpm --filter @vitacore/mobile web
```

Open the printed localhost URL to review layout, onboarding, and empty states. The preview does not read HealthKit or Health Connect, does not start a GPS session, and does not scan barcodes. Those actions stay on the native builds.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm --filter @vitacore/mobile lint
```

## What is real

- Guest profile in SQLite on iOS and Android, in a file named `vitacore.db`, before an account exists. The browser preview keeps a temporary IndexedDB snapshot so screens can be clicked through. That snapshot is not the production database.
- Calorie estimate from Mifflin–St Jeor, labeled as an estimate. It is not calculated under 18.
- Sleep and recovery scores that stay blank when inputs are missing.
- Step and sleep readers for HealthKit and Health Connect, plus the phone pedometer as a separate labeled source.
- GPS recording on iOS and Android, with distance, pace, splits, and elevation when the device reports it. The browser preview does not start that session.
- Open Food Facts search and barcode lookup.
- Procedural white, pink, brown, fan, and air noise.
- Original exercise text. No licensed video.

## What is not connected

- Supabase, until `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set. The service role key never goes in the app.
- The coach, until you set `GEMINI_API_KEY` as an Edge Function secret and deploy `ai-coach`. The default model id is `gemini-3.8-flash`. Google's 1 Oct 2026 docs list paid introductory pricing for that model, not a confirmed free quota. `GEMINI_MODEL` can override the id. The app does not enable billing and does not hold the key. Multi-turn history is implemented in code and has not been run against a live project. See `docs/coach.md`.
- Base-map tiles, until a development build includes `@maplibre/maplibre-react-native` 11.4.0 (already in `package.json` and `app.config.ts`) and `EXPO_PUBLIC_MAP_TILE_STYLE_URL` points at an HTTPS MapLibre style you have licensed. Routes are always drawn as an outline from the stored points. Tile rendering has not been run on a device. `expo-maps` was not added because it pulls Google Maps onto Android. See `docs/maps.md`.
- Rain, ocean, forest, and spoken stories. Those slots are empty on purpose.
- Snoring classification. Consent and retention rules exist. No model is bundled, and the microphone is not requested.
- Direct WHOOP, Fitbit, and Garmin APIs. New Garmin developer access is paused, and the legacy Fitbit Web API is shutting down in favor of the Google Health API, which needs a restricted-scope review; WHOOP requires its own registered developer app and a paying WHOOP member. None of this was independently re-verified this phase — see `docs/wearables.md`. Data appears only if the person already syncs that device into Apple Health or Health Connect.
- Apple Watch as its own app. Watch samples show up only when HealthKit already has them. A `health.tsx` screen now shows real connection status for Apple Health/Health Connect plus this wearable picture — see `docs/health.md`.

See `docs/versions.md` for the exact dependency choices.
