import { useCallback, useEffect } from "react";
import { NotificationService } from "../lib/notifications";
import { NativePermissions } from "../lib/permissions";
import { Capacitor } from "@capacitor/core";
import { useNavigate } from "@tanstack/react-router";

/**
 * Hook for managing local notifications on Android (Capacitor).
 * Handles scheduling, cancellation, and notification tap navigation.
 *
 * NOTE: permission requests do NOT happen here — features request the
 * OS permission themselves when first used.
 */
export function useNotifications() {
  const isNative = Capacitor.isNativePlatform();
  const navigate = useNavigate();

  // Setup tap listener: tapping an OS notification opens the related screen.
  useEffect(() => {
    if (!isNative) return;

    const goToNotificationScreen = (extra: Record<string, any> | undefined | null) => {
      // Both `screen` (Capacitor local-notification extra) and
      // `lifehub_screen` (native walk foreground notification payload) carry
      // the destination route.
      const screen = extra?.screen ?? extra?.lifehub_screen;
      if (typeof screen === "string") {
        navigate({ to: screen as any });
      }
    };

    // Warm start (app open / backgrounded): the plugin emits the event.
    const cleanup = NotificationService.onNotificationClick((extra) => {
      goToNotificationScreen(extra);
    });

    // Cold start (app was killed): read the launch notification payload.
    NativePermissions.getLaunchNotification()
      .then((res) => goToNotificationScreen(res.extra))
      .catch(() => {});

    return () => cleanup();
  }, [isNative, navigate]);

  /**
   * Schedule a reminder notification using the plan-based API.
   */
  const scheduleReminder = useCallback(
    async (plan: import("../lib/notifications").PlannedNotification) => {
      if (!isNative) return;
      try {
        await NotificationService.schedule(plan);
      } catch (err) {
        console.warn("Failed to schedule notification:", err);
      }
    },
    [isNative],
  );

  /**
   * Cancel a specific notification.
   */
  const cancelReminder = useCallback(
    async (id: string) => {
      if (!isNative) return;
      try {
        await NotificationService.cancel(id);
      } catch (err) {
        console.warn("Failed to cancel notification:", err);
      }
    },
    [isNative],
  );

  /**
   * Cancel all notifications.
   */
  const cancelAllReminders = useCallback(async () => {
    if (!isNative) return;
    try {
      await NotificationService.cancelAll();
    } catch (err) {
      console.warn("Failed to cancel all notifications:", err);
    }
  }, [isNative]);

  return {
    scheduleReminder,
    cancelReminder,
    cancelAllReminders,
    isNative,
  };
}
