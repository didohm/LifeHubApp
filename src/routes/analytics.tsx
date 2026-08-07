import { useState, useEffect, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronDown, Flame, Activity, TrendingUp, Check } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { useAuth } from "@/hooks/use-auth";
import { useData } from "@/lib/data-context";
import { DashboardSkeleton } from "@/components/lifehub/SkeletonLoader";
import { DayKey, WorkoutProgram } from "@/lib/types";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [{ title: "Progress & Health Analytics — LifeHub" }],
  }),
  component: AnalyticsPage,
});

type TimeFilter = "Today" | "This Week" | "This Month" | "This Year";

const FILTERS: TimeFilter[] = ["Today", "This Week", "This Month", "This Year"];

// ──── Date helpers (local time) ────

/** "YYYY-MM-DD" in local time. */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parse a "YYYY-MM-DD" string as LOCAL midnight (never UTC). */
function parseDateOnly(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Milliseconds of an ISO string, or null when invalid. */
function isoMs(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function shortLabel(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getDay()]} ${d.getDate()}`;
}

function hourLabel(h: number): string {
  if (h === 0) return "12a";
  if (h < 12) return `${h}a`;
  if (h === 12) return "12p";
  return `${h - 12}p`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Structured training days for cardio programs (with legacy text-plan fallback). */
function cardioTrainingDays(p: WorkoutProgram): DayKey[] {
  const structured = p.training_days;
  if (structured && structured.length > 0) return structured;
  return DAY_KEYS.filter((dk) => {
    const focus = (p.weekly_plan || []).find((x) => x.day === dk)?.focus || "";
    return focus.toLowerCase() !== "rest";
  });
}

/** Whether a day is a training day in the program's weekly plan. */
function isTrainingDay(p: WorkoutProgram, day: DayKey): boolean {
  if (p.workout_type === "Cardio") return cardioTrainingDays(p).includes(day);
  const focus = (p.weekly_plan || []).find((item) => item.day === day)?.focus || "";
  return focus.toLowerCase() !== "rest";
}

/** Start of the calendar period for a filter (local midnight). */
function periodStart(filter: TimeFilter): Date {
  const now = new Date();
  if (filter === "Today") {
    const s = new Date(now);
    s.setHours(0, 0, 0, 0);
    return s;
  }
  if (filter === "This Week") {
    const s = new Date(now);
    s.setHours(0, 0, 0, 0);
    s.setDate(s.getDate() - s.getDay()); // Sunday start
    return s;
  }
  if (filter === "This Month") {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return new Date(now.getFullYear(), 0, 1); // Jan 1
}

interface Bucket {
  key: string;
  label: string;
  actions: number;
  doses: number;
  payments: number;
  fitness: number;
  glasses: number;
  total: number;
}

type CountField = "actions" | "doses" | "payments" | "fitness" | "glasses";

function emptyBucket(key: string, label: string): Bucket {
  return { key, label, actions: 0, doses: 0, payments: 0, fitness: 0, glasses: 0, total: 0 };
}

/**
 * Activity-log actions that represent the SAME real-world event as one of
 * the dedicated service series below (doses / payments / fitness / water).
 * They are excluded from the "Actions" series so nothing is counted twice.
 */
const DUP_LOG_MARKERS = [
  "medication taken",
  "paid bill",
  "completed workout",
  "finished walk",
  "drank water",
];

function AnalyticsPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const {
    medications,
    medicationLogs,
    bills,
    payments,
    appointments,
    todos,
    workouts,
    workoutPrograms,
    walkSessions,
    waterLogs,
    activityLogs,
    medLoading,
    billLoading,
    appLoading,
    fitnessLoading,
    activityLoading,
    todosLoading,
    waterLoading,
  } = useData();

  const [timeFilter, setTimeFilter] = useState<TimeFilter>("This Week");
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate({ to: "/auth" });
    }
  }, [user, authLoading, navigate]);

  // Show the skeleton only until the first realtime snapshot arrives.
  const [initialized, setInitialized] = useState(false);
  const anyLoading =
    medLoading ||
    billLoading ||
    appLoading ||
    fitnessLoading ||
    activityLoading ||
    todosLoading ||
    waterLoading;
  useEffect(() => {
    if (!anyLoading) setInitialized(true);
  }, [anyLoading]);

  // ──── Activity Timeline: aggregate events from every service by date ────
  const chartData = useMemo(() => {
    const now = new Date();
    const todayStr = localDateStr(now);
    const map = new Map<string, Bucket>();

    const add = (key: string, field: CountField, amount = 1) => {
      const b = map.get(key);
      if (!b) return;
      b[field] += amount;
      b.total += amount;
    };

    // Build the bucket skeleton for the selected period.
    if (timeFilter === "Today") {
      const curHour = now.getHours();
      for (let h = 0; h <= curHour; h++) map.set(`h${h}`, emptyBucket(`h${h}`, hourLabel(h)));
    } else if (timeFilter === "This Week") {
      const s = periodStart(timeFilter);
      for (let i = 0; i < 7; i++) {
        const d = new Date(s);
        d.setDate(s.getDate() + i);
        const key = localDateStr(d);
        if (key > todayStr) break;
        map.set(key, emptyBucket(key, shortLabel(d)));
      }
    } else if (timeFilter === "This Month") {
      const s = periodStart(timeFilter);
      const daysInMonth = new Date(s.getFullYear(), s.getMonth() + 1, 0).getDate();
      for (let i = 0; i < daysInMonth; i++) {
        const d = new Date(s);
        d.setDate(s.getDate() + i);
        const key = localDateStr(d);
        if (key > todayStr) break;
        map.set(key, emptyBucket(key, i % 5 === 0 ? String(d.getDate()) : ""));
      }
    } else {
      const s = periodStart(timeFilter);
      for (let m = 0; m <= now.getMonth(); m++) {
        const key = `${s.getFullYear()}-${String(m + 1).padStart(2, "0")}`;
        map.set(key, emptyBucket(key, MONTHS[m]));
      }
    }

    // Resolve an ISO timestamp to the right bucket key.
    const keyForIso = (iso: string): string | undefined => {
      const ms = isoMs(iso);
      if (ms === null) return undefined;
      const d = new Date(ms);
      if (timeFilter === "Today") return `h${d.getHours()}`;
      if (timeFilter === "This Year")
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return localDateStr(d);
    };
    // Resolve a date-only field (YYYY-MM-DD) to the right bucket key.
    const keyForDateOnly = (s: string): string | undefined => {
      if (timeFilter === "Today") return `h${now.getHours()}`;
      if (timeFilter === "This Year") return s.slice(0, 7);
      return s;
    };

    // 1) Actions — real activity logs (every service logs its user actions),
    //    minus the events that have a dedicated series below.
    activityLogs.forEach((log) => {
      const a = (log.action || "").toLowerCase();
      if (DUP_LOG_MARKERS.some((marker) => a.includes(marker))) return;
      const key = keyForIso(log.created_at);
      if (key) add(key, "actions");
    });
    // Task completions are not written to activity_logs — count them from the
    // todos collection (updated_at is the completion timestamp).
    todos.forEach((t) => {
      if (!t.completed) return;
      const key = keyForIso(t.updated_at);
      if (key) add(key, "actions");
    });
    // Appointment completions are not written to activity_logs either.
    appointments.forEach((a) => {
      if (a.status !== "completed") return;
      const key = keyForIso(a.updated_at);
      if (key) add(key, "actions");
    });

    // 2) Doses — real medication-taken logs.
    medicationLogs.forEach((log) => {
      const key = keyForIso(log.created_at);
      if (key) add(key, "doses");
    });

    // 3) Payments — real bill payments.
    payments.forEach((p) => {
      const key = keyForIso(p.payment_date);
      if (key) add(key, "payments");
    });

    // 4) Fitness — completed workouts + finished walks.
    // Prefer the exact ISO timestamps so the "Today" view buckets events
    // into the hour they actually happened (date-only fields fall back to
    // the current hour in the Today view).
    workouts.forEach((w) => {
      if (w.status !== "completed") return;
      const key = keyForIso(w.scheduled_at) ?? keyForDateOnly(w.scheduled_date);
      if (key) add(key, "fitness");
    });
    walkSessions.forEach((w) => {
      if (w.status !== "finished") return;
      const key = keyForIso(w.started_at) ?? keyForDateOnly(w.day);
      if (key) add(key, "fitness");
    });

    // 5) Glasses — daily water intake.
    waterLogs.forEach((l) => {
      const key = keyForIso(l.updated_at ?? l.created_at) ?? keyForDateOnly(l.day);
      if (key) add(key, "glasses", l.glasses || 0);
    });

    return Array.from(map.values());
  }, [
    activityLogs,
    medicationLogs,
    payments,
    todos,
    appointments,
    workouts,
    walkSessions,
    waterLogs,
    timeFilter,
  ]);

  // ──── Period stats — every number below is computed from the database ────
  const stats = useMemo(() => {
    const startMs = periodStart(timeFilter).getTime();
    const nowMs = Date.now();
    const inRange = (ms: number | null) => ms !== null && ms >= startMs && ms <= nowMs;
    const inRangeDateOnly = (s?: string | null) => !!s && inRange(parseDateOnly(s).getTime());

    const doses = medicationLogs.filter((l) => inRange(isoMs(l.created_at)));
    const pays = payments.filter((p) => inRange(isoMs(p.payment_date)));
    const apps = appointments.filter((a) => inRangeDateOnly(a.appointment_date));
    const tasksDone = todos.filter((t) => t.completed && inRange(isoMs(t.updated_at)));
    const workoutsDone = workouts.filter(
      (w) => w.status === "completed" && inRangeDateOnly(w.scheduled_date),
    );
    const walksDone = walkSessions.filter((w) => w.status === "finished" && inRangeDateOnly(w.day));
    const waterDays = waterLogs.filter((l) => inRangeDateOnly(l.day));

    const elapsedDays = Math.max(1, Math.floor((nowMs - startMs) / 86_400_000) + 1);

    const takenMeds = medications.filter((m) => m.taken).length;
    const completedTodos = todos.filter((t) => t.completed).length;
    const paidBills = bills.filter((b) => b.status === "paid").length;

    return {
      dosesTaken: doses.length,
      adherencePct: medications.length > 0 ? Math.round((takenMeds / medications.length) * 100) : 0,
      takenMeds,
      totalMeds: medications.length,
      paymentsCount: pays.length,
      paymentsTotal: pays.reduce((s, p) => s + (p.amount || 0), 0),
      paidBills,
      totalBills: bills.length,
      sessionsTotal: apps.length,
      sessionsCompleted: apps.filter((a) => a.status === "completed").length,
      tasksDoneInPeriod: tasksDone.length,
      tasksDone: completedTodos,
      tasksTotal: todos.length,
      taskPct: todos.length > 0 ? Math.round((completedTodos / todos.length) * 100) : 0,
      workoutsDone: workoutsDone.length,
      walksDone: walksDone.length,
      walkKm: walksDone.reduce((s, w) => s + (w.distance || 0), 0) / 1000,
      walkSteps: walksDone.reduce((s, w) => s + (w.steps || 0), 0),
      waterGlasses: waterDays.reduce((s, l) => s + (l.glasses || 0), 0),
      // Unique user events in the period: all real activity logs + the two
      // action types that are not written to activity_logs (task completions
      // and appointment completions).
      // Chart "Actions" series + total events are derived from chartData
      // (chartTotals memo) so the summary banner always matches the chart.
      elapsedDays,
    };
  }, [
    medicationLogs,
    payments,
    appointments,
    todos,
    workouts,
    walkSessions,
    waterLogs,
    medications,
    bills,
    timeFilter,
  ]);

  // ──── Chart series totals — the source of truth for the summary banner.
  // Derived from chartData so "Total Events" and the breakdown ALWAYS sum
  // to exactly what the Activity Timeline chart shows.
  const chartTotals = useMemo(() => {
    const t = { actions: 0, doses: 0, payments: 0, fitness: 0, glasses: 0, total: 0 };
    for (const b of chartData) {
      t.actions += b.actions;
      t.doses += b.doses;
      t.payments += b.payments;
      t.fitness += b.fitness;
      t.glasses += b.glasses;
      t.total += b.total;
    }
    return t;
  }, [chartData]);

  // ──── Workout weekly goal — training days vs completed sessions in the
  // current Sun→Sat week, driven by the active program's weekly plan (same
  // logic as the Workouts page). ────
  const workoutWeek = useMemo(() => {
    const activeProgram = workoutPrograms.find((p) => p.is_active) || workoutPrograms[0] || null;
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const weekDates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      weekDates.push(localDateStr(d));
    }
    let goal = 0;
    let done = 0;
    if (activeProgram) {
      for (let i = 0; i < 7; i++) {
        if (!isTrainingDay(activeProgram, DAY_KEYS[i])) continue;
        goal += 1;
        const completed = workouts.some(
          (w) =>
            w.program_id === activeProgram.id &&
            w.scheduled_date === weekDates[i] &&
            w.status === "completed",
        );
        if (completed) done += 1;
      }
    }
    return { goal, done, hasProgram: !!activeProgram };
  }, [workouts, workoutPrograms]);

  // ──── Water streak (consecutive goal-reached days, from water_logs) ────
  const waterStreak = useMemo(() => {
    const byDay = new Map(waterLogs.map((l) => [l.day, l]));
    let streak = 0;
    const cursor = new Date();
    const todayLog = byDay.get(localDateStr(cursor));
    if (!todayLog || !todayLog.goal_reached) cursor.setDate(cursor.getDate() - 1);
    for (;;) {
      const log = byDay.get(localDateStr(cursor));
      if (log && log.goal_reached) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }, [waterLogs]);

  const hasAnyData =
    activityLogs.length > 0 ||
    medicationLogs.length > 0 ||
    payments.length > 0 ||
    appointments.length > 0 ||
    todos.length > 0 ||
    workouts.length > 0 ||
    walkSessions.length > 0 ||
    waterLogs.length > 0 ||
    medications.length > 0 ||
    bills.length > 0;

  if (authLoading || !initialized) {
    return (
      <Screen>
        <DashboardSkeleton />
      </Screen>
    );
  }

  const filterOptions: TimeFilter[] = FILTERS;

  return (
    <Screen>
      <ScreenHeader
        title="Progress"
        showBack
        action={
          <div className="relative inline-block">
            <button
              onClick={() => setFilterOpen(!filterOpen)}
              className="tap flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-[#12131A] shadow-xs border border-black/5"
            >
              {timeFilter}{" "}
              <ChevronDown
                className={`size-3.5 opacity-60 transition-transform ${filterOpen ? "rotate-180" : ""}`}
              />
            </button>

            {filterOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 w-40 rounded-2xl bg-white shadow-lg border border-black/5 py-1 animate-in fade-in slide-in-from-top-1 duration-150">
                {filterOptions.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      setTimeFilter(opt);
                      setFilterOpen(false);
                    }}
                    className={`w-full px-4 py-2.5 text-left text-xs font-bold transition-colors ${
                      timeFilter === opt
                        ? "bg-[#E8E2FF] text-[#7C5CFC]"
                        : "text-[#12131A] hover:bg-black/[0.03]"
                    }`}
                  >
                    {opt}
                    {timeFilter === opt && <Check className="inline size-3.5 ml-1.5" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        }
      />

      {/* Global empty state — the user has never used any service */}
      {!hasAnyData && (
        <div className="mt-3 card-soft bg-[#F9F9FD] border border-dashed border-slate-200/60 p-6 text-center">
          <TrendingUp className="mx-auto size-10 text-[#7C5CFC]/40" />
          <p className="mt-2 text-sm font-extrabold text-[#12131A]">No data yet</p>
          <p className="mt-1 text-xs text-[#6B7280] max-w-xs mx-auto">
            Everything on this page is computed from your real data. Add medications, bills,
            appointments, tasks, workouts, walks or water and it will appear here instantly.
          </p>
        </div>
      )}

      {/* Stat Cards — every number is derived from the database, filtered by the period */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        {/* Activities — same event count as the chart's stacked total */}
        <div className="card-soft bg-white p-4 border border-black/5 shadow-xs">
          <span className="text-xs font-bold text-[#6B7280]">Activities</span>
          <p className="mt-2 text-2xl font-black text-[#12131A]">
            {chartTotals.total > 0 ? chartTotals.total : "—"}
          </p>
          <p className="mt-0.5 text-xs font-medium text-[#6B7280]">
            {chartTotals.total > 0
              ? `~${(chartTotals.total / stats.elapsedDays).toFixed(1)} / day avg`
              : "No activity recorded"}
          </p>
        </div>

        {/* Doses & Health Adherence */}
        <div className="card-soft bg-white p-4 border border-black/5 shadow-xs">
          <span className="text-xs font-bold text-[#6B7280]">Doses Taken</span>
          <p className="mt-2 text-2xl font-black text-[#12131A]">
            {stats.dosesTaken > 0 ? stats.dosesTaken : "—"}
          </p>
          <p className="mt-0.5 text-xs font-medium text-[#6B7280]">
            {stats.totalMeds > 0
              ? `${stats.adherencePct}% of meds taken · ${stats.takenMeds}/${stats.totalMeds}`
              : "No medications tracked"}
          </p>
          {stats.totalMeds > 0 && (
            <div className="mt-2.5 h-2 w-full rounded-full bg-black/5 overflow-hidden">
              <div
                className="h-full bg-[#34D399] rounded-full transition-all"
                style={{ width: `${stats.adherencePct}%` }}
              />
            </div>
          )}
        </div>

        {/* Bills Paid */}
        <div className="card-soft bg-[#FFC593] p-4 text-[#12131A] shadow-xs">
          <span className="text-xs font-bold opacity-80">Bills Paid</span>
          <p className="mt-2 text-2xl font-black">
            {stats.paymentsCount > 0 ? stats.paymentsCount : "—"}
          </p>
          <p className="mt-0.5 text-xs font-medium opacity-80">
            {stats.paymentsTotal > 0
              ? `$${stats.paymentsTotal.toFixed(2)} paid in ${timeFilter}`
              : "No payments in this period"}
          </p>
          {stats.totalBills > 0 && (
            <div className="mt-2.5 h-2 w-full rounded-full bg-black/10 overflow-hidden">
              <div
                className="h-full bg-[#12131A] rounded-full transition-all"
                style={{ width: `${Math.round((stats.paidBills / stats.totalBills) * 100)}%` }}
              />
            </div>
          )}
        </div>

        {/* Sessions & Goals */}
        <div className="card-soft bg-white p-4 border border-black/5 shadow-xs">
          <span className="text-xs font-bold text-[#6B7280]">Sessions</span>
          <p className="mt-2 text-2xl font-black text-[#12131A]">
            {stats.sessionsTotal > 0 ? stats.sessionsTotal : "—"}
          </p>
          <p className="mt-0.5 text-xs font-medium text-[#6B7280]">
            {stats.sessionsTotal > 0 ? `${stats.sessionsCompleted} completed` : "No appointments"}
          </p>
          <div className="mt-2.5 h-2 w-full rounded-full bg-black/5 overflow-hidden">
            <div
              className="h-full bg-[#7C5CFC] rounded-full transition-all"
              style={{
                width: `${
                  stats.sessionsTotal > 0
                    ? Math.round((stats.sessionsCompleted / stats.sessionsTotal) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
        </div>

        {/* Tasks */}
        <div className="card-soft bg-white p-4 border border-black/5 shadow-xs">
          <span className="text-xs font-bold text-[#6B7280]">Tasks Done</span>
          <p className="mt-2 text-2xl font-black text-[#12131A]">
            {stats.tasksDoneInPeriod > 0 ? stats.tasksDoneInPeriod : "—"}
          </p>
          <p className="mt-0.5 text-xs font-medium text-[#6B7280]">
            {stats.tasksTotal > 0
              ? `${stats.tasksDone}/${stats.tasksTotal} complete (${stats.taskPct}%)`
              : "No tasks yet"}
          </p>
          <div className="mt-2.5 h-2 w-full rounded-full bg-black/5 overflow-hidden">
            <div
              className="h-full bg-[#F59E0B] rounded-full transition-all"
              style={{ width: `${stats.taskPct}%` }}
            />
          </div>
        </div>

        {/* Workouts */}
        <div className="card-soft bg-white p-4 border border-black/5 shadow-xs">
          <span className="text-xs font-bold text-[#6B7280]">Workouts</span>
          <p className="mt-2 text-2xl font-black text-[#12131A]">
            {stats.workoutsDone > 0 ? stats.workoutsDone : "—"}
          </p>
          <p className="mt-0.5 text-xs font-medium text-[#6B7280]">
            {workoutWeek.hasProgram && workoutWeek.goal > 0
              ? `${workoutWeek.done} / ${workoutWeek.goal} weekly goal`
              : stats.workoutsDone > 0
                ? `${stats.workoutsDone} session${stats.workoutsDone === 1 ? "" : "s"} completed`
                : "No completed workouts"}
          </p>
          {workoutWeek.hasProgram && workoutWeek.goal > 0 && (
            <div className="mt-2.5 h-2 w-full rounded-full bg-black/5 overflow-hidden">
              <div
                className="h-full bg-[#60A5FA] rounded-full transition-all"
                style={{
                  width: `${Math.min(100, Math.round((workoutWeek.done / workoutWeek.goal) * 100))}%`,
                }}
              />
            </div>
          )}
        </div>

        {/* Walking */}
        <div className="card-soft bg-white p-4 border border-black/5 shadow-xs">
          <span className="text-xs font-bold text-[#6B7280]">Walking</span>
          <p className="mt-2 text-2xl font-black text-[#12131A]">
            {stats.walkKm > 0 ? `${stats.walkKm.toFixed(2)} km` : "—"}
          </p>
          <p className="mt-0.5 text-xs font-medium text-[#6B7280]">
            {stats.walkSteps > 0
              ? `${stats.walkSteps.toLocaleString()} steps · ${stats.walksDone} walk${
                  stats.walksDone === 1 ? "" : "s"
                }`
              : "No finished walks"}
          </p>
        </div>

        {/* Water */}
        <div className="card-soft bg-white p-4 border border-black/5 shadow-xs">
          <span className="text-xs font-bold text-[#6B7280]">Water</span>
          <p className="mt-2 text-2xl font-black text-[#12131A]">
            {stats.waterGlasses > 0 ? stats.waterGlasses : "—"}
          </p>
          <p className="mt-0.5 text-xs font-medium text-[#6B7280]">
            {stats.waterGlasses > 0
              ? waterStreak > 0
                ? `${waterStreak}-day goal streak 🔥`
                : `${stats.waterGlasses} glasses logged in ${timeFilter}`
              : "No water logged in this period"}
          </p>
        </div>
      </div>

      {/* Activity Timeline — real events from every service, aggregated by date */}
      <div className="mt-5 card-soft bg-white p-4 border border-black/5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-extrabold text-[#12131A] flex items-center gap-1.5">
            <Activity className="size-4 text-[#7C5CFC]" /> Activity Timeline
          </h3>
          <span className="text-[10px] font-semibold text-[#6B7280] bg-[#F3F0FF] px-2 py-0.5 rounded-full">
            {timeFilter}
          </span>
        </div>

        <div className="h-56 w-full">
          {chartData.every((d) => d.total === 0) ? (
            <div className="flex h-full w-full items-center justify-center rounded-2xl bg-[#F9F9FD]">
              <div className="text-center">
                <TrendingUp className="mx-auto size-10 text-[#7C5CFC]/30" />
                <p className="mt-2 text-xs font-bold text-[#6B7280]">
                  No activity recorded for {timeFilter}
                </p>
                <p className="text-[10px] text-[#6B7280]/70">
                  Actions from every service — medications, bills, appointments, tasks, workouts,
                  walks and water — appear here automatically.
                </p>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 5, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradActions" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7C5CFC" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#7C5CFC" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="gradDoses" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34D399" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#34D399" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="gradPayments" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#FFC593" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#FFC593" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="gradFitness" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#60A5FA" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#60A5FA" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="gradGlasses" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22D3EE" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#22D3EE" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#6B7280" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#6B7280" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#12131A",
                    borderRadius: "14px",
                    color: "#fff",
                    fontSize: "11px",
                    border: "none",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
                    padding: "10px 14px",
                  }}
                  itemStyle={{ color: "#fff", fontSize: "11px" }}
                  labelStyle={{ color: "#fff", fontWeight: 800, marginBottom: 4 }}
                />
                <Area
                  type="monotone"
                  stackId="1"
                  dataKey="actions"
                  name="Actions"
                  stroke="#7C5CFC"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#gradActions)"
                />
                <Area
                  type="monotone"
                  stackId="1"
                  dataKey="doses"
                  name="Doses"
                  stroke="#34D399"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#gradDoses)"
                />
                <Area
                  type="monotone"
                  stackId="1"
                  dataKey="payments"
                  name="Payments"
                  stroke="#FFC593"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#gradPayments)"
                />
                <Area
                  type="monotone"
                  stackId="1"
                  dataKey="fitness"
                  name="Fitness"
                  stroke="#60A5FA"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#gradFitness)"
                />
                <Area
                  type="monotone"
                  stackId="1"
                  dataKey="glasses"
                  name="Glasses"
                  stroke="#22D3EE"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#gradGlasses)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Chart legend */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10px] font-bold text-[#6B7280]">
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-[#7C5CFC]" /> Actions
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-[#34D399]" /> Doses
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-[#FFC593]" /> Payments
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-[#60A5FA]" /> Fitness
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-[#22D3EE]" /> Glasses
          </span>
        </div>
      </div>

      {/* Medication Doses Bar Chart — real medication log history */}
      {stats.dosesTaken > 0 && (
        <div className="mt-4 card-soft bg-white p-4 border border-black/5 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-extrabold text-[#12131A] flex items-center gap-1.5">
              💊 Medication Doses
            </h3>
            <span className="text-xs font-semibold text-[#6B7280]">{stats.dosesTaken} logged</span>
          </div>
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData.filter((d) => d.doses > 0 || d.actions > 0)}
                margin={{ top: 5, right: 5, left: -25, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#6B7280" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#6B7280" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#12131A",
                    borderRadius: "14px",
                    color: "#fff",
                    fontSize: "11px",
                    border: "none",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
                    padding: "10px 14px",
                  }}
                />
                <Bar dataKey="doses" name="Doses Taken" fill="#34D399" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Summary Banner — all counts come from the database */}
      <div className="mt-4 card-soft bg-[#E8E2FF] p-4 flex items-center justify-between text-[#12131A]">
        <div>
          <span className="text-xs font-extrabold uppercase tracking-wide opacity-80">
            Total Events · {timeFilter}
          </span>
          <p className="mt-1 text-xl font-extrabold">{chartTotals.total} recorded</p>
          <p className="text-xs text-[#12131A]/70">
            {chartTotals.actions} actions · {chartTotals.doses} doses · {chartTotals.payments}{" "}
            payments · {chartTotals.fitness} fitness · {chartTotals.glasses} glasses
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-full bg-[#12131A] text-white">
          <Flame className="size-6 text-[#FFC593]" />
        </div>
      </div>
    </Screen>
  );
}
