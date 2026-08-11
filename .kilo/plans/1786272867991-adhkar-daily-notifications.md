# Adhkar automatic daily notifications

## Goal

In the Adhkar (Zikr) service, arm two always-on daily local notifications on Android:

- **Morning adhkar** — every day at 06:00 local time
- **Evening adhkar** — every day at 12:00 (noon) local time

Requirements: reliable daily recurrence, survives app restart and device reboot, respects the
user's notification permission (never nags) and the device's local timezone.

## Context (verified in codebase)

- Scheduling infra already exists and is battle-tested: `NotificationService.schedulePlans`
  (`src/lib/notifications.ts`) supports daily recurrence via `on: { hour, minute, second: 0 }`,
  sets `allowWhileIdle: true` (fires in Doze), uses a localStorage ledger for idempotent
  cancel-then-rearm (repeated calls never duplicate), and stable 31-bit ids via
  `notificationId(key)`.
- The Capacitor local-notifications plugin already re-arms pending notifications after device
  reboot (`LocalNotificationRestoreReceiver`, `RECEIVE_BOOT_COMPLETED` +
  `LOCKED_BOOT_COMPLETED` — confirmed in
  `node_modules/@capacitor/local-notifications/android/` merged manifest). Recurring
  `on`-schedules fire in device-local time via Android AlarmManager; DST/timezone changes are
  handled by the OS.
- The app's resync flow (`resyncNotifications` in `src/lib/data-context.tsx`) runs after login,
  on every foreground, and on notification-permission grant (`PERMISSIONS_CHANGED_EVENT`), and
  routes into `Notifications.resyncAll()` (when the account has data) or
  `Notifications.resyncRecurringReminders()` (zero-data accounts) in
  `src/lib/notifications-integration.ts`. Both branches are gated on `userId`, which is fine —
  every route including `/adhkar` is behind auth (`MainContentGate`).
- Zikr constants already exist in `src/lib/azkar.ts`: `MORNING_CATEGORY = "أذكار الصباح"`,
  `EVENING_CATEGORY = "أذكار المساء"`; the app already considers morning "due" until noon
  (`getDueContext()`), matching the 12:00 evening boundary.
- Notification taps already navigate via `useNotifications()` (`src/hooks/use-notifications.ts`),
  warm and cold start — no new tap-handling code needed.

## Decisions (confirmed with user)

1. **Always-on, no toggle** — schedule automatically when logged in; the user can still silence
   them by revoking notification permission in Android Settings. No settings UI.
2. **Bilingual, English-led copy** — titles in English, Arabic category name in the body.

## Implementation tasks

1. **`src/lib/notifications-integration.ts`** — add two planner constants:
   - `ADHKAR_MORNING_HOUR = 6`, `ADHKAR_MORNING_MINUTE = 0`
   - `ADHKAR_EVENING_HOUR = 12`, `ADHKAR_EVENING_MINUTE = 0`
2. **`src/lib/notifications-integration.ts`** — add `resyncAzkarReminders()` method on the
   `Notifications` object:
   ```ts
   async resyncAzkarReminders() {
     if (!isNative()) return;
     // Respect permission WITHOUT prompting (unlike ensurePermission, which
     // re-shows the OS dialog). The one-time install prompt already happened
     // in RootComponent; granting later triggers PERMISSIONS_CHANGED_EVENT,
     // which re-runs this resync.
     try {
       const { PermissionManager } = await import("./permissions");
       if (!(await PermissionManager.check("notification"))) return;
     } catch { return; }
     await NotificationService.schedulePlans([
       {
         key: "azkar_morning",
         title: "Morning Adhkar",
         body: "It's time for today's morning adhkar — أذكار الصباح",
         on: { hour: ADHKAR_MORNING_HOUR, minute: ADHKAR_MORNING_MINUTE, second: 0 },
         channelId: REMINDER_CHANNEL,
         extra: { screen: "/adhkar" },
       },
       {
         key: "azkar_evening",
         title: "Evening Adhkar",
         body: "It's time for today's evening adhkar — أذكار المساء",
         on: { hour: ADHKAR_EVENING_HOUR, minute: ADHKAR_EVENING_MINUTE, second: 0 },
         channelId: REMINDER_CHANNEL,
         extra: { screen: "/adhkar" },
       },
     ]);
   }
   ```
   `schedulePlans` is idempotent (cancels ids first), so repeated runs on login/foreground/
   permission-grant are safe; no `reconcile`/prefix-registry entry is needed — there is no user
   data driving these, they are static plans.
3. **`src/lib/notifications-integration.ts`** — call `resyncAzkarReminders()` from
   `resyncAll()` (wrapped in its own try/catch, after `resyncRecurringReminders()`).
4. **`src/lib/data-context.tsx`** — in the `else` (no data) branch of `resyncNotifications`
   (line ~500), also call `void Notifications.resyncAzkarReminders().catch(() => {})`
   alongside `resyncRecurringReminders()` so zero-data accounts arm the adhkar reminders too.
   The `hasData` branch already reaches them via `resyncAll`.

No changes to `src/lib/notifications.ts`, `src/lib/permissions.ts`, `src/lib/azkar.ts`, or the
`/adhkar` route (works without login anyway but the whole app is auth-gated already).

## Why this satisfies each requirement

- **Reliable daily recurrence**: recurring `on: {hour, minute}` schedules via AlarmManager with
  `allowWhileIdle` — fires even in Doze/battery saver, repeats every day until cancelled.
- **Survives app restart**: alarms live in the OS, not the app process; on launch the wake-up
  resync re-arms anything the OS dropped.
- **Survives device reboot**: the plugin's `LocalNotificationRestoreReceiver` re-arms survived
  ALARM_RTC alarms; the login resync is a second backstop.
- **Respects permission**: gated by `PermissionManager.check()` — no dialog from the automatic
  flow; revoked → silently not armed; grant later → `PERMISSIONS_CHANGED_EVENT` resync arms them.
- **Local timezone**: `on: {hour, minute}` is evaluated in device-local time by the OS.

## Risks / notes

- `schedulePlans` internally calls `ensurePermission("notification")`, which prompts — the
  `check()` gate above is mandatory so the automatic flow never pops a dialog on foreground
  when permission is denied.
- Keys are `azkar_morning` / `azkar_evening` — unique vs. existing prefixes (`apt_`, `med_`,
  `daily_reminder`, …); they stay armed across logout (same as the existing daily check-in —
  consistent, no change).
- If the user changes the device timezone, Android re-evaluates the alarms; the foreground
  resync (cancel + re-arm) additionally refreshes them.

## Validation

1. `npm run lint` passes; `npx tsc --noEmit` passes.
2. `npm run apk:android` builds; install the APK, log in, grant notification permission.
3. Confirm via `NotificationService.getDiagnostics()` (or a temporary console read of
   `getPending()`) that `azkar_morning` + `azkar_evening` are armed with
   `recurring: true` in the ledger.
4. Set device timezone to e.g. Asia/Tokyo (or change device clock just before 06:00 / 12:00
   local) and verify each notification fires once per day at 06:00 and 12:00 local.
5. Reboot the device → both alarms still present in `getPending()` after reboot.
6. Deny notification permission → after app restart, no permission prompt is shown again and
   `getPending()` is empty; re-grant → resync arms both alarms without user action.