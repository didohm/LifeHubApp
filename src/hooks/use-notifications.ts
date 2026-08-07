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
      if (extra && typeof extra.screen === "string") {
        navigate({ to: extra.screen as any });
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
   * Schedule a reminder notification.
   */
  const scheduleReminder = useCallback(
    async (id: string, title: string, body: string, date: Date, screen?: string) => {
      if (!isNative) return;
      try {
        await NotificationService.schedule({
          title,
          body,
          id,
          scheduleDate: date,
          extra: screen ? { screen } : undefined,
        });
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

const REMINDER_PREFIX = {
  appointment: "apt_",
  medication: "med_",
  bill: "bill_",
  birthday: "bday_",
  workout: "wkout_",
  daily: "daily_",
} as const;

export async function scheduleAppointmentReminder(
  appointmentId: string,
  title: string,
  doctorName: string,
  date: string,
  startTime: string,
  isNative: boolean,
) {
  if (!isNative) return;
  try {
    const [hours, minutes] = startTime.split(":").map(Number);
    const appointmentDate = new Date(date);
    appointmentDate.setHours(hours, minutes, 0, 0);

    const reminderDate = new Date(appointmentDate.getTime() - 60 * 60 * 1000);

    if (reminderDate > new Date()) {
      await NotificationService.schedule({
        title: `Appointment: ${title}`,
        body: `With ${doctorName || "your doctor"} in 1 hour`,
        id: `${REMINDER_PREFIX.appointment}${appointmentId}`,
        scheduleDate: reminderDate,
        extra: { screen: "/appointments" },
      });
    }
  } catch (err) {
    console.warn("Failed to schedule appointment reminder:", err);
  }
}

export async function scheduleMedicationReminder(
  medicationId: string,
  name: string,
  dosage: string,
  scheduledTime: string,
  isNative: boolean,
) {
  if (!isNative) return;
  try {
    const [hours, minutes] = scheduledTime.split(":").map(Number);
    const reminderDate = new Date();
    reminderDate.setHours(hours, minutes, 0, 0);

    if (reminderDate <= new Date()) {
      reminderDate.setDate(reminderDate.getDate() + 1);
    }

    await NotificationService.schedule({
      title: `Medication: ${name}`,
      body: `Take ${dosage} now`,
      id: `${REMINDER_PREFIX.medication}${medicationId}`,
      scheduleDate: reminderDate,
      extra: { screen: "/medications" },
    });
  } catch (err) {
    console.warn("Failed to schedule medication reminder:", err);
  }
}

export async function scheduleBillReminder(
  billId: string,
  title: string,
  amount: number,
  dueDate: string,
  isNative: boolean,
) {
  if (!isNative) return;
  try {
    const due = new Date(dueDate);
    due.setHours(9, 0, 0, 0);

    const reminderDate = new Date(due.getTime() - 24 * 60 * 60 * 1000);

    if (reminderDate > new Date()) {
      await NotificationService.schedule({
        title: `Bill Due: ${title}`,
        body: `$${amount.toFixed(2)} is due tomorrow`,
        id: `${REMINDER_PREFIX.bill}${billId}`,
        scheduleDate: reminderDate,
        extra: { screen: "/bills" },
      });
    }
  } catch (err) {
    console.warn("Failed to schedule bill reminder:", err);
  }
}

export async function scheduleBirthdayReminder(
  birthdayId: string,
  fullName: string,
  birthdayDate: string,
  isNative: boolean,
) {
  if (!isNative) return;
  try {
    const [month, day] = birthdayDate.split("-").slice(1).map(Number);
    const now = new Date();
    const thisYear = new Date(now.getFullYear(), month - 1, day, 9, 0, 0);

    if (thisYear <= now) {
      thisYear.setFullYear(thisYear.getFullYear() + 1);
    }

    await NotificationService.schedule({
      title: `🎂 Birthday: ${fullName}`,
      body: `Don't forget to wish ${fullName} a happy birthday!`,
      id: `${REMINDER_PREFIX.birthday}${birthdayId}`,
      scheduleDate: thisYear,
      extra: { screen: "/birthdays" },
    });
  } catch (err) {
    console.warn("Failed to schedule birthday reminder:", err);
  }
}

export async function scheduleWorkoutReminder(
  workoutId: string,
  sessionName: string,
  scheduledAt: string,
  isNative: boolean,
) {
  if (!isNative) return;
  try {
    const scheduledDate = new Date(scheduledAt);
    const reminderDate = new Date(scheduledDate.getTime() - 30 * 60 * 1000);

    if (reminderDate > new Date()) {
      await NotificationService.schedule({
        title: `Workout: ${sessionName}`,
        body: `Your workout starts in 30 minutes`,
        id: `${REMINDER_PREFIX.workout}${workoutId}`,
        scheduleDate: reminderDate,
        extra: { screen: "/workouts" },
      });
    }
  } catch (err) {
    console.warn("Failed to schedule workout reminder:", err);
  }
}
