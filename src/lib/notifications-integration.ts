import { Capacitor, registerPlugin } from "@capacitor/core";

export interface WalkStatusUpdate {
  tracking: boolean;
  distanceKm: number;
  steps: number;
  updateCount: number;
  timestamp: number;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  speed?: number;
}

export interface WalkServicePluginInterface {
  startService(options: { distanceKm: number; steps: number }): Promise<{ started: boolean }>;
  updateService(options: { distanceKm: number; steps: number }): Promise<{ updated: boolean }>;
  stopService(): Promise<{ stopped: boolean }>;
  /** Live snapshot of the native walking foreground service. */
  getStatus(): Promise<WalkStatusUpdate>;
  /** Pushed on every native location fix / step while the service tracks. */
  addListener(
    eventName: "walkUpdate",
    listenerFunc: (data: WalkStatusUpdate) => void,
  ): Promise<{ remove: () => void }>;
}

export const WalkServicePlugin = registerPlugin<WalkServicePluginInterface>("WalkService");
import { NotificationService } from "./notifications";
import { Appointment, Medication, Bill, Birthday, Workout, Todo } from "./types";

const isNative = () => Capacitor.isNativePlatform();

export interface RecurringReminderSettings {
  daily: { enabled: boolean; hour: number; minute: number };
}

const REMINDER_SETTINGS_KEY = "lifehub_reminder_settings";

export function readReminderSettings(): RecurringReminderSettings {
  const defaults: RecurringReminderSettings = {
    daily: { enabled: false, hour: 8, minute: 0 },
  };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(REMINDER_SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      daily: { ...defaults.daily, ...(parsed.daily || {}) },
    };
  } catch {
    return defaults;
  }
}

export function saveReminderSettings(settings: RecurringReminderSettings) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(REMINDER_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

/**
 * Notification integration layer.
 * Call these after creating/updating records to schedule/cancel notifications.
 * All functions include route payloads so tapping a notification navigates to the proper screen.
 * Scheduling is idempotent (see NotificationService.schedule), so it is safe
 * to call from a startup re-sync without creating duplicates.
 */
export const Notifications = {
  // ──── Appointments ────
  async scheduleAppointment(apt: Appointment) {
    if (!isNative() || !apt.start_time) return;
    // Default to reminder ON if field is undefined (legacy records)
    const wantsReminder = apt.reminder === undefined ? true : apt.reminder;
    if (!wantsReminder) return;
    try {
      const [h, m] = (apt.start_time || "09:00").split(":").map(Number);
      const aptDate = new Date(apt.appointment_date);
      aptDate.setHours(h, m, 0, 0);
      const reminderDate = new Date(aptDate.getTime() - 60 * 60 * 1000); // 1hr before

      if (reminderDate > new Date()) {
        await NotificationService.schedule({
          title: `Appointment: ${apt.title}`,
          body: `With ${apt.doctor_name || "your doctor"} in 1 hour`,
          id: `apt_${apt.id}`,
          scheduleDate: reminderDate,
          channelId: "lifehub_reminders",
          extra: { screen: "/appointments", appointmentId: apt.id },
        });
      }
    } catch (e) {
      /* silent */
    }
  },

  async cancelAppointment(aptId: string) {
    if (!isNative()) return;
    try {
      await NotificationService.cancel(`apt_${aptId}`);
    } catch (e) {
      /* silent */
    }
  },

  // ──── Medications (repeat EVERY DAY at the scheduled time) ────
  async scheduleMedication(med: Medication) {
    if (!isNative() || !med.scheduled_time) return;
    try {
      const [h, m] = med.scheduled_time.split(":").map(Number);
      // reschedule (cancel + schedule) keeps the daily repeat in sync and
      // replaces any legacy one-shot reminder created by older app versions.
      await NotificationService.reschedule({
        title: `Medication: ${med.name}`,
        body: `Take ${med.dosage} now`,
        id: `med_${med.id}`,
        scheduleDate: new Date(2000, 0, 1, h, m, 0, 0),
        channelId: "lifehub_reminders",
        extra: { screen: "/medications", medicationId: med.id },
        dailyRepeat: true,
      });
    } catch (e) {
      /* silent */
    }
  },

  async cancelMedication(medId: string) {
    if (!isNative()) return;
    try {
      await NotificationService.cancel(`med_${medId}`);
    } catch (e) {
      /* silent */
    }
  },

  // ──── Tasks ────
  async scheduleTodo(todo: Todo) {
    if (!isNative() || !todo.due_date || todo.completed) return;
    try {
      const [y, mo, d] = todo.due_date.split("-").map(Number);
      const due = new Date(y, mo - 1, d, 9, 0, 0); // 9:00 AM on the due date
      if (due > new Date()) {
        await NotificationService.schedule({
          title: `Task due: ${todo.title}`,
          body: `"${todo.title}" is due today`,
          id: `todo_${todo.id}`,
          scheduleDate: due,
          channelId: "lifehub_reminders",
          extra: { screen: "/tasks", todoId: todo.id },
        });
      }
    } catch (e) {
      /* silent */
    }
  },

  async cancelTodo(todoId: string) {
    if (!isNative()) return;
    try {
      await NotificationService.cancel(`todo_${todoId}`);
    } catch (e) {
      /* silent */
    }
  },

  // ──── Bills ────
  async scheduleBill(bill: Bill) {
    if (!isNative()) return;
    try {
      const due = new Date(bill.due_date);
      due.setHours(9, 0, 0, 0);
      const reminderDate = new Date(due.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days before

      if (reminderDate > new Date()) {
        await NotificationService.schedule({
          title: `Bill Due: ${bill.title}`,
          body: `$${bill.amount.toFixed(2)} is due in 2 days`,
          id: `bill_${bill.id}`,
          scheduleDate: reminderDate,
          channelId: "lifehub_reminders",
          extra: { screen: "/bills", billId: bill.id },
        });
      }
    } catch (e) {
      /* silent */
    }
  },

  async cancelBill(billId: string) {
    if (!isNative()) return;
    try {
      await NotificationService.cancel(`bill_${billId}`);
    } catch (e) {
      /* silent */
    }
  },

  // ──── Birthdays ────
  async scheduleBirthday(bday: Birthday) {
    if (!isNative()) return;
    try {
      const [, month, day] = bday.birthday_date.split("-").map(Number);
      const now = new Date();
      const thisYear = new Date(now.getFullYear(), month - 1, day, 9, 0, 0);
      if (thisYear <= now) thisYear.setFullYear(thisYear.getFullYear() + 1);

      await NotificationService.schedule({
        title: `🎂 Birthday: ${bday.full_name}`,
        body: `Don't forget to wish ${bday.full_name} a happy birthday!`,
        id: `bday_${bday.id}`,
        scheduleDate: thisYear,
        channelId: "lifehub_reminders",
        extra: { screen: "/birthdays", birthdayId: bday.id },
      });
    } catch (e) {
      /* silent */
    }
  },

  async cancelBirthday(bdayId: string) {
    if (!isNative()) return;
    try {
      await NotificationService.cancel(`bday_${bdayId}`);
    } catch (e) {
      /* silent */
    }
  },

  // ──── Workouts ────
  async scheduleWorkout(wk: Workout) {
    if (!isNative()) return;
    try {
      const scheduledDate = new Date(wk.scheduled_at);
      const reminderDate = new Date(scheduledDate.getTime() - 30 * 60 * 1000); // 30min before

      if (reminderDate > new Date()) {
        await NotificationService.schedule({
          title: `Workout: ${wk.session_name}`,
          body: `Your workout starts in 30 minutes`,
          id: `wkout_${wk.id}`,
          scheduleDate: reminderDate,
          channelId: "lifehub_reminders",
          extra: { screen: "/workouts", workoutId: wk.id },
        });
      }
    } catch (e) {
      /* silent */
    }
  },

  async cancelWorkout(wkId: string) {
    if (!isNative()) return;
    try {
      await NotificationService.cancel(`wkout_${wkId}`);
    } catch (e) {
      /* silent */
    }
  },

  // ──── Walking Tracking Notification (Foreground Service) ────
  async startWalkForeground(distanceKm: number = 0, steps: number = 0) {
    if (!isNative()) return;
    try {
      await WalkServicePlugin.startService({ distanceKm, steps });
    } catch (e) {
      /* fallback to local notification if native service is unavailable */
      this.scheduleWalkReminder(
        "🚶 Walking session started",
        `Tracking walk: ${distanceKm.toFixed(2)} km`,
      );
    }
  },

  async updateWalkForeground(distanceKm: number, steps: number) {
    if (!isNative()) return;
    try {
      await WalkServicePlugin.updateService({ distanceKm, steps });
    } catch (e) {
      /* silent fallback */
    }
  },

  async stopWalkForeground() {
    if (!isNative()) return;
    try {
      await WalkServicePlugin.stopService();
      await NotificationService.cancel("walk_tracking");
    } catch (e) {
      /* silent */
    }
  },

  async scheduleWalkReminder(title: string, body: string) {
    if (!isNative()) return;
    try {
      await NotificationService.schedule({
        title,
        body,
        id: "walk_tracking",
        scheduleDate: new Date(Date.now() + 1000),
        channelId: "lifehub_walk",
        extra: { screen: "/walk" },
      });
    } catch (e) {
      /* silent */
    }
  },

  // ──── Recurring reminders (real OS-level, survive restarts) ────

  /** Schedules the persisted daily check-in reminder (repeats every day). */
  async scheduleDailyReminder(hour: number = 8, minute: number = 0) {
    if (!isNative()) return;
    try {
      const settings = readReminderSettings();
      settings.daily = { enabled: true, hour, minute };
      saveReminderSettings(settings);

      await NotificationService.reschedule({
        title: "LifeHub Daily Check-in",
        body: "Don't forget to check your medications, bills, and tasks!",
        id: "daily_reminder",
        scheduleDate: new Date(2000, 0, 1, hour, minute, 0, 0),
        channelId: "lifehub_reminders",
        extra: { screen: "/" },
        dailyRepeat: true,
      });
    } catch (e) {
      /* silent */
    }
  },

  /** Turns the daily check-in reminder off (real cancellation). */
  async cancelDailyReminder() {
    if (!isNative()) return;
    try {
      const settings = readReminderSettings();
      settings.daily = { ...settings.daily, enabled: false };
      saveReminderSettings(settings);
      await NotificationService.cancel("daily_reminder");
    } catch (e) {
      /* silent */
    }
  },

  /**
   * Re-schedules the persisted daily check-in reminder after an app restart,
   * so it survives restarts and app re-installs.
   */
  async resyncRecurringReminders() {
    if (!isNative()) return;
    try {
      const settings = readReminderSettings();
      if (settings.daily.enabled) {
        await NotificationService.reschedule({
          title: "LifeHub Daily Check-in",
          body: "Don't forget to check your medications, bills, and tasks!",
          id: "daily_reminder",
          scheduleDate: new Date(2000, 0, 1, settings.daily.hour, settings.daily.minute, 0, 0),
          channelId: "lifehub_reminders",
          extra: { screen: "/" },
          dailyRepeat: true,
        });
      }
    } catch (e) {
      /* silent */
    }
  },

  /**
   * Startup re-sync: (re-)schedules OS notifications for all upcoming
   * appointments, medications, bills, birthdays, workouts and tasks.
   * Idempotent — notifications that are already pending are left untouched,
   * so this never duplicates. Missing ones (e.g. scheduled while the app was
   * updated) are created so notifications survive restarts.
   */
  async resyncAll(data: {
    appointments?: Appointment[];
    medications?: Medication[];
    bills?: Bill[];
    birthdays?: Birthday[];
    workouts?: Workout[];
    todos?: Todo[];
  }) {
    if (!isNative()) return;
    try {
      const jobs: Promise<void>[] = [];

      data.appointments?.forEach((apt) => jobs.push(this.scheduleAppointment(apt)));
      data.medications?.forEach((med) => jobs.push(this.scheduleMedication(med)));
      data.bills?.forEach((bill) => jobs.push(this.scheduleBill(bill)));
      data.birthdays?.forEach((bday) => jobs.push(this.scheduleBirthday(bday)));
      data.workouts?.forEach((wk) => jobs.push(this.scheduleWorkout(wk)));
      data.todos?.forEach((todo) => jobs.push(this.scheduleTodo(todo)));

      jobs.push(this.resyncRecurringReminders());

      await Promise.all(jobs);
    } catch (e) {
      /* silent */
    }
  },
};
