# Reminder notifications

Status: implemented in code. Not run on any device. No dependency was added — `expo-notifications`
(`~57.0.21`) was already in `package.json` and already registered in `app.config.ts`'s plugins,
just unused until now.

## What exists

Three reminder types, all local, all optional, all off by default:

- **Workout reminders.** Chosen days of the week, one time. Repeats weekly.
- **Hydration reminders.** A fixed interval (60/90/120/180 min) inside a daytime window.
  Skipped for the rest of a day once the water goal (from the profile) is reached.
- **Daily goal reminders.** One time a day. Only sent when a real, measured goal (steps or
  water, from the profile and today's logged/measured data) is not yet met. Never invents a
  number — the notification text never states a figure, since the app cannot compute one from a
  fired notification alone.

There is no push, no server, no account requirement. Everything is scheduled on the device with
`expo-notifications`' local scheduling API.

## What does not exist

**No smart alarm.** Phase 0's audit and later phases said a smart alarm architecture would be
prepared, but a smart alarm needs to watch overnight sleep signal and choose a wake moment
inside a window — nothing in this app does that, and this phase does not add it either. A
fixed-time goal reminder is not a substitute and is not described as one anywhere in the UI.

**No goal/routine notifications beyond steps and water.** The data model has no user-created
goals or routines beyond the profile's step and hydration targets, so nothing further was built
there. Sleep and workout targets exist on the profile but are not part of the current reminder
set (see Verification).

## Architecture

- **`packages/domain/src/reminders.ts`** — pure planning logic, no notification library, no
  storage, no device clock (the caller passes `now`). Given settings and today's goal progress,
  it decides which notifications should exist right now, with stable identifiers so re-planning
  an unchanged schedule touches nothing. This is what `reminders.test.ts` exercises.
- **`apps/mobile/src/notifications/scheduler.ts`** — the only file that calls
  `expo-notifications`. Loads/saves settings (one JSON blob in the existing `preferences`
  table), reads permission state, diffs the desired plan against what the OS reports as already
  scheduled, cancels what changed, schedules the rest.
- **`apps/mobile/src/notifications/goals.ts`** — reads today's real step count (via the Phase 1
  health readers) and today's logged water (via the existing `waterForDay`), against the
  profile's targets. This is the only source of "is a goal done".
- **`apps/mobile/src/app/reminders.tsx`** — the settings screen.
- **`apps/mobile/src/app/_layout.tsx`** — configures notification channels once at launch, and
  re-syncs the schedule on launch and every time the app returns to the foreground (this is how
  a goal reminder gets dropped once the goal is met — local notifications can't run code when
  they fire, so re-planning on return is what removes a now-unneeded one). It also listens for a
  tapped notification and opens the screen named in its data (`/`, `/workout`, or `/nutrition`
  only — nothing else is accepted).

## How schedules are stored

One JSON object in the existing local `preferences` table (`reminder_settings`), the same table
Phase 3 already uses for the active-recording marker. A second small entry
(`reminder_notification_signatures`) tracks what was last scheduled, so re-syncing can tell an
unchanged reminder from a changed one without re-reading every field from the OS each time.
Reading corrupt or outdated stored settings falls back to defaults field by field rather than
crashing or discarding the rest.

## Permissions

- Requested only when someone turns a reminder on, never at launch and never automatically.
- If permission is denied but can still be asked again, turning a reminder on asks again — this
  is the one exception to "never spam the prompt", and it only happens on a deliberate action.
- If permission is permanently blocked, the toggle refuses to turn on and the settings screen
  states plainly that notifications are off in system settings.
- No reminder is ever scheduled without granted permission, so turning permission off after the
  fact and back on cannot leave a stale hidden schedule — the next sync (launch or foreground
  return) reconciles it from the real settings.

## Android

- Three notification channels: workout, hydration, goals — separate from the Phase 3 foreground
  location-tracking notification, which is a different OS mechanism (an ongoing service
  notification, not a reminder) and is untouched by this phase.
- `expo-notifications`' Android permission flow (`POST_NOTIFICATIONS` on API 33+) is handled by
  the library; this phase adds no manifest changes.

## iOS

- Local scheduled notifications only (`UNCalendarNotificationTrigger` /
  `UNTimeIntervalNotificationTrigger` under the hood, via `expo-notifications`). No push
  entitlement, no APNs, no push backend — this project has neither, and none is claimed.

## Reliability

- Every scheduled notification has a stable identifier (`vitacore.workout.<weekday>`,
  `vitacore.hydration.<date>.<time>`, `vitacore.goal.<date>`), so re-scheduling the same plan
  never creates a duplicate.
- Cancellation only ever touches identifiers with the `vitacore.` prefix — a notification from
  anywhere else on the device is never cancelled.
- Disabling a reminder removes it from the plan, which the next sync turns into a cancellation.
- Weekly workout reminders use a native repeating trigger, so they survive an app restart without
  VitaCore needing to re-schedule them itself. Date-based hydration/goal reminders are re-planned
  on every launch and foreground return, which also covers picking up again after a restart.

## Limitations

- Hydration and goal reminders are date-based, not truly recurring, so they depend on the app
  being opened at least occasionally (launch or foreground return) to keep the next couple of
  days populated. Workout reminders do not have this limitation.
- Only hydration reminders honor quiet hours today. Workout and goal reminders use their own
  single configured time, so quiet hours do not need to be consulted for them.
- Quiet hours are a reminder-only setting entered on this screen. The app has no bedtime/wake
  setting to derive them from.
- The device's local timezone is used throughout (`new Date()` and local calendar fields); no
  timezone is hardcoded. A device timezone change is picked up the next time the schedule is
  synced, not instantly.

## How to test this without a device

Run `pnpm test`. The pure planning logic (`packages/domain/src/reminders.test.ts`) needs no
device, network, or notification library, and is what should be checked first. What it cannot
tell you: whether `expo-notifications`' real API matches the calls in `scheduler.ts`, whether a
scheduled notification actually fires and looks right, whether tapping it opens the right screen,
or whether Android channels appear correctly. Those need a physical device.

## Verified and unverified

Executed here: 28 checks in `reminders.test.ts` (enabling/disabling, duplicate prevention,
cancellation, schedule replacement on change, goal-completed behavior, quiet hours including a
midnight-crossing and a daytime window, invalid schedules, permission-state mapping, settings
persistence and repair of corrupt data), run under `ts-node` with a small stand-in for Vitest —
not Vitest itself.

Not run: `pnpm test` (real Vitest), `pnpm typecheck`, lint, and everything involving
`expo-notifications` itself.

Needs a device: permission prompts (both platforms), a scheduled notification actually
delivering, notification tap opening the right screen, Android channel behavior, and whether
weekly triggers survive a real app/OS restart.
