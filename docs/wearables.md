# Third-party wearables: what is actually possible

Status: research only, no code in this phase connects to any of these. Everything below is
from general knowledge of each platform's publicly documented developer program, not
independently re-verified against their current terms in this session (no network access here).
**Re-check each provider's current developer site before relying on any of this** — API terms,
approval requirements, and pricing change.

None of these were scraped, and none were bypassed. If a provider requires OAuth, developer
approval, or a paid account, that requirement is treated as real and is not worked around.

## WHOOP

| Question | Answer |
| --- | --- |
| Official API? | Yes — the WHOOP API (developer platform), OAuth 2.0. |
| Developer approval needed? | Registering an app (client id/secret) is the normal path; broader scopes/production use may need review. |
| User requirement | An active WHOOP membership (paid hardware + subscription) — without one, there is no WHOOP data to read regardless of integration. |
| What data | Recovery, sleep, workout, and cycle (strain) data, at the granularity WHOOP's API exposes it. |
| Can be built now? | The OAuth plumbing could be built now (a `client_id`/`client_secret`/redirect flow, same shape as Supabase auth's own OAuth support), but there is no WHOOP developer app registered for this project, and registering one is an account-owner decision, not something to do silently in code. **Not implemented.** |
| What's needed later | Register a WHOOP developer app, obtain a client id/secret, store them as Supabase Edge Function secrets (never in the mobile app — same rule as the Gemini key), build a token-exchange Edge Function, and a sync job to pull and normalize the data into `NormalizedHealthSample`. |

## Fitbit

| Question | Answer |
| --- | --- |
| Official API? | Yes — the Fitbit Web API, OAuth 2.0, registered at dev.fitbit.com. |
| Developer approval needed? | Registering a client id is normally self-serve for personal/development use; broader/commercial use has had tightening restrictions under Google's ownership of Fitbit. |
| User requirement | A Fitbit account; most step/heart-rate/sleep data is available on the free tier. |
| What data | Steps, heart rate, sleep, activity — similar shape to what this project already reads from Apple Health/Health Connect. |
| A relevant shortcut on Android | Some Fitbit devices' companion app already writes into Health Connect. If that's true for a given phone, this project's existing Health Connect reader (`apps/mobile/src/health/native.android.ts`) already sees that data with **no separate Fitbit integration needed**. This should be confirmed on a real device rather than assumed. |
| Can be built now? | Not in this phase — same reasoning as WHOOP: needs a registered developer app and a deliberate decision to add OAuth infrastructure. |
| What's needed later | A registered Fitbit app (client id), an Edge Function OAuth flow, and a normalization step feeding the same `NormalizedHealthSample` shape. |

## Garmin

| Question | Answer |
| --- | --- |
| Official API? | Yes — the Garmin Connect Developer Program (Health API / Activity API). |
| Developer approval needed? | **Yes, and it is not self-serve.** Access has historically required applying to and being accepted into Garmin's partner program, aimed more at enterprise/health-platform integrations than individual indie apps. Approval is not guaranteed and can take a meaningful amount of time. |
| User requirement | A Garmin account with a paired device. |
| What data | Activity, heart rate, sleep, stress/body-battery style metrics, depending on the granted scope. |
| Can be built now? | No — there is nothing to build against without first being accepted into the program, which is a business/account-owner step outside what code can do. |
| What's needed later | Apply to Garmin's developer program, wait for approval, then build the same OAuth + normalization pattern as above once (and if) access is granted. |

## Apple Watch

Investigated first, as instructed, against the existing iOS architecture.

- Apple Watch has **no separate public network API** for a phone-only app to pull data from
  directly. The sanctioned path — and the one this project already uses — is: the Watch writes
  its measurements into Apple Health on the paired iPhone, and any iOS app with HealthKit read
  permission reads them from there. `apps/mobile/src/health/native.ios.ts` already does exactly
  this for steps, sleep, heart rate, and HRV, and this phase extends it to distance, active
  energy, and workouts (see `docs/health.md`). **No separate Apple Watch integration exists or
  is needed for that data.**
- A **watchOS companion app** (a second build target that actually runs on the watch — for
  example, to start a VitaCore workout from the wrist, or show live stats there) is a materially
  different, much larger project: it needs its own Xcode target, its own entitlements, and
  either native Swift/SwiftUI work or an Expo community module for watchOS (none of which is
  installed in this project). This is **not implemented and not started** in this phase.
  Deferred, not faked — `copy.watchLater` in the app already states this plainly to the person
  using the app, and this phase did not change that message because it is still accurate.

## Summary

Nothing in this phase claims a wearable is "connected" unless it genuinely is. Today, the only
real connections are Apple Health and Health Connect (Phases 1 and 8). The `apps/mobile/src/app/health.tsx`
screen states the above for WHOOP/Fitbit/Garmin/Apple Watch as plain status text — no button that
does nothing, because there is nothing for a button to do yet.
