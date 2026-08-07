import { LocalNotifications, ActionPerformed } from "@capacitor/local-notifications";
import { Capacitor } from "@capacitor/core";

function hashId(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export interface NotificationOptions {
  title: string;
  body: string;
  id: string;
  scheduleDate: Date;
  channelId?: string;
  extra?: Record<string, unknown>;
  /** Repeats every day at the same time (water reminders, daily check-in). */
  dailyRepeat?: boolean;
}

export class NotificationService {
  private static channelsInitialized = false;

  /**
   * Register notification channels on Android 8.0+ (API 26+).
   * Required so notifications appear in status bar, notification shade, and heads-up popups.
   */
  static async initChannels(): Promise<void> {
    if (!Capacitor.isNativePlatform() || this.channelsInitialized) return;
    try {
      await LocalNotifications.createChannel({
        id: "lifehub_reminders",
        name: "LifeHub Reminders",
        description: "Reminders for appointments, medications, bills, and daily tasks",
        importance: 4, // High: shows as heads-up banner & status bar
        visibility: 1, // Public on lockscreen
        sound: "default",
        vibration: true,
        lights: true,
        lightColor: "#7C5CFC",
      });

      await LocalNotifications.createChannel({
        id: "lifehub_walk",
        name: "Walking Tracking",
        description: "Active walking session status notifications",
        importance: 3, // Default importance
        visibility: 1,
        sound: "default",
        vibration: false,
      });

      this.channelsInitialized = true;
    } catch (err) {
      console.warn("Failed to create notification channels:", err);
    }
  }

  /**
   * Request POST_NOTIFICATIONS permission on Android 13+.
   */
  static async requestPermission(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    try {
      await this.initChannels();
      const check = await LocalNotifications.checkPermissions();
      if (check.display === "granted") return true;
      const status = await LocalNotifications.requestPermissions();
      return status.display === "granted";
    } catch (err) {
      console.warn("Failed requesting notification permissions:", err);
      return false;
    }
  }

  /** All currently scheduled (pending) notifications. */
  static async getPending(): Promise<{ id: number; title: string; body: string }[]> {
    if (!Capacitor.isNativePlatform()) return [];
    try {
      const pending = await LocalNotifications.getPending();
      return pending.notifications.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
      }));
    } catch (err) {
      console.warn("Failed to read pending notifications:", err);
      return [];
    }
  }

  /** True when a notification with the given string id is already scheduled. */
  static async isScheduled(id: string): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    try {
      const pending = await this.getPending();
      return pending.some((n) => n.id === hashId(id));
    } catch {
      return false;
    }
  }

  /**
   * Schedules a local notification with high importance, icon, sound, and vibration.
   * Idempotent: if a notification with the same id is already pending, it is
   * NOT re-scheduled (prevents duplicates on app restart / data re-sync).
   */
  static async schedule(options: NotificationOptions): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await this.initChannels();
      // Skip if the same logical notification is already scheduled
      if (await this.isScheduled(options.id)) return;

      const notification = options.dailyRepeat
        ? {
            id: hashId(options.id),
            title: options.title,
            body: options.body,
            schedule: {
              on: {
                hour: options.scheduleDate.getHours(),
                minute: options.scheduleDate.getMinutes(),
              },
              repeats: true,
            } as any,
            channelId: options.channelId || "lifehub_reminders",
            smallIcon: "ic_launcher",
            iconColor: "#7C5CFC",
            sound: "default",
            allowWhileIdle: true,
            extra: options.extra,
          }
        : {
            id: hashId(options.id),
            title: options.title,
            body: options.body,
            schedule: { at: options.scheduleDate },
            channelId: options.channelId || "lifehub_reminders",
            smallIcon: "ic_launcher",
            iconColor: "#7C5CFC",
            sound: "default",
            allowWhileIdle: true,
            extra: options.extra,
          };

      await LocalNotifications.schedule({ notifications: [notification as any] });
    } catch (err) {
      console.warn("Failed to schedule local notification:", err);
    }
  }

  /** Force-schedule even if a pending notification with the same id exists. */
  static async reschedule(options: NotificationOptions): Promise<void> {
    await this.cancel(options.id);
    await this.schedule(options);
  }

  /**
   * Cancels a specific notification by its string ID.
   */
  static async cancel(id: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await LocalNotifications.cancel({
        notifications: [{ id: hashId(id) }],
      });
    } catch (err) {
      console.warn("Failed to cancel notification:", err);
    }
  }

  /**
   * Cancels all scheduled notifications.
   */
  static async cancelAll(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const pending = await LocalNotifications.getPending();
      if (pending.notifications.length > 0) {
        await LocalNotifications.cancel({ notifications: pending.notifications });
      }
    } catch (err) {
      console.warn("Failed to cancel all notifications:", err);
    }
  }

  /**
   * Listen for user clicking a notification in the notification shade / status bar.
   */
  static onNotificationClick(callback: (extra: Record<string, any> | undefined) => void) {
    if (!Capacitor.isNativePlatform()) return () => {};
    const listener = LocalNotifications.addListener(
      "localNotificationActionPerformed",
      (action: ActionPerformed) => {
        const extra = action.notification.extra as Record<string, any> | undefined;
        callback(extra);
      },
    );
    return () => {
      listener.then((l) => l.remove()).catch(() => {});
    };
  }
}
