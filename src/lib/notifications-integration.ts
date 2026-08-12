import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  NotificationService,
  REMINDER_CHANNEL,
  WALK_FALLBACK_CHANNEL,
  type PlannedNotification,
} from "./notifications";
import {
  Appointment,
  Medication,
  Bill,
  Birthday,
  Workout,
  Todo,
  WorkoutProgram,
  DayKey,
} from "./types";
import { DAY_LABELS } from "./api";

/* ────────────────────────────────────────────────────────────────────────────
 * Native bridge to the Android walk foreground service.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface WalkStatusUpdate {
  tracking: boolean;
  paused?: boolean;
  distanceKm: number;
  steps: number;
  durationSec: number;
  calories: number;
  paceMinPerKm: number;
  updateCount: number;
  timestamp: number;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  speed?: number;
  /** Firestore session id the native service is persisting route points under. */
  sessionId?: string;
  /** True when the native service detected vehicle-speed motion (flag only). */
  isVehicleFlagged?: boolean;
  /** Sent when the user taps Pause/Resume/Finish on the native notification. */
  action?: "pause" | "resume" | "finish";
}

export interface WalkRoutePoint {
  lat: number;
  lng: number;
  /** Epoch ms — required so the saved session path keeps the WalkSession shape. */
  ts: number;
  altitude?: number;
  accuracy?: number;
  speed?: number;
}

export interface WalkServicePluginInterface {
  startService(args: {
    distanceKm: number;
    steps: number;
    durationSec: number;
    calories: number;
    paceMinPerKm: number;
    /** Firestore session id — native SQLite route points are stored under it. */
    sessionId?: string;
    /** User body weight in kg — drives the native calorie math. */
    weightKg?: number;
    /** Start the service frozen (paused) — used when a walk is recovered after process death. */
    paused?: boolean;
  }): Promise<{ started: boolean; error?: string }>;
  updateService(args: {
    distanceKm: number;
    steps: number;
    durationSec: number;
    calories: number;
    paceMinPerKm: number;
    weightKg?: number;
  }): Promise<{ updated: boolean }>;
  pauseService(): Promise<{ paused: boolean }>;
  resumeService(args: {
    distanceKm: number;
    steps: number;
    durationSec: number;
    calories: number;
    paceMinPerKm: number;
    weightKg?: number;
  }): Promise<{ resumed: boolean }>;
  stopService(): Promise<{ stopped: boolean }>;
  /** Live snapshot of the native walking foreground service. */
  getStatus(): Promise<WalkStatusUpdate>;
  /** Route points persisted by the native service for a session (SQLite). */
  getRoutePoints(args?: {
    sessionId?: string;
  }): Promise<{ sessionId: string; isVehicleFlagged: boolean; points: string }>;
  /** Deletes the native SQLite route points for a session. */
  clearRoutePoints(args?: { sessionId?: string }): Promise<{ cleared: boolean }>;
  /** Pushed on every native location fix / step while the service tracks. */
  addListener(
    eventName: "walkUpdate",
    listenerFunc: (data: WalkStatusUpdate) => void,
  ): Promise<{ remove: () => void }>;
}

export const WalkServicePlugin = registerPlugin<WalkServicePluginInterface>("WalkService");

/* ────────────────────────────────────────────────────────────────────────────
 * Date helpers (timezone-safe)
 *
 * `new Date("2024-08-09")` parses as UTC midnight, so for a user east of UTC
 * the date rolls back a day — birthdays and appointment dates were landing on
 * the wrong calendar day. These helpers treat the input as LOCAL time.
 * ──────────────────────────────────────────────────────────────────────────── */

import { parseLocalDate as parseDateUtil } from "./date-utils";

function parseLocalDate(value?: string | null): Date | null {
  if (!value) return null;
  try {
    return parseDateUtil(value);
  } catch {
    return null;
  }
}

function parseTime(value?: string | null, fallbackHour = 9, fallbackMinute = 0): [number, number] {
  if (!value) return [fallbackHour, fallbackMinute];
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return [fallbackHour, fallbackMinute];
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return [h, min];
}

function atLocalDate(d: Date, hour: number, minute: number): Date {
  const out = new Date(d);
  out.setHours(hour, minute, 0, 0);
  return out;
}

function nextYearOn(month0: number, day: number, hour: number, minute: number): Date {
  const now = new Date();
  let next = new Date(now.getFullYear(), month0, day, hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next = new Date(now.getFullYear() + 1, month0, day, hour, minute, 0, 0);
  }
  return next;
}

const isNative = () => Capacitor.isNativePlatform();

/* ────────────────────────────────────────────────────────────────────────────
 * Logical key prefixes (used by reconcile to find owned notifications).
 * ──────────────────────────────────────────────────────────────────────────── */
export const KEY_PREFIXES = [
  "apt_",
  "med_",
  "todo_",
  "bill_",
  "bday_",
  "wkout_",
  "wktmr_",
  "daily_",
] as const;

function legacyId(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

let legacyCleanupDone = false;
async function runLegacyCleanup() {
  if (legacyCleanupDone || !isNative()) return;
  legacyCleanupDone = true;
  const ids = ["daily_reminder", "walk_tracking", "med_reminder_channel", "lifehub_reminders"].map(
    legacyId,
  );
  await NotificationService.cancelLegacyIds(ids);
}

/**
 * True once the native walk foreground service could not be started and the
 * JS fallback notification was shown instead. While true, live metrics keep
 * refreshing that fallback notification so it never freezes at 0.00 km.
 */
let walkFallbackActive = false;
/** Last time the fallback notification was refreshed (throttled). */
let lastFallbackRefreshMs = 0;

/* ────────────────────────────────────────────────────────────────────────────
 * Plan builders. Each returns the set of notifications an entity needs.
 * ──────────────────────────────────────────────────────────────────────────── */

function appointmentPlans(apt: Appointment): PlannedNotification[] {
  if (apt.status === "cancelled" || apt.status === "completed") return [];
  const date = parseLocalDate(apt.appointment_date);
  if (!date) return [];
  const [h, m] = parseTime(apt.start_time, 9, 0);
  const at = atLocalDate(date, h, m);
  const wantsReminder = apt.reminder === undefined ? true : apt.reminder;
  if (!wantsReminder) return [];

  const offsetMinutes = Math.max(0, Number(apt.reminder_offset_minutes ?? 30));
  const reminderAt = new Date(at.getTime() - offsetMinutes * 60 * 1000);
  const screen = { screen: "/appointments", appointmentId: apt.id };
  const plans: PlannedNotification[] = [];

  if (reminderAt.getTime() > Date.now()) {
    plans.push({
      key: `apt_${apt.id}_reminder`,
      title: `Appointment reminder: ${apt.title}`,
      body: `Starts ${apt.start_time || "09:00"}${offsetMinutes > 0 ? ` in ${offsetMinutes} minutes` : ""}`,
      largeBody: `${apt.doctor_name ? `Doctor: ${apt.doctor_name}\n` : ""}When: ${apt.start_time || "09:00"}${
        apt.location ? `\nWhere: ${apt.location}` : ""
      }`,
      at: reminderAt,
      channelId: REMINDER_CHANNEL,
      extra: screen,
    });
  } else if (at.getTime() > Date.now()) {
    plans.push({
      key: `apt_${apt.id}_start`,
      title: `Appointment now: ${apt.title}`,
      body: `With ${apt.doctor_name || "your doctor"} right now`,
      at,
      channelId: REMINDER_CHANNEL,
      extra: screen,
    });
  }

  return plans;
}

function medicationPlans(med: Medication): PlannedNotification[] {
  const [h, m] = parseTime(med.scheduled_time, 9, 0);
  return [
    {
      key: `med_${med.id}`,
      title: `Medication: ${med.name}`,
      body: `Take ${med.dosage} now`,
      on: { hour: h, minute: m, second: 0 },
      channelId: REMINDER_CHANNEL,
      extra: { screen: "/medications", medicationId: med.id },
    },
  ];
}

function todoPlans(todo: Todo): PlannedNotification[] {
  if (todo.completed) return [];
  const date = parseLocalDate(todo.due_date);
  if (!date) return [];
  return [
    {
      key: `todo_${todo.id}`,
      title: `Task due: ${todo.title}`,
      body: `"${todo.title}" is due today`,
      at: atLocalDate(date, 9, 0),
      channelId: REMINDER_CHANNEL,
      extra: { screen: "/tasks", todoId: todo.id },
    },
  ];
}

function billPlans(bill: Bill): PlannedNotification[] {
  if (bill.status === "paid") return [];
  const date = parseLocalDate(bill.due_date);
  if (!date) return [];
  const due = atLocalDate(date, 9, 0);
  const screen = { screen: "/bills", billId: bill.id };
  return [
    {
      key: `bill_${bill.id}_3d`,
      title: `Bill due in 3 days: ${bill.title}`,
      body: `$${bill.amount.toFixed(2)} is due soon`,
      at: new Date(due.getTime() - 3 * 24 * 3600 * 1000),
      channelId: REMINDER_CHANNEL,
      extra: screen,
    },
    {
      key: `bill_${bill.id}_now`,
      title: `Bill due today: ${bill.title}`,
      body: `$${bill.amount.toFixed(2)} is due today`,
      at: due,
      channelId: REMINDER_CHANNEL,
      extra: screen,
    },
  ];
}

/** Birthday reminders fire at 17:00 on the day itself and the day before. */
const BIRTHDAY_HOUR = 17;
const BIRTHDAY_MINUTE = 0;

/* ────────────────────────────────────────────────────────────────────────────
 * Daily adhkar reminders (always-on, no user data).
 * ──────────────────────────────────────────────────────────────────────────── */
const ADHKAR_MORNING_HOUR = 6;
const ADHKAR_MORNING_MINUTE = 0;
const ADHKAR_EVENING_HOUR = 12;
const ADHKAR_EVENING_MINUTE = 0;

/** Next calendar occurrence of a birthday (month/day) at 17:00 local time. */
function nextBirthdayAt(month0: number, day: number): Date {
  const now = new Date();
  let next = new Date(now.getFullYear(), month0, day, BIRTHDAY_HOUR, BIRTHDAY_MINUTE, 0, 0);
  // Feb 29 in a non-leap year rolls over into March 1 — pin to Feb 28 instead
  // so the reminder never lands on the wrong calendar day.
  if (month0 === 1 && day === 29 && next.getMonth() !== 1) {
    next = new Date(now.getFullYear(), 1, 28, BIRTHDAY_HOUR, BIRTHDAY_MINUTE, 0, 0);
  }
  if (next.getTime() <= now.getTime()) {
    next = new Date(now.getFullYear() + 1, month0, day, BIRTHDAY_HOUR, BIRTHDAY_MINUTE, 0, 0);
    if (month0 === 1 && day === 29 && next.getMonth() !== 1) {
      next = new Date(now.getFullYear() + 1, 1, 28, BIRTHDAY_HOUR, BIRTHDAY_MINUTE, 0, 0);
    }
  }
  return next;
}

function birthdayPlans(bday: Birthday): PlannedNotification[] {
  const date = parseLocalDate(bday.birthday_date);
  if (!date) return [];

  const next = nextBirthdayAt(date.getMonth(), date.getDate());
  const screen = { screen: "/birthdays", birthdayId: bday.id };
  const plans: PlannedNotification[] = [
    {
      key: `bday_${bday.id}_day`,
      title: `🎂 Birthday today: ${bday.full_name}`,
      body: `It's ${bday.full_name}'s birthday — say happy birthday!`,
      at: next,
      channelId: REMINDER_CHANNEL,
      extra: screen,
    },
  ];

  const dayBefore = new Date(next.getTime() - 24 * 3600 * 1000);
  if (dayBefore.getTime() > Date.now()) {
    plans.unshift({
      key: `bday_${bday.id}_day_before`,
      title: `🎂 Birthday tomorrow: ${bday.full_name}`,
      body: `Don't forget to wish ${bday.full_name} a happy birthday tomorrow!`,
      at: dayBefore,
      channelId: REMINDER_CHANNEL,
      extra: screen,
    });
  }

  return plans;
}

function workoutPlans(wk: Workout): PlannedNotification[] {
  const at = new Date(wk.scheduled_at);
  return [
    {
      key: `wkout_${wk.id}`,
      title: `Workout: ${wk.session_name}`,
      body: `Your workout starts in 30 minutes`,
      at: new Date(at.getTime() - 30 * 60 * 1000),
      channelId: REMINDER_CHANNEL,
      extra: { screen: "/workouts", workoutId: wk.id },
    },
  ];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Daily "tomorrow's workout" reminder (18:00).
 *
 * A static daily recurrence can't know which day is next, so this arms one
 * one-shot per upcoming day (18:00 local) previewing the FOLLOWING day's
 * session — only when that day is a training day, so rest days never nag.
 * Keys are date-based (`wktmr_YYYY-MM-DD`), which makes every resync
 * idempotent: unchanged days re-arm with fresh content, passed days and
 * removed programs drop out via reconcile.
 * ──────────────────────────────────────────────────────────────────────────── */
const TOMORROW_WORKOUT_HOUR = 18;
const TOMORROW_WORKOUT_MINUTE = 0;
/** How many upcoming 18:00 slots stay armed. */
const TOMORROW_WORKOUT_WINDOW_DAYS = 14;

const WORKOUT_DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function workoutDayKeyOf(d: Date): DayKey {
  return WORKOUT_DAY_KEYS[d.getDay()];
}

function workoutFocusForDay(program: WorkoutProgram, day: DayKey): string {
  if (program.workout_type === "Cardio") {
    const structured = program.training_days;
    if (structured && structured.length > 0) {
      return structured.includes(day) ? "Cardio" : "Rest";
    }
    const focus = (program.weekly_plan || []).find((x) => x.day === day)?.focus || "";
    return focus.toLowerCase() !== "rest" ? "Cardio" : "Rest";
  }
  return (program.weekly_plan || []).find((x) => x.day === day)?.focus || "Rest";
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function workoutTomorrowPlans(program: WorkoutProgram | null | undefined): PlannedNotification[] {
  if (!program) return [];
  const plans: PlannedNotification[] = [];
  const now = new Date();
  for (let i = 0; i < TOMORROW_WORKOUT_WINDOW_DAYS; i++) {
    const fireDate = new Date(now);
    fireDate.setDate(now.getDate() + i);
    const fireAt = atLocalDate(fireDate, TOMORROW_WORKOUT_HOUR, TOMORROW_WORKOUT_MINUTE);
    if (fireAt.getTime() <= Date.now()) continue;

    const subject = new Date(fireDate);
    subject.setDate(fireDate.getDate() + 1);
    const subjectDayKey = workoutDayKeyOf(subject);
    const focus = workoutFocusForDay(program, subjectDayKey);
    if (focus.toLowerCase() === "rest") continue;

    plans.push({
      key: `wktmr_${localDateKey(fireDate)}`,
      title: `Tomorrow's workout: ${focus}`,
      body: `${DAY_LABELS[subjectDayKey]} · ${focus} — get ready!`,
      at: fireAt,
      channelId: REMINDER_CHANNEL,
      extra: { screen: "/workouts" },
    });
  }
  return plans;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Integration API used by the routes / data context.
 * ──────────────────────────────────────────────────────────────────────────── */

export const Notifications = {
  /* ─── Appointments ────────────────────────────────────────────────────── */
  scheduleAppointment(apt: Appointment) {
    return NotificationService.schedulePlans(appointmentPlans(apt));
  },
  cancelAppointment(aptId: string) {
    return NotificationService.cancel(
      `apt_${aptId}_reminder`,
      `apt_${aptId}_start`,
      `apt_${aptId}_day_before`,
      `apt_${aptId}_day`,
    );
  },

  /* ─── Medications ─────────────────────────────────────────────────────── */
  scheduleMedication(med: Medication) {
    return NotificationService.schedulePlans(medicationPlans(med));
  },
  cancelMedication(medId: string) {
    return NotificationService.cancel(`med_${medId}`);
  },

  /* ─── Tasks ───────────────────────────────────────────────────────────── */
  scheduleTodo(todo: Todo) {
    return NotificationService.schedulePlans(todoPlans(todo));
  },
  cancelTodo(todoId: string) {
    return NotificationService.cancel(`todo_${todoId}`);
  },

  /* ─── Bills ───────────────────────────────────────────────────────────── */
  scheduleBill(bill: Bill) {
    return NotificationService.schedulePlans(billPlans(bill));
  },
  cancelBill(billId: string) {
    return NotificationService.cancel(`bill_${billId}_3d`, `bill_${billId}_now`);
  },

  /* ─── Birthdays ───────────────────────────────────────────────────────── */
  scheduleBirthday(bday: Birthday) {
    return NotificationService.schedulePlans(birthdayPlans(bday));
  },
  cancelBirthday(bdayId: string) {
    return NotificationService.cancel(
      `bday_${bdayId}_day_before`,
      `bday_${bdayId}_day`,
      `bday_${bdayId}_immediate`,
    );
  },

  /* ─── Workouts ────────────────────────────────────────────────────────── */
  scheduleWorkout(wk: Workout) {
    return NotificationService.schedulePlans(workoutPlans(wk));
  },
  cancelWorkout(wkId: string) {
    return NotificationService.cancel(`wkout_${wkId}`);
  },

  /* ─── Tomorrow's workout reminder (daily 18:00) ──────────────────────── */
  scheduleWorkoutTomorrowReminders(program: WorkoutProgram | null | undefined) {
    return NotificationService.schedulePlans(workoutTomorrowPlans(program));
  },
  cancelWorkoutTomorrowReminders() {
    return NotificationService.cancelByPrefix("wktmr_");
  },

  /* ─── Walking Tracking Notification (Foreground Service) ─────────────── */
  async startWalkForeground(
    distanceKm = 0,
    steps = 0,
    durationSec = 0,
    calories = 0,
    paceMinPerKm = 0,
    weightKg = 70,
    sessionId?: string,
    paused = false,
  ) {
    if (!isNative()) return;
    try {
      await NotificationService.initChannels();
      const result = await WalkServicePlugin.startService({
        distanceKm,
        steps,
        durationSec,
        calories,
        paceMinPerKm,
        weightKg,
        sessionId,
        paused,
      });
      if (!result.started) {
        walkFallbackActive = true;
        this.scheduleWalkReminder(
          "🚶 Walking session in progress",
          "Tracking your walk in the background.",
        );
      } else {
        walkFallbackActive = false;
      }
    } catch (e) {
      walkFallbackActive = true;
      this.scheduleWalkReminder(
        "🚶 Walking session in progress",
        "Tracking your walk in the background.",
      );
    }
  },

  /**
   * Refreshes the JS-walk fallback notification with the current LIVE metrics.
   *
   * The fallback notification is only shown when the native foreground service
   * failed to start entirely (no FGS permissions, Android 12+ launch
   * restriction, etc.). While it is active the app keeps counting in JS, and
   * the poll in use-walk calls this so the notification mirrors the real
   * numbers instead of a frozen "Tracking your walk in the background." Pushed
   * at most every 15s to avoid reposting the notification every 4s poll.
   */
  async refreshWalkFallback(distanceKm = 0, steps = 0, durationSec = 0, calories = 0) {
    if (!isNative() || !walkFallbackActive) return;
    const now = Date.now();
    if (now - lastFallbackRefreshMs < 15_000) return;
    lastFallbackRefreshMs = now;
    const mins = Math.floor(durationSec / 60);
    const secs = Math.floor(durationSec % 60);
    const body =
      `${distanceKm.toFixed(2)} km · ${steps.toLocaleString("en-US")} steps · ` +
      `${mins}m ${secs}s · ${Math.round(calories)} kcal (app fallback)`;
    await this.scheduleWalkReminder("🚶 Walking session in progress", body);
  },

  async pauseWalkForeground() {
    if (!isNative()) return;
    try {
      await WalkServicePlugin.pauseService();
    } catch (e) {
      /* silent */
    }
  },

  async resumeWalkForeground(
    distanceKm: number,
    steps: number,
    durationSec: number,
    calories: number,
    paceMinPerKm: number,
    weightKg = 70,
  ) {
    if (!isNative()) return;
    try {
      await WalkServicePlugin.resumeService({
        distanceKm,
        steps,
        durationSec,
        calories,
        paceMinPerKm,
        weightKg,
      });
    } catch (e) {
      /* silent */
    }
  },

  async stopWalkForeground() {
    if (!isNative()) return;
    if (walkFallbackActive) {
      walkFallbackActive = false;
      await NotificationService.cancel("walk_tracking_fallback");
    }
    try {
      await WalkServicePlugin.stopService();
    } catch (e) {
      /* silent */
    }
  },

  async scheduleWalkReminder(title: string, body: string) {
    if (!isNative()) return;
    try {
      await NotificationService.initChannels();
      await NotificationService.schedule({
        key: "walk_tracking_fallback",
        title,
        body,
        // Post immediately: the old `at: now + 1s` fell under MIN_LEAD_MS in
        // buildSchema and was rejected, so the fallback never displayed.
        deliverNow: true,
        channelId: WALK_FALLBACK_CHANNEL,
        extra: { screen: "/walk" },
      });
    } catch (e) {
      /* silent */
    }
  },

  /* ─── Recurring daily check-in reminder ──────────────────────────────── */
  async scheduleDailyReminder(hour: number = 8, minute: number = 0) {
    const settings = readReminderSettings();
    settings.daily = { enabled: true, hour, minute };
    saveReminderSettings(settings);
    return NotificationService.schedule({
      key: "daily_reminder",
      title: "LifeHub Daily Check-in",
      body: "Don't forget to check your medications, bills, and tasks!",
      on: { hour, minute, second: 0 },
      channelId: REMINDER_CHANNEL,
      extra: { screen: "/" },
    });
  },

  async cancelDailyReminder() {
    const settings = readReminderSettings();
    settings.daily = { ...settings.daily, enabled: false };
    saveReminderSettings(settings);
    return NotificationService.cancel("daily_reminder");
  },

  async resyncRecurringReminders() {
    const settings = readReminderSettings();
    if (settings.daily.enabled) {
      return this.scheduleDailyReminder(settings.daily.hour, settings.daily.minute);
    }
    return Promise.resolve();
  },

  /* ─── Daily adhkar reminders ─────────────────────────────────────────── */
  async resyncAzkarReminders() {
    if (!isNative()) return;
    // Respect permission WITHOUT prompting (unlike ensurePermission, which
    // re-shows the OS dialog). The one-time install prompt already happened
    // in RootComponent; granting later triggers PERMISSIONS_CHANGED_EVENT,
    // which re-runs this resync.
    try {
      const { PermissionManager } = await import("./permissions");
      if (!(await PermissionManager.check("notification"))) return;
    } catch {
      return;
    }
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
  },

  /**
   * Brings every OS reminder into sync with the supplied data.
   *
   * Runs a full reconcile per entity type: anything previously scheduled that
   * is no longer present (or no longer qualifies, e.g. a completed/cancelled
   * appointment, a paid bill) is cancelled, while missing or changed reminders
   * are (re)scheduled. Safe to run on every cold start and on app resume.
   */
  async resyncAll(data: {
    appointments?: Appointment[];
    medications?: Medication[];
    bills?: Bill[];
    birthdays?: Birthday[];
    workouts?: Workout[];
    todos?: Todo[];
    workoutPrograms?: WorkoutProgram[];
  }) {
    if (!isNative()) return;
    await runLegacyCleanup();
    await NotificationService.initChannels();
    await NotificationService.deleteLegacyChannels();

    // Per-prefix reconcile with explicit results — a silently swallowed
    // failure here hid every reminder until the next data mutation.
    const reconcile = async (label: string, plans: PlannedNotification[], prefixes: string[]) => {
      try {
        await NotificationService.reconcile(plans, prefixes);
        console.info(`[notifications] resync ${label}: reconciled ${plans.length} plan(s)`);
      } catch (err) {
        console.warn(`[notifications] resync ${label}: failed`, err);
      }
    };

    await reconcile("appointments", (data.appointments || []).flatMap(appointmentPlans), ["apt_"]);
    await reconcile("medications", (data.medications || []).flatMap(medicationPlans), ["med_"]);
    await reconcile("bills", (data.bills || []).flatMap(billPlans), ["bill_"]);
    await reconcile("birthdays", (data.birthdays || []).flatMap(birthdayPlans), ["bday_"]);
    await reconcile("workouts", (data.workouts || []).flatMap(workoutPlans), ["wkout_"]);
    await reconcile("todos", (data.todos || []).flatMap(todoPlans), ["todo_"]);
    const activeProgram =
      data.workoutPrograms?.find((p) => p.is_active) || data.workoutPrograms?.[0];
    await reconcile("tomorrow workouts", activeProgram ? workoutTomorrowPlans(activeProgram) : [], [
      "wktmr_",
    ]);
    try {
      await this.resyncRecurringReminders();
    } catch (err) {
      console.warn("[notifications] resync daily reminder: failed", err);
    }
    try {
      await this.resyncAzkarReminders();
    } catch (err) {
      console.warn("[notifications] resync adhkar reminders: failed", err);
    }
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * Daily-reminder persisted settings (read by the profile screen).
 * ──────────────────────────────────────────────────────────────────────────── */

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
    const raw = window.localStorage.getItem(REMINDER_SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return { daily: { ...defaults.daily, ...(parsed.daily || {}) } };
  } catch {
    return defaults;
  }
}

export function saveReminderSettings(settings: RecurringReminderSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REMINDER_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}
