# Platforms

The shipping product is a native iOS app and a native Android app. A browser session is a development preview of layout and copy. It is not a third production client, and it does not substitute for a native API.

## 1. Browser preview

Used for UI review and for checks that do not need a phone: onboarding, theme, empty states, Open Food Facts search, and the procedural-noise screen.

The preview reports a native capability as unavailable. It does not invent steps, sleep stages, heart rate, routes, or snoring.

| Preview behavior | Production counterpart |
| --- | --- |
| In-memory SQLite plus an IndexedDB snapshot | `vitacore.db` on the device |
| Health readers return unavailable | `native.ios.ts` and `native.android.ts` |
| Record does not start a location watch | Core Location and the Android location APIs, including background permission |
| Routes are drawn as a tile-free outline only | Outline, plus a MapLibre base map when configured |
| Generated noise can play from a blob URL | Cache file and the native audio session |
| Haptics do nothing | `expo-haptics` on device |

`app.config.ts` includes a `web` block so Expo can serve that preview. EAS production profiles build iOS and Android.

## 2. iOS

Development and release builds, not Expo Go.

| Capability | Implementation | Still required before it can be tested |
| --- | --- | --- |
| Steps, sleep, heart rate, HRV, distance, active energy, workouts (read-only) | HealthKit in `src/health/native.ios.ts`, then the pedometer as a separate labeled source for steps only | Apple Developer account, a development build, a device, and the Health permission. Distance/active-energy/workouts added this phase, unverified — see `docs/health.md` |
| Apple Watch | Not an app in this repo. Samples appear only when HealthKit already has them | A later Swift/SwiftUI watch target. `startWatchApp` is not called |
| Background GPS | `expo-location` background updates plus `expo-task-manager`; location background mode in the iOS config | A development build and the Always location permission. Unverified on a device. |
| Map | Route outline from stored points; MapLibre 11.4 base map when configured | A rebuilt development build and a licensed HTTPS style URL. The package and config plugin are installed. Unverified on a device. See `docs/maps.md` |
| Microphone / snoring | Architecture only. The microphone permission is not requested | An on-device model, then a device test |
| Sleep audio | Procedural WAV written to the cache, background audio mode | A development build for lock-screen playback |
| Notifications | Workout, hydration, and goal reminders (`expo-notifications`, already a dependency). Local only, no push backend. A true smart alarm is not built — see `docs/notifications.md` | A development build. Unverified on a device |

## 3. Android

Development and release builds, not Expo Go.

| Capability | Implementation | Still required before it can be tested |
| --- | --- | --- |
| Steps, sleep, heart rate, HRV, distance, active energy, workouts (read-only) | Health Connect in `src/health/native.android.ts`, then the pedometer as a separate labeled source for steps only | A development build, Android 9+ with the Health Connect app, and Play Console health declaration later. Distance/active-energy/workouts added this phase, unverified — see `docs/health.md` |
| Background GPS | `expo-location` background updates plus `expo-task-manager`, with a foreground-service notification | A development build and the background location permission. Unverified on a device. |
| Map | Route outline from stored points; MapLibre 11.4 base map when configured | A rebuilt development build and a licensed HTTPS style URL. The package and config plugin are installed. Google Maps is not a dependency. Unverified on a device. See `docs/maps.md` |
| Wearables | No WHOOP, Fitbit, or Garmin client | Official OAuth API access and a registered developer app for WHOOP/Fitbit; Garmin additionally requires non-self-serve program approval. Data can still arrive through Health Connect if a device's own app writes there. See `docs/wearables.md` |
| Microphone / snoring | Same on-device design as iOS. Permission is not requested | A model and a device test |
| Sleep audio, reminder notifications, haptics | Native modules, same boundary as iOS. Reminder channels are separate from the Phase 3 foreground-service location notification | A development build. Unverified on a device |

`src/platform/capabilities.ts` is the flag list screens use so a browser session cannot call these APIs.
