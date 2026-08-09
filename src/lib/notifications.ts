import {
  LocalNotifications,
  type ActionPerformed,
  type LocalNotificationSchema,
  type ScheduleOn,
} from "@capacitor/local-notifications";
import { Capacitor } from "@capacitor/core";

/* ────────────────────────────────────────────────────────────────────────────
 * Channels
 *
 * Android notification channels are IMMUTABLE once created: importance, sound
 * and vibration can never be changed by the app afterwards. The v1 channels
 * shipped with `sound: "default"`, which resolves to `res/raw/default` — a
 * resource that does not exist — so the OS attached a broken sound URI and
 * every reminder was delivered SILENTLY forever.
 *
 * The only correct production fix is to publish new, versioned channel ids and
 * delete the broken legacy ones (see `deleteLegacyChannels`).
 * ──────────────────────────────────────────────────────────────────────────── */

/** High-importance channel: appointments, birthdays, medications, bills, tasks. */
export const REMINDER_CHANNEL = "lifehub_reminders_v2";
/** Low-importance channel used only by the JS walk fallback notification. */
export const WALK_FALLBACK_CHANNEL = "lifehub_walk_fallback_v2";

/** Broken/older channels that must be removed from the OS settings UI. */
export const LEGACY_CHANNELS = ["lifehub_reminders", "lifehub_walk"];

/** Must exist in `android/app/src/main/res/drawable`. */
const SMALL_ICON = "ic_stat_lifehub";
const ICON_COLOR = "#7C5CFC";
/** Must exist in `android/app/src/main/res/raw`. */
const REMINDER_SOUND = "beep.wav";

/** Local record of everything this app has scheduled, keyed by logical id. */
const LEDGER_KEY = "lifehub_notification_ledger_v1";

/**
 * Android refuses to arm an alarm whose trigger time is already in the past
 * (it logs "Scheduled time must be *after* current time" and drops it), so we
 * require a small safety lead before accepting a one-shot schedule.
 */
const MIN_LEAD_MS = 10_000;

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Stable, collision-resistant 31-bit id.
 *
 * Android notification ids must fit in a Java `int`. The previous
 * implementation used `Math.abs(hash)`, which returns 2147483648 for
 * `-2147483648` — one past `Integer.MAX_VALUE` — and made the whole
 * `schedule()` call reject. Masking to 31 bits can never overflow.
 */
export function notificationId(key: string): number {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
  }
  return hash & 0x7fffffff || 1;
}

export interface PlannedNotification {
  /** Stable logical id, e.g. `bday_<uuid>_day`. Used for cancel/reconcile. */
  key: string;
  title: string;
  body: string;
  /** One-shot delivery time. Mutually exclusive with `on`. */
  at?: Date;
  /**
   * Post through the OS immediately (no alarm). The Capacitor plugin shows a
   * notification without a `schedule` field right away — used by the walk
   * fallback, which previously tried `at: now + 1s` and was rejected by the
   * `MIN_LEAD_MS` guard below (so it could never display).
   */
  deliverNow?: boolean;
  /**
   * Cron-style recurrence. `{ hour, minute }` repeats daily,
   * `{ month, day, hour, minute }` repeats yearly.
   * NOTE: `month` is 0-based (it maps onto `java.util.Calendar.MONTH`).
   */
  on?: ScheduleOn;
  channelId?: string;
  extra?: Record<string, unknown>;
  /** Expanded (multi-line) body text. */
  largeBody?: string;
}

interface LedgerEntry {
  id: number;
  /** Epoch ms for one-shots; absent for recurring notifications. */
  at?: number;
  recurring?: boolean;
}

type Ledger = Record<string, LedgerEntry>;

function readLedger(): Ledger {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LEDGER_KEY);
    return raw ? (JSON.parse(raw) as Ledger) : {};
  } catch {
    return {};
  }
}

function writeLedger(ledger: Ledger) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    /* storage unavailable — scheduling still works, reconcile degrades */
  }
}

function isNative() {
  return Capacitor.isNativePlatform();
}

/** Count of ledger entries per logical key prefix (e.g. `apt_`, `daily_`). */
function ledgerLanes(): Record<string, number> {
  const lanes: Record<string, number> = {};
  for (const key of Object.keys(readLedger())) {
    const idx = key.indexOf("_");
    const prefix = idx === -1 ? key : key.slice(0, idx + 1);
    lanes[prefix] = (lanes[prefix] || 0) + 1;
  }
  return lanes;
}

export class NotificationService {
  private static channelsReady: Promise<void> | null = null;

  /* ── Channels ──────────────────────────────────────────────────────────── */

  /**
   * Creates the notification channels. Idempotent and safe to call often —
   * the work is memoised, and channel creation is a no-op once registered.
   */
  static async initChannels(): Promise<void> {
    if (!isNative()) return;
    if (!this.channelsReady) {
      this.channelsReady = (async () => {
        try {
          await LocalNotifications.createChannel({
            id: REMINDER_CHANNEL,
            name: "Reminders",
            description: "Appointments, birthdays, medications, bills and tasks",
            importance: 5, // Urgent: heads-up banner, bypasses more throttling
            visibility: 1, // Public on the lock screen
            sound: REMINDER_SOUND,
            vibration: true,
            lights: true,
            lightColor: ICON_COLOR,
          });

          await LocalNotifications.createChannel({
            id: WALK_FALLBACK_CHANNEL,
            name: "Walk tracking (fallback)",
            description: "Shown only when the native walk service is unavailable",
            importance: 2, // Low: silent, no heads-up
            visibility: 1,
            vibration: false,
          });
        } catch (err) {
          // Retry on the next call rather than caching the failure.
          this.channelsReady = null;
          console.warn("[notifications] failed to create channels:", err);
          throw err;
        }
      })();
    }
    try {
      await this.channelsReady;
    } catch {
      /* surfaced above */
    }
  }

  /**
   * Removes the v1 channels whose sound URI pointed at a non-existent
   * resource (they can never be repaired in place).
   */
  static async deleteLegacyChannels(ids: string[] = LEGACY_CHANNELS): Promise<void> {
    if (!isNative()) return;
    for (const id of ids) {
      try {
        await LocalNotifications.deleteChannel({ id });
      } catch {
        /* channel already absent */
      }
    }
  }

  /* ── Permissions ───────────────────────────────────────────────────────── */

  /** Requests POST_NOTIFICATIONS (Android 13+). Returns the resulting state. */
  static async ensureExactAlarmPermission(): Promise<boolean> {
    if (!isNative()) return true;
    try {
      if (await this.hasExactAlarms()) return true;
      return await this.requestExactAlarms();
    } catch {
      return true;
    }
  }

  static async requestPermission(): Promise<boolean> {
    if (!isNative()) return false;
    try {
      await this.initChannels();
      const check = await LocalNotifications.checkPermissions();
      if (check.display === "granted") {
        await this.ensureExactAlarmPermission();
        return true;
      }
      const status = await LocalNotifications.requestPermissions();
      if (status.display === "granted") {
        await this.ensureExactAlarmPermission();
        return true;
      }
      return false;
    } catch (err) {
      console.warn("[notifications] permission request failed:", err);
      return false;
    }
  }

  static async hasPermission(): Promise<boolean> {
    if (!isNative()) return false;
    try {
      const status = await LocalNotifications.checkPermissions();
      return status.display === "granted";
    } catch {
      return false;
    }
  }

  /**
   * Android 12+ gates exact alarms behind a separate user setting. Without it
   * every reminder falls back to an inexact alarm that Doze may defer by
   * minutes to hours. The manifest declares USE_EXACT_ALARM, so this is
   * normally granted — but OEM battery managers can still revoke it.
   */
  static async hasExactAlarms(): Promise<boolean> {
    if (!isNative()) return false;
    try {
      const status = await LocalNotifications.checkExactNotificationSetting();
      return status.exact_alarm === "granted";
    } catch {
      // Older plugin/OS combinations: exact alarms are implicitly allowed.
      return true;
    }
  }

  /** Opens the OS "Alarms & reminders" screen so the user can re-enable it. */
  static async requestExactAlarms(): Promise<boolean> {
    if (!isNative()) return false;
    try {
      const status = await LocalNotifications.changeExactNotificationSetting();
      return status.exact_alarm === "granted";
    } catch {
      return false;
    }
  }

  /** Health snapshot used by the profile screen and for support diagnostics. */
  static async getDiagnostics(): Promise<{
    native: boolean;
    permission: boolean;
    exactAlarms: boolean;
    pending: number;
    tracked: number;
    lanes: Record<string, number>;
  }> {
    if (!isNative()) {
      return {
        native: false,
        permission: false,
        exactAlarms: false,
        pending: 0,
        tracked: 0,
        lanes: {},
      };
    }
    const [permission, exactAlarms, pending] = await Promise.all([
      this.hasPermission(),
      this.hasExactAlarms(),
      this.getPending(),
    ]);
    return {
      native: true,
      permission,
      exactAlarms,
      pending: pending.length,
      tracked: Object.keys(readLedger()).length,
      lanes: ledgerLanes(),
    };
  }

  /* ── Scheduling ────────────────────────────────────────────────────────── */

  private static buildSchema(plan: PlannedNotification): LocalNotificationSchema | null {
    const id = notificationId(plan.key);

    const base = {
      id,
      title: plan.title,
      body: plan.body,
      largeBody: plan.largeBody,
      channelId: plan.channelId || REMINDER_CHANNEL,
      smallIcon: SMALL_ICON,
      iconColor: ICON_COLOR,
      sound: REMINDER_SOUND,
      autoCancel: true,
      extra: plan.extra,
    };

    if (plan.deliverNow) {
      // No `schedule` field → the plugin posts the notification immediately
      // instead of arming an alarm (bypasses the MIN_LEAD_MS one-shot guard).
      return base satisfies LocalNotificationSchema;
    }

    if (plan.on) {
      return {
        ...base,
        schedule: {
          on: { second: 0, ...plan.on },
          // `allowWhileIdle` belongs to `schedule`, NOT to the notification
          // root. Placing it on the root (the previous behaviour) silently
          // downgraded every reminder to `AlarmManager.setExact(RTC)`, which
          // neither wakes the device nor fires during Doze — the root cause of
          // birthday/appointment reminders never arriving.
          allowWhileIdle: true,
        },
      } satisfies LocalNotificationSchema;
    }

    if (plan.at) {
      if (plan.at.getTime() - Date.now() < MIN_LEAD_MS) return null;
      return {
        ...base,
        schedule: { at: plan.at, allowWhileIdle: true },
      } satisfies LocalNotificationSchema;
    }

    return null;
  }

  /**
   * Schedules a batch of notifications.
   *
   * Every plan is cancelled first, so re-running a resync can never produce
   * duplicates and can never be blocked by a stale entry. (Capacitor writes a
   * notification into its "pending" storage even when the alarm was rejected
   * for being in the past, so an "is it already pending?" guard — the previous
   * behaviour — permanently suppressed re-scheduling of those reminders.)
   *
   * @returns the keys that were actually armed.
   */
  static async schedulePlans(plans: PlannedNotification[]): Promise<string[]> {
    if (!isNative() || plans.length === 0) return [];

    // The reminder channels exist, but if the OS notification permission was
    // never granted we must request it here before trying to arm any reminder.
    // Profiles that only toggle the daily reminder on the settings screen do
    // not cover the other reminder types, which is why appointments, birthdays,
    // and walk fallback notifications were silently never getting scheduled.
    try {
      const { PermissionManager } = await import("./permissions");
      const granted = await PermissionManager.ensurePermission("notification");
      if (!granted) {
        console.info("[notifications] schedulePlans: notification permission not granted, nothing armed");
        return [];
      }
    } catch (err) {
      console.warn("[notifications] schedulePlans: permission gate failed:", err);
      return [];
    }

    await this.initChannels();
    await this.ensureExactAlarmPermission();

    const schemas: LocalNotificationSchema[] = [];
    const scheduled: string[] = [];
    const ledger = readLedger();

    for (const plan of plans) {
      const schema = this.buildSchema(plan);
      if (!schema) {
        // Past-dated or malformed: drop any previous arming for this key so a
        // stale reminder can never fire with outdated content.
        const existing = ledger[plan.key];
        if (existing) {
          delete ledger[plan.key];
          await this.cancelIds([existing.id]);
        }
        continue;
      }
      schemas.push(schema);
      scheduled.push(plan.key);
      ledger[plan.key] = {
        id: schema.id,
        at: plan.deliverNow ? Date.now() : plan.at ? plan.at.getTime() : undefined,
        recurring: !!plan.on,
      };
    }

    const skipped = plans.length - scheduled.length;
    console.info(
      `[notifications] schedulePlans: armed ${scheduled.length}, skipped ${skipped}${
        scheduled.length > 0 ? ` — ${scheduled.join(", ")}` : ""
      }`,
    );

    if (schemas.length === 0) {
      writeLedger(ledger);
      return [];
    }

    try {
      // Clear first so the OS never holds two alarms for the same id.
      await this.cancelIds(schemas.map((s) => s.id));
      await LocalNotifications.schedule({ notifications: schemas });
      writeLedger(ledger);
      return scheduled;
    } catch (err) {
      // The whole batch is rejected atomically (e.g. notifications disabled),
      // so nothing was armed — keep the ledger free of phantom entries.
      for (const key of scheduled) delete ledger[key];
      writeLedger(ledger);
      console.warn("[notifications] failed to schedule batch:", err);
      return [];
    }
  }

  /** Convenience wrapper around {@link schedulePlans} for a single reminder. */
  static async schedule(plan: PlannedNotification): Promise<boolean> {
    const done = await this.schedulePlans([plan]);
    return done.length > 0;
  }

  /**
   * Brings the OS state in line with `plans` for the given key prefixes.
   *
   * Anything previously scheduled under one of `prefixes` that is not part of
   * `plans` is cancelled — this is what removes reminders for deleted or
   * completed records, and what clears reminders orphaned by an app update.
   *
   * One-shots whose fire time has already passed are only forgotten, never
   * cancelled: cancelling also dismisses the delivered notification, which
   * would silently wipe a reminder out of the shade the moment the user opens
   * the app.
   */
  static async reconcile(plans: PlannedNotification[], prefixes: string[]): Promise<void> {
    if (!isNative()) return;

    const desired = new Set(plans.map((p) => p.key));
    const ledger = readLedger();
    const orphanIds: number[] = [];
    let ledgerChanged = false;
    const now = Date.now();

    for (const [key, entry] of Object.entries(ledger)) {
      if (desired.has(key)) continue;
      if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
      const alreadyDelivered = !entry.recurring && typeof entry.at === "number" && entry.at <= now;
      if (!alreadyDelivered) orphanIds.push(entry.id);
      delete ledger[key];
      ledgerChanged = true;
    }

    if (ledgerChanged) writeLedger(ledger);
    if (orphanIds.length > 0) await this.cancelIds(orphanIds);

    await this.schedulePlans(plans);
  }

  /**
   * Cancels notifications armed by an older build of the app.
   *
   * Reminder ids are derived from the logical key, so changing the hash (v1
   * used `Math.abs`, which could overflow a Java `int`) orphans every alarm
   * the previous version scheduled. Without this cleanup the user would
   * receive each reminder twice — once from the old alarm, once from the new.
   */
  static async cancelLegacyIds(ids: number[]): Promise<void> {
    await this.cancelIds(ids);
  }

  /* ── Cancellation ──────────────────────────────────────────────────────── */

  private static async cancelIds(ids: number[]): Promise<void> {
    if (!isNative() || ids.length === 0) return;
    try {
      await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
    } catch (err) {
      console.warn("[notifications] failed to cancel notifications:", err);
    }
  }

  /** Cancels every notification scheduled under the given logical keys. */
  static async cancel(...keys: string[]): Promise<void> {
    if (!isNative() || keys.length === 0) return;
    const ledger = readLedger();
    for (const key of keys) delete ledger[key];
    writeLedger(ledger);
    await this.cancelIds(keys.map(notificationId));
  }

  /** Cancels everything whose logical key starts with one of `prefixes`. */
  static async cancelByPrefix(...prefixes: string[]): Promise<void> {
    if (!isNative() || prefixes.length === 0) return;
    const ledger = readLedger();
    const ids: number[] = [];
    for (const [key, entry] of Object.entries(ledger)) {
      if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
      ids.push(entry.id);
      delete ledger[key];
    }
    writeLedger(ledger);
    await this.cancelIds(ids);
  }

  /** Cancels every pending notification, tracked or not. */
  static async cancelAll(): Promise<void> {
    if (!isNative()) return;
    try {
      const pending = await LocalNotifications.getPending();
      if (pending.notifications.length > 0) {
        await LocalNotifications.cancel({ notifications: pending.notifications });
      }
    } catch (err) {
      console.warn("[notifications] failed to cancel all notifications:", err);
    }
    writeLedger({});
  }

  /* ── Introspection ─────────────────────────────────────────────────────── */

  static async getPending(): Promise<{ id: number; title: string; body: string }[]> {
    if (!isNative()) return [];
    try {
      const pending = await LocalNotifications.getPending();
      return pending.notifications.map((n) => ({ id: n.id, title: n.title, body: n.body }));
    } catch (err) {
      console.warn("[notifications] failed to read pending notifications:", err);
      return [];
    }
  }

  /** True when this exact logical id is currently armed by the OS. */
  static async isScheduled(key: string): Promise<boolean> {
    const pending = await this.getPending();
    const id = notificationId(key);
    return pending.some((n) => n.id === id);
  }

  /* ── Taps ──────────────────────────────────────────────────────────────── */

  /** Fires when the user taps a delivered notification. Returns an unsubscribe. */
  static onNotificationClick(callback: (extra: Record<string, any> | undefined) => void) {
    if (!isNative()) return () => {};
    const listener = LocalNotifications.addListener(
      "localNotificationActionPerformed",
      (action: ActionPerformed) => {
        callback(action.notification.extra as Record<string, any> | undefined);
      },
    );
    return () => {
      listener.then((l) => l.remove()).catch(() => {});
    };
  }
}
