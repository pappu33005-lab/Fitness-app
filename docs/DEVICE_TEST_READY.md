# Device testing readiness

Status after the Cursor verification pass (1 Oct 2026). Static checks pass. Nothing below is a claim that a feature worked on a phone.

## Already verified in this environment

| Check | Result |
| --- | --- |
| `pnpm install` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS (175) |
| `pnpm --filter @vitacore/mobile lint` | PASS |
| `npx expo-doctor` | PASS (21/21) |
| `npx expo config --type public` | PASS |
| HealthKit/Health Connect **types** vs installed packages | PASS (type-level only) |
| MapLibre 11.4 dependency + config plugin + TileMap v11 API | PASS (type-level / config only) |
| Coach logic bodies (`coach.ts` / `coach-logic.ts`) | PASS (identical executable body) |
| Secrets in the repo | PASS (none found) |

## Blocked here

| Item | Why |
| --- | --- |
| `eas build` | No Apple / Google Play / EAS credentials |
| Live Supabase RLS proof | No project |
| Live Gemini coach message | No `GEMINI_API_KEY` / no deployed function |

## Exact next steps for real-device testing

1. Copy `.env.example` to `.env` (repo root) and also to `apps/mobile/.env`, then set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Optionally set `EXPO_PUBLIC_MAP_TILE_STYLE_URL`. Expo loads env from `apps/mobile`.
2. Create a Supabase project, apply `supabase/migrations/0001_foundation.sql` and `0002_completion_audit.sql`, and deploy `supabase/functions/ai-coach` with `GEMINI_API_KEY`.
3. From `apps/mobile`, create development builds:
   - `eas build --profile development --platform ios`
   - `eas build --profile development --platform android`
4. Install each build on a physical phone. Do **not** use Expo Go.
5. Run the iOS and Android checklists in `docs/CURSOR_START_HERE.md` steps 8–9.

Known gaps that device testing will encounter unless decided first: MapLibre tiles need a development build and a style URL; HealthKit/Health Connect and background GPS need physical devices.
