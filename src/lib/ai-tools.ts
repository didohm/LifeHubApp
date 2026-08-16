/**
 * LifeHub AI Tool Layer — the assistant's live interface to the user's data.
 *
 * The assistant is an orchestrator, NOT a database:
 *
 *   User → Intent Detection → Tool call → Firestore (fresh read) → Answer
 *
 * It never relies on a snapshot of user data captured at page load. Every
 * answer about the user's personal data triggers a fresh tool call at request
 * time, so a task added one minute ago is visible immediately.
 *
 * The API layer (src/lib/api.ts) is the single source of truth. This module
 * only decides WHICH data to fetch and shapes it for the prompt — it never
 * invents records.
 */

import {
  getAppointments,
  getMedications,
  getBills,
  getTodos,
  getDocuments,
  getBirthdays,
  getWorkouts,
  getWalkSessions,
  getTodayWaterLog,
  getWaterLogs,
  getActivityTimeline,
  getUserProfile,
  getProfileStats,
  type ProfileStats,
  type ActivityEntry,
} from "./api";
import type {
  User,
  Appointment,
  Medication,
  Bill,
  Todo,
  DocumentItem,
  Birthday,
  Workout,
  WalkSession,
  WaterLog,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────
//  Modules & filters — the queryUserData({ module, filters }) contract
// ─────────────────────────────────────────────────────────────────────────

export type DataModule =
  | "tasks"
  | "appointments"
  | "medications"
  | "bills"
  | "documents"
  | "birthdays"
  | "workouts"
  | "walks"
  | "water"
  | "activity"
  | "profile"
  | "overview";

export interface DataFilters {
  /** keep only items that fall on today (local date) */
  today?: boolean;
  /** status-based subsets: upcoming appointments / unpaid bills / upcoming birthdays */
  upcoming?: boolean;
  /** tasks: only completed; medications: only taken */
  completed?: boolean;
  /** tasks: only open; medications: only pending */
  pending?: boolean;
  /** exact status string, e.g. "paid" | "unpaid" | "scheduled" | "completed" */
  status?: string;
  /** YYYY-MM-DD — keep only items due/dated on this day */
  dueDate?: string;
  /** maximum number of records to return */
  limit?: number;
  /** free-text filter over the module's main fields (name/title/doctor…) */
  query?: string;
}

export interface QueryResult {
  module: DataModule;
  filters: DataFilters;
  fetchedAt: string;
  items: Array<Record<string, unknown>>;
  /** computed extra data (e.g. profile stats) — always real, never invented */
  extra?: Record<string, unknown>;
  truncated?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
//  getUserContext() — the "power tool": one call, whole day snapshot
// ─────────────────────────────────────────────────────────────────────────

export interface UserContextSnapshot {
  profile: User | null;
  today: {
    tasks: Todo[];
    appointments: Appointment[];
    medications: Medication[];
    workouts: Workout[];
    walks: WalkSession[];
    water: WaterLog | null;
    bills: Bill[];
  };
  upcoming: {
    appointments: Appointment[];
    bills: Bill[];
    birthdays: Birthday[];
  };
  outstanding: {
    tasks: Todo[];
    medications: Medication[];
    bills: Bill[];
  };
  recentActivity: ActivityEntry[];
  stats: ProfileStats | null;
  fetchedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────

/** Local date as YYYY-MM-DD (matches api.ts daily resets). */
export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toLocalDate(d: Date = new Date()): string {
  return todayKey(d);
}

function matchesQuery(item: Record<string, unknown>, query?: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return Object.values(item).some((v) => typeof v === "string" && v.toLowerCase().includes(q));
}

function nextBirthdayOccurrence(birthdayDate: string, today: string): string | null {
  const parts = birthdayDate.split("-");
  if (parts.length !== 3) return null;
  const mm = parts[1];
  const dd = parts[2];
  if (!mm || !dd) return null;
  const year = Number(today.slice(0, 4));
  const thisYear = `${year}-${mm}-${dd}`;
  return thisYear >= today ? thisYear : `${year + 1}-${mm}-${dd}`;
}

function daysUntil(date: string, from: string): number {
  const a = new Date(`${date}T00:00:00`).getTime();
  const b = new Date(`${from}T00:00:00`).getTime();
  return Math.round((a - b) / 86_400_000);
}

function applyLimit<T>(items: T[], limitCount?: number): { items: T[]; truncated: boolean } {
  if (!limitCount || items.length <= limitCount) return { items, truncated: false };
  return { items: items.slice(0, limitCount), truncated: true };
}

// ─────────────────────────────────────────────────────────────────────────
//  queryUserData() — the single generic tool
//  Fetches FRESH data from Firestore for one module, applies filters,
//  and returns normalized records. Returns [] when nothing matches —
//  it never fabricates entries.
// ─────────────────────────────────────────────────────────────────────────

export async function queryUserData(
  userId: string,
  module: DataModule,
  filters: DataFilters = {},
): Promise<QueryResult> {
  const today = toLocalDate();
  const base: QueryResult = { module, filters, fetchedAt: new Date().toISOString(), items: [] };

  switch (module) {
    case "tasks": {
      const all = await getTodos(userId);
      let items = all;
      if (filters.today) items = items.filter((t) => t.due_date === today);
      if (filters.dueDate) items = items.filter((t) => t.due_date === filters.dueDate);
      if (filters.completed !== undefined)
        items = items.filter((t) => t.completed === filters.completed);
      if (filters.pending) items = items.filter((t) => !t.completed);
      if (filters.query)
        items = items.filter((t) =>
          `${t.title} ${t.category}`
            .toLowerCase()
            .includes((filters.query as string).toLowerCase()),
        );
      const { items: out, truncated } = applyLimit(items, filters.limit);
      return { ...base, items: out as unknown as Record<string, unknown>[], truncated };
    }

    case "appointments": {
      const all = await getAppointments(userId);
      let items = all;
      if (filters.today) items = items.filter((a) => a.appointment_date === today);
      if (filters.dueDate) items = items.filter((a) => a.appointment_date === filters.dueDate);
      if (filters.upcoming)
        items = items.filter((a) => a.status === "upcoming" && a.appointment_date >= today);
      if (filters.status) items = items.filter((a) => a.status === filters.status);
      if (filters.query)
        items = items.filter((a) =>
          `${a.title} ${a.doctor_name} ${a.location || ""}`
            .toLowerCase()
            .includes((filters.query as string).toLowerCase()),
        );
      const { items: out, truncated } = applyLimit(items, filters.limit);
      return { ...base, items: out as unknown as Record<string, unknown>[], truncated };
    }

    case "medications": {
      const all = await getMedications(userId);
      let items = all;
      // Medications are recurring daily items; "today" means the ones still due.
      if (filters.today) items = items.filter((m) => !m.taken || filters.pending === false);
      if (filters.pending) items = items.filter((m) => !m.taken);
      if (filters.completed) items = items.filter((m) => m.taken);
      if (filters.query)
        items = items.filter((m) =>
          `${m.name} ${m.dosage}`.toLowerCase().includes((filters.query as string).toLowerCase()),
        );
      const { items: out, truncated } = applyLimit(items, filters.limit);
      return { ...base, items: out as unknown as Record<string, unknown>[], truncated };
    }

    case "bills": {
      const all = await getBills(userId);
      let items = all;
      if (filters.today) items = items.filter((b) => b.due_date === today);
      if (filters.dueDate) items = items.filter((b) => b.due_date === filters.dueDate);
      if (filters.upcoming) items = items.filter((b) => b.status !== "paid" && b.due_date >= today);
      if (filters.pending) items = items.filter((b) => b.status !== "paid");
      if (filters.status) items = items.filter((b) => b.status === filters.status);
      if (filters.query)
        items = items.filter((b) =>
          `${b.title} ${b.category}`
            .toLowerCase()
            .includes((filters.query as string).toLowerCase()),
        );
      const { items: out, truncated } = applyLimit(items, filters.limit);
      return { ...base, items: out as unknown as Record<string, unknown>[], truncated };
    }

    case "documents": {
      const all = await getDocuments(userId);
      let items = all;
      if (filters.query)
        items = items.filter((d) =>
          `${d.name} ${d.category}`.toLowerCase().includes((filters.query as string).toLowerCase()),
        );
      const { items: out, truncated } = applyLimit(items, filters.limit);
      return { ...base, items: out as unknown as Record<string, unknown>[], truncated };
    }

    case "birthdays": {
      const all = await getBirthdays(userId);
      let items = all;
      if (filters.upcoming) {
        items = all
          .map((b) => ({ b, next: nextBirthdayOccurrence(b.birthday_date, today) }))
          .filter(
            (x): x is { b: Birthday; next: string } =>
              !!x.next && daysUntil(x.next, today) >= 0 && daysUntil(x.next, today) <= 30,
          )
          .sort((a, z) => a.next.localeCompare(z.next))
          .map((x) => x.b);
      }
      if (filters.query)
        items = items.filter((b) =>
          `${b.full_name}`.toLowerCase().includes((filters.query as string).toLowerCase()),
        );
      const { items: out, truncated } = applyLimit(items, filters.limit);
      return { ...base, items: out as unknown as Record<string, unknown>[], truncated };
    }

    case "workouts": {
      const all = await getWorkouts(userId);
      let items = all;
      if (filters.today) items = items.filter((w) => w.scheduled_date === today);
      if (filters.dueDate) items = items.filter((w) => w.scheduled_date === filters.dueDate);
      if (filters.upcoming)
        items = items.filter((w) => w.status === "scheduled" && w.scheduled_date >= today);
      if (filters.status) items = items.filter((w) => w.status === filters.status);
      if (filters.query)
        items = items.filter((w) =>
          `${w.session_name} ${w.workout_type || ""} ${w.program_name || ""}`
            .toLowerCase()
            .includes((filters.query as string).toLowerCase()),
        );
      const { items: out, truncated } = applyLimit(items, filters.limit);
      return { ...base, items: out as unknown as Record<string, unknown>[], truncated };
    }

    case "walks": {
      const all = await getWalkSessions(userId);
      let items = all;
      if (filters.today) items = items.filter((w) => w.day === today);
      if (filters.status) items = items.filter((w) => w.status === filters.status);
      else items = items.filter((w) => w.status === "finished");
      const { items: out, truncated } = applyLimit(items, filters.limit || 10);
      return { ...base, items: out as unknown as Record<string, unknown>[], truncated };
    }

    case "water": {
      const [todayLog, recent] = await Promise.all([
        getTodayWaterLog(userId),
        getWaterLogs(userId, 7),
      ]);
      return {
        ...base,
        items: recent as unknown as Record<string, unknown>[],
        extra: {
          today: todayLog
            ? {
                glasses: todayLog.glasses,
                goal: todayLog.goal,
                goal_reached: todayLog.goal_reached,
                day: todayLog.day,
              }
            : null,
        },
      };
    }

    case "activity": {
      const entries = await getActivityTimeline(userId, filters.limit || 15);
      return { ...base, items: entries as unknown as Record<string, unknown>[] };
    }

    case "profile": {
      const [profile, stats] = await Promise.all([getUserProfile(userId), getProfileStats(userId)]);
      return {
        ...base,
        items: profile ? [profile as unknown as Record<string, unknown>] : [],
        extra: { stats },
      };
    }

    case "overview": {
      const snapshot = await getUserContext(userId);
      return {
        ...base,
        items: [],
        extra: { snapshot },
      };
    }

    default:
      return base;
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  getUserContext() — full today snapshot via parallel fresh reads
// ─────────────────────────────────────────────────────────────────────────

export async function getUserContext(userId: string): Promise<UserContextSnapshot> {
  const today = toLocalDate();

  const [
    tasks,
    appointments,
    medications,
    bills,
    birthdays,
    workouts,
    walks,
    todayWater,
    recentActivity,
    profile,
    stats,
  ] = await Promise.all([
    getTodos(userId),
    getAppointments(userId),
    getMedications(userId),
    getBills(userId),
    getBirthdays(userId),
    getWorkouts(userId),
    getWalkSessions(userId),
    getTodayWaterLog(userId),
    getActivityTimeline(userId, 10),
    getUserProfile(userId),
    getProfileStats(userId),
  ]);

  const upcomingAppointments = appointments
    .filter((a) => a.status === "upcoming" && a.appointment_date >= today)
    .sort((a, b) => a.appointment_date.localeCompare(b.appointment_date));
  const upcomingBills = bills
    .filter((b) => b.status !== "paid" && b.due_date >= today)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const upcomingBirthdays = birthdays
    .map((b) => ({ b, next: nextBirthdayOccurrence(b.birthday_date, today) }))
    .filter(
      (x): x is { b: Birthday; next: string } =>
        !!x.next && daysUntil(x.next, today) >= 0 && daysUntil(x.next, today) <= 30,
    )
    .sort((a, z) => a.next.localeCompare(z.next))
    .map((x) => x.b);

  return {
    profile,
    today: {
      tasks: tasks.filter((t) => t.due_date === today),
      appointments: appointments.filter((a) => a.appointment_date === today),
      medications,
      workouts: workouts.filter((w) => w.scheduled_date === today),
      walks: walks.filter((w) => w.day === today && w.status === "finished"),
      water: todayWater,
      bills: bills.filter((b) => b.due_date === today),
    },
    upcoming: {
      appointments: upcomingAppointments,
      bills: upcomingBills,
      birthdays: upcomingBirthdays,
    },
    outstanding: {
      tasks: tasks.filter((t) => !t.completed),
      medications: medications.filter((m) => !m.taken),
      bills: bills.filter((b) => b.status !== "paid"),
    },
    recentActivity,
    stats,
    fetchedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  Tool registry — what the assistant can call, and when
// ─────────────────────────────────────────────────────────────────────────

export interface AiTool {
  name: string;
  module: DataModule;
  description: string;
}

export const AI_TOOLS: AiTool[] = [
  {
    name: "getTasks",
    module: "tasks",
    description:
      "Fetch the user's tasks/to-dos. Supports filters: today, completed, pending, status, dueDate, query, limit.",
  },
  {
    name: "getAppointments",
    module: "appointments",
    description:
      "Fetch the user's medical appointments. Supports filters: today, upcoming, status, dueDate, query, limit.",
  },
  {
    name: "getMedications",
    module: "medications",
    description:
      "Fetch the user's medications & doses. Supports filters: today, pending, completed, query, limit.",
  },
  {
    name: "getBills",
    module: "bills",
    description:
      "Fetch the user's bills/payments (finance). Supports filters: today, upcoming, pending, status, dueDate, query, limit.",
  },
  {
    name: "getDocuments",
    module: "documents",
    description:
      "Fetch documents from the user's Document Vault (records, prescriptions, reports). Supports filters: query, limit.",
  },
  {
    name: "getBirthdays",
    module: "birthdays",
    description:
      "Fetch the user's saved birthdays. Supports filters: upcoming (next 30 days), query, limit.",
  },
  {
    name: "getWorkouts",
    module: "workouts",
    description:
      "Fetch the user's workout sessions. Supports filters: today, upcoming, status, dueDate, query, limit.",
  },
  {
    name: "getWalkSessions",
    module: "walks",
    description:
      "Fetch the user's walking sessions (distance, steps, calories). Supports filters: today, limit.",
  },
  {
    name: "getWater",
    module: "water",
    description: "Fetch the user's daily hydration logs (glasses vs goal).",
  },
  {
    name: "getRecentActivity",
    module: "activity",
    description: "Fetch the user's recent activity log entries (what they did recently).",
  },
  {
    name: "getProfile",
    module: "profile",
    description:
      "Fetch the user's profile and computed statistics (task completion, workouts, water streak, achievement level).",
  },
  {
    name: "queryUserData",
    module: "overview",
    description:
      "Generic tool — pass { module: one of tasks|appointments|medications|bills|documents|birthdays|workouts|walks|water|activity|profile, filters: {...} } to fetch any module without a dedicated tool.",
  },
  {
    name: "getUserContext",
    module: "overview",
    description:
      "Power tool — fetch one complete snapshot of the user's day: today's tasks, appointments, medications, workouts, walks, water, bills, plus upcoming items, outstanding items, recent activity, and statistics.",
  },
];

// ─────────────────────────────────────────────────────────────────────────
//  Prompt formatting — only the fetched slice is ever serialized
// ─────────────────────────────────────────────────────────────────────────

function serializeItem(module: DataModule, item: Record<string, unknown>): string {
  switch (module) {
    case "tasks":
      return `- ${item.title} — ${item.completed ? "done ✅" : `${item.progress ?? 0}% open`} (${item.priority} priority, ${item.category}${item.due_date ? `, due ${item.due_date}` : ""})`;
    case "appointments":
      return `- ${item.title} with ${item.doctor_name} on ${item.appointment_date}${item.start_time ? ` at ${item.start_time}` : ""} (${item.status}, ${item.priority} priority)${item.location ? ` @ ${item.location}` : ""}`;
    case "medications":
      return `- ${item.name} (${item.dosage}, ${item.frequency} at ${item.scheduled_time}) — ${item.taken ? "taken ✅" : "pending ⏳"}${item.notes ? ` — ${item.notes}` : ""}`;
    case "bills":
      return `- ${item.title} — $${Number(item.amount ?? 0).toFixed(2)} (${item.status}, due ${item.due_date}, ${item.category})`;
    case "documents":
      return `- ${item.name} (${item.category})`;
    case "birthdays":
      return `- ${item.full_name} — ${item.birthday_date}${item.phone_number ? ` (phone: ${item.phone_number})` : ""}`;
    case "workouts":
      return `- ${item.session_name} (${item.workout_type || "Workout"}, ${item.duration ?? 0} min) — ${item.status} on ${item.scheduled_date}${item.program_name ? ` (${item.program_name})` : ""}`;
    case "walks":
      return `- ${new Date(String(item.created_at)).toLocaleDateString()} — ${(Number(item.distance ?? 0) / 1000).toFixed(2)} km, ${item.steps ?? 0} steps, ${item.calories ?? 0} kcal, ${item.duration ?? 0}s`;
    case "water":
      return `- ${item.day}: ${item.glasses}/${item.goal} glasses${item.goal_reached ? " (goal reached ✅)" : ""}`;
    case "activity":
      return `- ${item.action} — ${item.description || ""} (${new Date(String(item.created_at)).toLocaleString()})`;
    case "profile":
      return `- ${item.full_name}${item.date_of_birth ? `, born ${item.date_of_birth}` : ""}`;
    default:
      return `- ${JSON.stringify(item)}`;
  }
}

export function formatDataForPrompt(result: QueryResult): string {
  const lines: string[] = [`## ${result.module} — fetched ${result.fetchedAt}`];
  if (result.items.length === 0) {
    lines.push("(no records found)");
  } else {
    for (const item of result.items) lines.push(serializeItem(result.module, item));
    if (result.truncated) lines.push(`(truncated — ${result.items.length} shown)`);
  }
  if (result.extra?.today) {
    const t = result.extra.today as {
      glasses: number;
      goal: number;
      goal_reached: boolean;
      day: string;
    };
    lines.push(
      `- Today (${t.day}): ${t.glasses}/${t.goal} glasses${t.goal_reached ? " — goal reached ✅" : ""}`,
    );
  }
  if (result.extra?.stats) {
    const s = result.extra.stats as ProfileStats;
    lines.push(
      `- Stats: ${s.tasksCompleted}/${s.tasksTotal} tasks done (${s.avgTaskCompletion}%), ${s.totalWorkoutsCompleted} workouts completed, water streak ${s.waterGoalStreak}d, ${(s.totalWalkingDistanceMeters / 1000).toFixed(1)} km walked, achievement: ${s.currentAchievementLevel}`,
    );
  }
  return lines.join("\n");
}

export function formatUserContextForPrompt(snapshot: UserContextSnapshot): string {
  const lines: string[] = [`## getUserContext — today snapshot (fetched ${snapshot.fetchedAt})`];

  const push = (title: string, items: unknown[], fmt: (i: unknown, idx: number) => string) => {
    lines.push(`### ${title}`);
    if (items.length === 0) lines.push("(none)");
    else items.forEach((it, i) => lines.push(fmt(it, i)));
  };

  push("Today's tasks", snapshot.today.tasks, (t) => {
    const x = t as Todo;
    return `- ${x.title} — ${x.completed ? "done ✅" : `${x.progress}% open`} (${x.priority})`;
  });
  push("Today's appointments", snapshot.today.appointments, (a) => {
    const x = a as Appointment;
    return `- ${x.title} with ${x.doctor_name} at ${x.start_time || "—"} (${x.priority})${x.location ? ` @ ${x.location}` : ""}`;
  });
  push("Medications (schedule)", snapshot.today.medications, (m) => {
    const x = m as Medication;
    return `- ${x.name} (${x.dosage}, ${x.frequency} at ${x.scheduled_time}) — ${x.taken ? "taken ✅" : "pending ⏳"}`;
  });
  push("Today's workouts", snapshot.today.workouts, (w) => {
    const x = w as Workout;
    return `- ${x.session_name} (${x.workout_type || "Workout"}, ${x.duration} min) — ${x.status}`;
  });
  push("Today's walks", snapshot.today.walks, (w) => {
    const x = w as WalkSession;
    return `- ${(x.distance / 1000).toFixed(2)} km, ${x.steps} steps, ${x.calories} kcal`;
  });
  lines.push(
    `### Hydration today\n${snapshot.today.water ? `- ${snapshot.today.water.glasses}/${snapshot.today.water.goal} glasses${snapshot.today.water.goal_reached ? " — goal reached ✅" : ""}` : "(none logged yet)"}`,
  );
  push("Bills due today", snapshot.today.bills, (b) => {
    const x = b as Bill;
    return `- ${x.title} — $${Number(x.amount).toFixed(2)} (${x.status})`;
  });
  push("Upcoming appointments", snapshot.upcoming.appointments, (a) => {
    const x = a as Appointment;
    return `- ${x.title} with ${x.doctor_name} on ${x.appointment_date}${x.start_time ? ` at ${x.start_time}` : ""}`;
  });
  push("Bills to pay (soonest first)", snapshot.upcoming.bills, (b) => {
    const x = b as Bill;
    return `- ${x.title} — $${Number(x.amount).toFixed(2)} due ${x.due_date} (${x.status})`;
  });
  push("Birthdays in the next 30 days", snapshot.upcoming.birthdays, (b) => {
    const x = b as Birthday;
    return `- ${x.full_name} — ${x.birthday_date}`;
  });
  push("Outstanding tasks", snapshot.outstanding.tasks, (t) => {
    const x = t as Todo;
    return `- ${x.title} (${x.priority}${x.due_date ? `, due ${x.due_date}` : ""})`;
  });
  push("Medications still to take", snapshot.outstanding.medications, (m) => {
    const x = m as Medication;
    return `- ${x.name} (${x.dosage} at ${x.scheduled_time})`;
  });
  push("Unpaid bills", snapshot.outstanding.bills, (b) => {
    const x = b as Bill;
    return `- ${x.title} — $${Number(x.amount).toFixed(2)} due ${x.due_date}`;
  });
  push("Recent activity", snapshot.recentActivity, (a) => {
    const x = a as ActivityEntry;
    return `- ${x.action} — ${x.description || ""} (${new Date(x.created_at).toLocaleString()})`;
  });
  if (snapshot.stats) {
    const s = snapshot.stats;
    lines.push(
      `### Statistics\n- ${s.tasksCompleted}/${s.tasksTotal} tasks done (${s.avgTaskCompletion}%), ${s.totalWorkoutsCompleted} workouts completed, water streak ${s.waterGoalStreak}d, ${(s.totalWalkingDistanceMeters / 1000).toFixed(1)} km walked, achievement: ${s.currentAchievementLevel}`,
    );
  }

  lines.push(
    "",
    "This is the ONLY data retrieved for this request — the user's own account, fetched live. Nothing else exists. Never invent, assume, or fabricate any appointments, medications, tasks, goals, habits, expenses, records, or statistics. Never mix in data from any other user or from examples. If the requested information is not in this data, say exactly: \"I couldn't find any data related to this in your account.\"",
  );
  return lines.join("\n");
}
