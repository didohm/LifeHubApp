# Fix Notifications & Walk Service (root causes)

## Goal

Make every notification type (appointment, medication, task, bill, birthday, workout, daily reminder, walk fallback) reliably schedule, trigger, and display, and make the native walk service continuously produce accurate distance/steps into the UI and the foreground notification.

Root causes found by tracing the full chain (React → Capacitor bridge → plugin → `LocalNotifications`/`WalkService` Android code). No temporary workarounds; no duplicated logic.

---

## Part 1 — Notifications

### RC-N1 (systemic): Permission race + silent early-exit kills ALL notifications

`NotificationService.schedulePlans()` (src/lib/notifications.ts:331) gates every schedule behind `PermissionManager.ensurePermission("notification")`. Two defects:

1. **Concurrent `requestPermissions()` (Android 13+).** `PermissionManager.requestAllPermissions()` (startup, `src/routes/__root.tsx:275`) fires `request("notification")` asynchronously. `schedulePlans()` runs at the same time and calls `ensurePermission("notification")` → a **second** `LocalNotifications.requestPermissions()` while the first dialog is pending resolves as denied without showing a dialog. `PermissionManager.request()` then caches `denied` in `lifehub_permission_states`, `schedulePlans` returns `[]` and **every reminder type is silently skipped**. Because `resyncAll` only re-runs when Firestore lists change, reminders may never re-arm even after the user grants permission.
2. `resyncAll()` (data-context.tsx:490) swallows failures with `.catch(() => {})` — failed permission/scheduling is invisible.

Fix:
- Make permission requests **single-flight** in `src/lib/permissions.ts`: a module-level in-flight promise per permission name (`request()` and `requestUnknown()` await the same promise). The second caller waits for the first dialog to finish instead of racing it.
- `schedulePlans()` already runs `ensurePermission` itself; callers (route-level `scheduleX` wrappers in notifications-integration.ts) don't need to re-request. Keep the gate but make it **not persist a wrong state**: `saveState(name, "denied")` only when the OS truly denied (single-flight fixes the false-deny).
- When a permission transitions denied → granted, **re-run `resyncAll()`** immediately (see RC-N4).

### RC-N2: daylight reminder "fallback" notification can never display

`Notifications.scheduleWalkReminder()` schedules with `at: Date.now() + 1000`, but `buildSchema()` rejects anything below `MIN_LEAD_MS` (10 s) and returns `null`. The fallback has never displayed.

Fix:
- Extend `PlannedNotification` with `deliverNow?: boolean`, and in `buildSchema()` produce a notification **without** a `schedule` field when `deliverNow` is set (the Capacitor plugin posts schedule-less notifications immediately). Handle the ledger correctly (`at: Date.now()`, non-recurring).
- Use `deliverNow` in `Notifications.scheduleWalkNotification` instead of `at: +1000ms`.
- Keep `MIN_LEAD_MS` for ordinary one-shot reminders (it's correct there).

### RC-N3: walking default of one-shot reminders which are close to now

Items like "appointment starts soon", "bill due in 3 days" have `at` computed correctly. `MIN_LEAD_MS` is only for one-shots, so a reminder closer than 10 s in the future is correctly skipped (it would be in the past — Android rejects). No change needed besides keeping the lead.

### RC-N4: no re-sync when the app resumes / permission gets granted

`resyncAll` only runs on data-list changes. If the OS cancels alarms while away (common on OEM devices), or permission was denied then granted, reminders stay lost until the next data mutation.

Fix:
- In `src/lib/data-context.tsx`'s existing effect (and/or a new one in `__root`), subscribe to `AppState` (`"active"`) and call `Notifications.resyncAll({...})` once per foregrounding, debounced. This is idempotent by construction (cancel + re-schedule per prefix).
- After `PermissionManager.request()` returns granted for "notification", trigger the same re-sync via a small event/listener (e.g., `window.dispatchEvent(new CustomEvent("lifehub:permissions-changed"))`), which the data context listens to. Only one listener point — no duplicated scheduling logic.

### RC-N5: verification tooling

More diagnostics:
- `NotificationService.getDiagnostics()` already returns pending/tracked counts; also return `lanes` per type (build counts by key prefix from the ledger → visibility at one glance).
- Professionalization (do not skip): in `resyncAll`, log `at info` which prefixes were armed and which failed (`console.info`) in `resyncAll`/`schedulePlans`.

---

## Part 2 — Walk service (distance stuck at 0.00 km)

### RC-W1 (critical): service freeze after restart — the main reason distance stays 0.00

`android/.../WalkService.java` — `onStartCommand()` with a `null` intent (the documented process-death restore path, `stopWithTask=false` + `START_STICKY`):
- calls only `enterForeground()`;
- does NOT `acquireWakeLock()`, `registerLocationUpdates()`, `registerStepListeners()`, nor reset step/GPS marks.

After any process death (swipe app away, OOM, `kill`), the service resumes with the notification visible but **no location fixes and no step events** — distance (often 0.00) never advances, and the JS 4s poll mirrors exactly that.

Fix (in `onStartCommand`, `else if (isTracking)` branch):
```java
enterForeground();
acquireWakeLock();
registerLocationUpdates();
registerStepListeners();
// reset the step-motion marks so the GPS/step distance fallback restarts cleanly:
lastFixWallMs = 0L;
lastStepDistanceMark = 0L;
stepsAtLastMark = currentSteps;
publishUpdate();   // so the UI immediately learns the (restored) native state
```
Also guard: `stopForegroundTracking()` already clears prefs; leave as-is.

### RC-W2 (critical): JS→native 1-second push loop regresses the authoritative counters

`useWalk()` (`src/hooks/use-walk.ts:174-184`) pushes `{distance, steps, ...}` every second via `Notifications.updateWalkForeground()`. `WalkService.onStartCommand(ACTION_UPDATE)` **unconditionally overwrites** `currentDistanceKm/currentSteps/currentCalories` with those JS values (WalkService.java:197-201). The JS values are stale at session start (0), frozen by WebView throttling in background, and never authoritative — so the native service (and its notification) repeatedly reverts to stale/zero values, including the first seconds where it had already accumulated its first fixes.

Fix:
- **Remove the 1s push loop entirely** (`use-walk.ts`). The native service self-computes distance/steps/duration/calories and self-publishes every second (ticker → `updateNotification()` + `publishUpdate()`). Nothing is lost.
- Keep the JS→native updates only in `startWalk`, `resumeWalk` (as baselines — the existing `resumeService(baseline)` semantics) and not for progress.
- Make `ACTION_UPDATE` **monotonic-merge** anyway (WalkService.java): `currentDistanceKm = Math.max(currentDistanceKm, kmExtra)`, etc. Same for `ACTION_RESUME`. This prevents any possible future regression copy (belt+braces, exploits came from re-entrance).
- Delete now-unused surface: `Notifications.updateWalkData()` wrappers still exist; remove `updateWalkForeground` only if no other caller remains (keep the bridge method for future control but stop using it from the hook; simpler: keep the plugin method, remove the hook call).

### RC-W3: distance accretion thresholds penalize slow walking / suspend the step fallback

`WalkService.onLocationChanged`:
- `distMeters >= 1.2f` gate drops 2 s fixes under 1.2 m (e.g., casual walking at 0.6 m/s gets no GPS distance).
- The step-distance fallback (`applyStepBasedDistanceFallback`) bails whenever `lastLocation != null && now-lastFixWallMs < 8000` — a single good fix silences the step fallback for 8 s even when fixes come every few seconds.

Fix (conservative, keeps anti-glitch logic):
- Lower GPS delta to `>= 0.5f` (keep `<= 25f` cap) and keep the accuracy ≤ 30 m gate.
- Reduce fallback-suppression window to `< 4000` ms (equivalent to ≈2 fix intervals), so step-derived distance continues between sparse fixes.
- Keep `MAX_STEPS_PER_SECOND` rate limit and monotonic adds.

### RC-W4: "App resumed" catch-up

When the app resumes, JS relies on the 4 s poll; the native publishes in `handleOnResume` already (fine). Additionally, in `use-walk.ts` attach a `CapacitorApp.addListener("appStateChange", ...)`-equivalent (`@capacitor/app` `onResume`) — call `getStatus()` immediately (already have the poll; on resume it will hit within 4 s — acceptable, but add the immediate call to avoid the visible "0.00 for a few seconds" hole after resuming).

### RC-W6 (quality): keep native steps monotonic & fix stale fixes

- `onLocationChanged`: keep updating `lastFixWallMs` (use `System.currentTimeMillis()`); also ignore fixes if `location.getTime()` in the future; — already guarded; keep.
- `ACTION_START` from a **double-click** on "Start" resets counters. Guard `startService` in the plugin: if `WalkService.isTracking && !WalkService.paused`, ignore a new ACTION_START (idempotent) instead of zeroing. Also disable the Start button while `loading` (already) — plugin-level guard is the real fix.

---

## Files to change

1. `src/lib/permissions.ts` — single-flight permission requests (+ event on grant).
2. `src/lib/notifications.ts` — `deliveredNow` support in `buildSchema`; better diagnostics; log armed/skipped counts; schedulePlansError path.
3. `src/lib/notifications-integration.ts` — `scheduleWalkReminder` uses `deliverNow`; wire the grant event → `resyncAll`; keep `updateWalk*` bridge (or remove now-unused wrapper only, but not the plugin methods).
4. `src/lib/data-context.tsx` — AppState listener → debounce + `resyncAll` on foreground; listen to the grant event.
5. `src/hooks/use-walk.ts` — delete 1 s native push loop; immediate `getStatus()` on app resume.
6. `android/.../WalkService.java` — restart-path re-init; monotonic merges on ACTION_UPDATE/RESUME; 0.5 m delta; 4 s fallback window; guard `ACTION_START` double-start.
7. `android/.../WalkServicePlugin.java` — start guard if needed (or in service), keep API.

## Validation

- Type-check and build: `npm run build` (vite) must pass; `cd android && .\gradlew.bat assembleDebug` must compile.
- Blessing install from the new APK (fresh install to clear caches).
  - **Notifications**: add med, bill, appointment (offset 30 min), birthday, task (due today ~now+2h), workout; check each via `NotificationService.getPending()` — verify with the diagnostic hook. Daily reminder toggle in profile → verify it survives app restarts; change to a time 2-3 min ahead and observe n "fire".
  - **Permission race**: cold-start → observe a single notification prompt; schedule checks pass; then `resyncAll` succeeds (check `getPending` > 0).
  - **Walk**: Start walk outdoors — distance steps appear in UI AND the notification within ~5 s; dismiss/pause/resume continues; swipe app away (kill) mid-walk → reopen → distance keeps advancing (re-start(); this covers the frozen-restart bug). Indoor walk: steps + step-derived distance visible.
- Test edge: two rapid taps on Start — no counter reset (W6).