import { useState, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Flame,
  Activity,
  TrendingUp,
  Pill,
  Wallet,
  Calendar as CalendarIcon,
  ListChecks,
  Dumbbell,
  Droplets,
  ChevronRight,
} from "lucide-react";
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
import { motion } from "framer-motion";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { useAuth } from "@/hooks/use-auth";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useData } from "@/lib/data-context";
import { DashboardSkeleton } from "@/components/lifehub/SkeletonLoader";
import { parseLocalDate } from "@/lib/date-utils";
import { sounds } from "@/lib/sound";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [{ title: "Progress & Health Analytics — LifeHub" }],
  }),
  component: AnalyticsPage,
});

type TimeFilter = "Today" | "This Week" | "This Month" | "This Year";

const FILTERS: TimeFilter[] = ["Today", "This Week", "This Month", "This Year"];

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDateOnly(s: string): Date {
  return parseLocalDate(s);
}

function isoMs(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function shortLabel(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getDay()]} ${d.getDate()}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
    s.setDate(s.getDate() - s.getDay());
    return s;
  }
  if (filter === "This Month") {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return new Date(now.getFullYear(), 0, 1);
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

const DUP_LOG_MARKERS = [
  "medication taken",
  "paid bill",
  "completed workout",
  "finished walk",
  "drank water",
];

function AnalyticsPage() {
  const { user, loading: authLoading } = useAuth();
  useAuthGuard(user, authLoading);

  const {
    medications = [],
    medicationLogs = [],
    bills = [],
    payments = [],
    appointments = [],
    todos = [],
    workouts = [],
    walkSessions = [],
    waterLogs = [],
    activityLogs = [],
  } = useData();

  const [timeFilter, setTimeFilter] = useState<TimeFilter>("This Week");

  const startMs = useMemo(() => periodStart(timeFilter).getTime(), [timeFilter]);
  const endMs = useMemo(() => {
    const now = new Date();
    if (timeFilter === "Today") {
      const e = new Date(now);
      e.setHours(23, 59, 59, 999);
      return e.getTime();
    }
    if (timeFilter === "This Week") {
      const s = periodStart(timeFilter);
      const e = new Date(s);
      e.setDate(e.getDate() + 7);
      return e.getTime();
    }
    if (timeFilter === "This Month") {
      return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
    }
    return new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999).getTime();
  }, [timeFilter]);

  const waterStreak = useMemo(() => {
    const now = new Date();
    let streak = 0;
    const logMap = new Map<string, number>();
    (waterLogs || []).forEach((l) => {
      const dStr = l?.day || (l as any)?.date;
      if (dStr) {
        logMap.set(dStr, (logMap.get(dStr) || 0) + (l.glasses || 0));
      }
    });
    for (let i = 0; i < 365; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = localDateStr(d);
      const glasses = logMap.get(dateStr) || 0;
      if (glasses >= 8) {
        streak++;
      } else if (i > 0) {
        break;
      }
    }
    return streak;
  }, [waterLogs]);

  const stats = useMemo(() => {
    const now = new Date();
    const safeMeds = medications || [];
    const safeMedLogs = medicationLogs || [];
    const safeBills = bills || [];
    const safePayments = payments || [];
    const safeAppointments = appointments || [];
    const safeTodos = todos || [];
    const safeWorkouts = workouts || [];
    const safeWalks = walkSessions || [];
    const safeWaterLogs = waterLogs || [];

    const takenMeds = safeMeds.filter((m) => m?.taken).length;
    const adherencePct =
      safeMeds.length > 0 ? Math.round((takenMeds / safeMeds.length) * 100) : 0;

    const dosesTaken = safeMedLogs.filter((l) => {
      const t = isoMs(l?.logged_at);
      return t !== null && t >= startMs && t <= endMs && l?.taken;
    }).length;

    const paidBills = safeBills.filter((b) => b?.status === "paid").length;
    const periodPayments = safePayments.filter((p) => {
      const t = isoMs(p?.paid_at);
      return t !== null && t >= startMs && t <= endMs;
    });
    const paymentsCount = periodPayments.length;
    const paymentsTotal = periodPayments.reduce((sum, p) => sum + (p?.amount || 0), 0);

    const sessionsCompleted = safeAppointments.filter((a) => a?.status === "completed").length;

    const tasksDoneInPeriod = safeTodos.filter((t) => {
      if (!t?.completed) return false;
      const ts = isoMs(t.updated_at) ?? isoMs(t.created_at);
      return ts !== null && ts >= startMs && ts <= endMs;
    }).length;
    const tasksDone = safeTodos.filter((t) => t?.completed).length;
    const tasksTotal = safeTodos.length;
    const taskPct = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : 0;

    const workoutsDone = safeWorkouts.filter((w) => {
      const isCompleted = w?.status === "completed" || (w as any)?.completed;
      if (!isCompleted) return false;
      const d = w?.scheduled_date || (w as any)?.date || w?.scheduled_at?.slice(0, 10);
      if (!d) return false;
      const t = parseDateOnly(d).getTime();
      return t >= startMs && t <= endMs;
    }).length;

    const periodWalks = safeWalks.filter((s) => {
      const isFinished = s?.status === "finished" || (!s?.status && (s as any)?.completed);
      if (!isFinished) return false;
      const d = s?.day || (s as any)?.date || s?.started_at?.slice(0, 10);
      if (!d) return false;
      const t = parseDateOnly(d).getTime();
      return t >= startMs && t <= endMs;
    });
    const walkKm = periodWalks.reduce((sum, s) => sum + (s?.distance || (s as any)?.distance_meters || 0), 0) / 1000;
    const walkSteps = periodWalks.reduce((sum, s) => sum + (s?.steps || (s as any)?.step_count || 0), 0);
    const walksDone = periodWalks.length;

    const waterGlasses = safeWaterLogs
      .filter((l) => {
        const d = l?.day || (l as any)?.date;
        if (!d) return false;
        const t = parseDateOnly(d).getTime();
        return t >= startMs && t <= endMs;
      })
      .reduce((sum, l) => sum + (l?.glasses || 0), 0);

    const elapsedDays = Math.max(1, Math.ceil((now.getTime() - startMs) / 86400000));

    return {
      adherencePct,
      takenMeds,
      totalMeds: safeMeds.length,
      dosesTaken,
      paidBills,
      totalBills: safeBills.length,
      paymentsCount,
      paymentsTotal,
      sessionsCompleted,
      sessionsTotal: safeAppointments.length,
      tasksDoneInPeriod,
      tasksDone,
      tasksTotal,
      taskPct,
      workoutsDone,
      walkKm,
      walkSteps,
      walksDone,
      waterGlasses,
      elapsedDays,
    };
  }, [
    medications,
    medicationLogs,
    bills,
    payments,
    appointments,
    todos,
    workouts,
    walkSessions,
    waterLogs,
    startMs,
    endMs,
    timeFilter,
  ]);

  const overallScore = useMemo(() => {
    let components = 0;
    let scoreSum = 0;

    if (stats.totalMeds > 0) {
      components++;
      scoreSum += stats.adherencePct;
    }
    if (stats.tasksTotal > 0) {
      components++;
      scoreSum += stats.taskPct;
    }
    if (stats.workoutsDone > 0 || stats.walksDone > 0) {
      components++;
      scoreSum += Math.min(100, (stats.workoutsDone + stats.walksDone) * 25);
    }
    if (stats.waterGlasses > 0) {
      components++;
      scoreSum += Math.min(100, Math.round((stats.waterGlasses / (stats.elapsedDays * 8)) * 100));
    }

    if (components === 0) return 0;
    return Math.round(scoreSum / components);
  }, [stats]);

  const chartData = useMemo(() => {
    const now = new Date();
    let buckets: Bucket[] = [];

    if (timeFilter === "Today") {
      buckets = [
        emptyBucket("0", "6a-12p"),
        emptyBucket("1", "12p-6p"),
        emptyBucket("2", "6p-12a"),
        emptyBucket("3", "12a-6a"),
      ];
    } else if (timeFilter === "This Week") {
      const s = periodStart("This Week");
      buckets = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(s);
        d.setDate(s.getDate() + i);
        return emptyBucket(localDateStr(d), shortLabel(d));
      });
    } else if (timeFilter === "This Month") {
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      buckets = Array.from({ length: daysInMonth }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth(), i + 1);
        return emptyBucket(localDateStr(d), String(i + 1));
      });
    } else {
      buckets = Array.from({ length: 12 }, (_, i) => {
        return emptyBucket(String(i), MONTHS[i]);
      });
    }

    const bucketIndex = (ts: number): number => {
      const d = new Date(ts);
      if (timeFilter === "Today") {
        const h = d.getHours();
        if (h >= 6 && h < 12) return 0;
        if (h >= 12 && h < 18) return 1;
        if (h >= 18) return 2;
        return 3;
      }
      if (timeFilter === "This Week") {
        const s = periodStart("This Week");
        return Math.min(
          6,
          Math.max(
            0,
            Math.floor(
              (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
                new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime()) /
                86400000,
            ),
          ),
        );
      }
      if (timeFilter === "This Month") {
        return Math.min(buckets.length - 1, Math.max(0, d.getDate() - 1));
      }
      return Math.min(11, Math.max(0, d.getMonth()));
    };

    const addEvent = (ts: number, field: CountField, amount = 1) => {
      if (ts < startMs || ts > endMs) return;
      const idx = bucketIndex(ts);
      if (idx >= 0 && idx < buckets.length) {
        buckets[idx][field] += amount;
        buckets[idx].total += amount;
      }
    };

    (activityLogs || []).forEach((l) => {
      const act = (l?.action || "").toLowerCase();
      if (DUP_LOG_MARKERS.some((m) => act.includes(m))) return;
      const t = isoMs(l?.created_at);
      if (t !== null) addEvent(t, "actions");
    });

    (medicationLogs || []).forEach((l) => {
      if (!l?.taken) return;
      const t = isoMs(l.logged_at);
      if (t !== null) addEvent(t, "doses");
    });

    (payments || []).forEach((p) => {
      const t = isoMs(p?.paid_at);
      if (t !== null) addEvent(t, "payments");
    });

    (workouts || []).forEach((w) => {
      const isCompleted = w?.status === "completed" || (w as any)?.completed;
      if (!isCompleted) return;
      const d = w?.scheduled_date || (w as any)?.date || w?.scheduled_at?.slice(0, 10);
      if (!d) return;
      const t = parseDateOnly(d).getTime();
      addEvent(t, "fitness");
    });

    (walkSessions || []).forEach((s) => {
      const isFinished = s?.status === "finished" || (!s?.status && (s as any)?.completed);
      if (!isFinished) return;
      const d = s?.day || (s as any)?.date || s?.started_at?.slice(0, 10);
      if (!d) return;
      const t = parseDateOnly(d).getTime();
      addEvent(t, "fitness");
    });

    (waterLogs || []).forEach((l) => {
      const d = l?.day || (l as any)?.date;
      if (!d) return;
      const t = parseDateOnly(d).getTime();
      addEvent(t, "glasses", l.glasses || 0);
    });

    return buckets;
  }, [timeFilter, startMs, endMs, activityLogs, medicationLogs, payments, workouts, walkSessions, waterLogs]);

  const chartTotals = useMemo(() => {
    return chartData.reduce(
      (acc, b) => ({
        total: acc.total + b.total,
        actions: acc.actions + b.actions,
        doses: acc.doses + b.doses,
        payments: acc.payments + b.payments,
        fitness: acc.fitness + b.fitness,
        glasses: acc.glasses + b.glasses,
      }),
      { total: 0, actions: 0, doses: 0, payments: 0, fitness: 0, glasses: 0 },
    );
  }, [chartData]);

  const hasAnyData =
    todos.length > 0 ||
    workouts.length > 0 ||
    walkSessions.length > 0 ||
    waterLogs.length > 0 ||
    medications.length > 0 ||
    bills.length > 0;

  if (authLoading) {
    return (
      <Screen>
        <DashboardSkeleton />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title="Progress" subtitle="Comprehensive health & habit analytics" showBack />

      {/* ════════════════════════════════════════════════════════════
          SPRING-ANIMATED TIME RANGE SELECTOR BAR
          ════════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between gap-1 rounded-2xl bg-white p-1.5 border border-border/60 shadow-2xs">
        {FILTERS.map((f) => {
          const active = timeFilter === f;
          return (
            <button
              key={f}
              onClick={() => {
                sounds.playNavClick();
                setTimeFilter(f);
              }}
              className={cn(
                "tap relative flex-1 py-1.5 px-2 rounded-xl text-xs font-extrabold text-center transition-colors",
                active ? "text-[#12131A]" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active && (
                <motion.div
                  layoutId="activeFilterPill"
                  className="absolute inset-0 rounded-xl bg-slate-100 shadow-2xs"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <span className="relative z-10">{f}</span>
            </button>
          );
        })}
      </div>

      {/* ════════════════════════════════════════════════════════════
          OVERALL HEALTH & ACTIVITY SCORE HERO
          ════════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="card-soft mt-4 bg-gradient-to-br from-[#EAE6FF] via-[#F4F1FF] to-[#FAF8FF] p-4 sm:p-5 border border-[#7C5CFC]/20 shadow-xs"
      >
        <div className="flex items-center justify-between">
          <div>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-0.5 text-[10px] font-black text-[#7C5CFC] shadow-2xs">
              <Activity className="size-3" /> Health & Routine Score
            </span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl sm:text-4xl font-black text-[#12131A] tracking-tight">
                {overallScore > 0 ? `${overallScore}%` : "—"}
              </span>
              <span className="text-xs font-bold text-emerald-600">
                {overallScore >= 80 ? "✨ Optimum" : overallScore >= 50 ? "⚡ Good" : "🌱 Building"}
              </span>
            </div>
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {chartTotals.total} recorded events in {timeFilter.toLowerCase()}
            </p>
          </div>

          <div className="flex size-14 items-center justify-center rounded-2xl bg-[#12131A] text-white shadow-md">
            <Flame className="size-7 text-[#FFC593]" />
          </div>
        </div>

        {/* Breakdown Progress Bars */}
        <div className="mt-4 pt-3 border-t border-[#7C5CFC]/15 grid grid-cols-3 gap-2 text-center">
          <div>
            <span className="text-[10px] font-bold text-muted-foreground uppercase">Doses</span>
            <p className="text-sm font-black text-[#12131A]">{stats.adherencePct}%</p>
          </div>
          <div>
            <span className="text-[10px] font-bold text-muted-foreground uppercase">Tasks</span>
            <p className="text-sm font-black text-[#12131A]">{stats.taskPct}%</p>
          </div>
          <div>
            <span className="text-[10px] font-bold text-muted-foreground uppercase">Fitness</span>
            <p className="text-sm font-black text-[#12131A]">
              {stats.workoutsDone + stats.walksDone} ses
            </p>
          </div>
        </div>
      </motion.div>

      {/* Global Empty State */}
      {!hasAnyData && (
        <div className="mt-3 card-soft bg-white border border-dashed border-border p-6 text-center shadow-2xs">
          <TrendingUp className="mx-auto size-10 text-[#7C5CFC]/40" />
          <p className="mt-2 text-sm font-extrabold text-[#12131A]">No analytics recorded</p>
          <p className="mt-1 text-xs text-muted-foreground max-w-xs mx-auto leading-relaxed">
            Actions from medications, water, appointments, tasks, workouts, and bills will calculate here in real time.
          </p>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          CATEGORY STAT CARDS GRID WITH DIRECT NAVIGATION LINKS
          ════════════════════════════════════════════════════════════ */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        {/* Doses Taken */}
        <Link
          to="/medications"
          onClick={() => sounds.playCardClick()}
          className="card-soft tap group bg-white p-3.5 border border-border/60 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-muted-foreground">Medications</span>
              <Pill className="size-4 text-pink-500" />
            </div>
            <p className="mt-2 text-2xl font-black text-[#12131A] group-hover:text-pink-600 transition-colors">
              {stats.dosesTaken > 0 ? stats.dosesTaken : "—"}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
              {stats.totalMeds > 0 ? `${stats.adherencePct}% adherence` : "No active meds"}
            </p>
          </div>
          <div className="mt-2.5">
            {stats.totalMeds > 0 && (
              <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden mb-1.5">
                <div
                  className="h-full bg-emerald-500 rounded-full"
                  style={{ width: `${stats.adherencePct}%` }}
                />
              </div>
            )}
            <div className="flex items-center justify-between text-[10px] font-bold text-muted-foreground">
              <span>View Meds</span>
              <ChevronRight className="size-3 text-pink-500 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>
        </Link>

        {/* Hydration */}
        <Link
          to="/medications"
          onClick={() => sounds.playCardClick()}
          className="card-soft tap group bg-white p-3.5 border border-border/60 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-muted-foreground">Hydration</span>
              <Droplets className="size-4 text-sky-500" />
            </div>
            <p className="mt-2 text-2xl font-black text-[#12131A] group-hover:text-sky-600 transition-colors">
              {stats.waterGlasses > 0 ? `${stats.waterGlasses} gl` : "—"}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
              {waterStreak > 0 ? `${waterStreak}d goal streak 🔥` : "Hydration logs"}
            </p>
          </div>
          <div className="mt-2.5">
            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden mb-1.5">
              <div
                className="h-full bg-sky-500 rounded-full"
                style={{
                  width: `${Math.min(100, (stats.waterGlasses / (stats.elapsedDays * 8)) * 100)}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] font-bold text-muted-foreground">
              <span>Log Water</span>
              <ChevronRight className="size-3 text-sky-500 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>
        </Link>

        {/* Workouts & Walking */}
        <Link
          to="/walk"
          onClick={() => sounds.playCardClick()}
          className="card-soft tap group bg-white p-3.5 border border-border/60 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-muted-foreground">Fitness & Walk</span>
              <Dumbbell className="size-4 text-orange-500" />
            </div>
            <p className="mt-2 text-2xl font-black text-[#12131A] group-hover:text-orange-600 transition-colors">
              {stats.walkKm > 0 ? `${stats.walkKm.toFixed(1)} km` : `${stats.workoutsDone} ses`}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
              {stats.workoutsDone} workouts · {stats.walksDone} walks
            </p>
          </div>
          <div className="mt-2.5 flex items-center justify-between text-[10px] font-bold text-muted-foreground">
            <span>Open Map & Fitness</span>
            <ChevronRight className="size-3 text-orange-500 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </Link>

        {/* Tasks Completed */}
        <Link
          to="/tasks"
          onClick={() => sounds.playCardClick()}
          className="card-soft tap group bg-white p-3.5 border border-border/60 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-muted-foreground">Tasks Done</span>
              <ListChecks className="size-4 text-emerald-500" />
            </div>
            <p className="mt-2 text-2xl font-black text-[#12131A] group-hover:text-emerald-600 transition-colors">
              {stats.tasksDoneInPeriod > 0 ? stats.tasksDoneInPeriod : "—"}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
              {stats.tasksTotal > 0
                ? `${stats.tasksDone}/${stats.tasksTotal} done (${stats.taskPct}%)`
                : "No tasks"}
            </p>
          </div>
          <div className="mt-2.5">
            {stats.tasksTotal > 0 && (
              <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden mb-1.5">
                <div
                  className="h-full bg-emerald-500 rounded-full"
                  style={{ width: `${stats.taskPct}%` }}
                />
              </div>
            )}
            <div className="flex items-center justify-between text-[10px] font-bold text-muted-foreground">
              <span>View Tasks</span>
              <ChevronRight className="size-3 text-emerald-500 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>
        </Link>

        {/* Bills & Payments */}
        <Link
          to="/bills"
          onClick={() => sounds.playCardClick()}
          className="card-soft tap group bg-gradient-to-br from-[#FFE0C7] to-[#FFD2AE] p-3.5 text-[#12131A] shadow-2xs border border-amber-300/20 hover:shadow-md transition-all flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-950/80">Bills Paid</span>
              <Wallet className="size-4 text-amber-900" />
            </div>
            <p className="mt-2 text-2xl font-black text-[#12131A]">
              {stats.paymentsCount > 0 ? `$${stats.paymentsTotal.toFixed(0)}` : "—"}
            </p>
            <p className="mt-0.5 text-[11px] font-semibold text-amber-900/80">
              {stats.paymentsCount} paid in {timeFilter}
            </p>
          </div>
          <div className="mt-2.5 flex items-center justify-between text-[10px] font-black text-amber-900/80">
            <span>Manage Bills</span>
            <ChevronRight className="size-3 text-amber-950 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </Link>

        {/* Appointments */}
        <Link
          to="/appointments"
          onClick={() => sounds.playCardClick()}
          className="card-soft tap group bg-white p-3.5 border border-border/60 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-muted-foreground">Appointments</span>
              <CalendarIcon className="size-4 text-purple-500" />
            </div>
            <p className="mt-2 text-2xl font-black text-[#12131A] group-hover:text-purple-600 transition-colors">
              {stats.sessionsTotal > 0 ? stats.sessionsTotal : "—"}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
              {stats.sessionsCompleted} completed
            </p>
          </div>
          <div className="mt-2.5 flex items-center justify-between text-[10px] font-bold text-muted-foreground">
            <span>Appointments</span>
            <ChevronRight className="size-3 text-purple-500 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </Link>
      </div>

      {/* ════════════════════════════════════════════════════════════
          ACTIVITY VOLUME CHART (AreaChart)
          ════════════════════════════════════════════════════════════ */}
      <div className="mt-4 card-soft bg-white p-4 border border-border/60 shadow-2xs">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-extrabold text-[#12131A] flex items-center gap-1.5">
            <Activity className="size-4 text-[#7C5CFC]" /> Activity Breakdown
          </h3>
          <span className="text-[10px] font-bold text-muted-foreground bg-slate-100 px-2.5 py-0.5 rounded-full">
            {timeFilter}
          </span>
        </div>

        <div className="h-56 min-h-[224px] w-full relative">
          {chartData.every((d) => d.total === 0) ? (
            <div className="flex h-full w-full items-center justify-center rounded-2xl bg-slate-50">
              <div className="text-center p-4">
                <TrendingUp className="mx-auto size-8 text-muted-foreground/40" />
                <p className="mt-2 text-xs font-bold text-muted-foreground">
                  No activity recorded for {timeFilter}
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
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#64748B" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#64748B" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0F172A",
                    borderRadius: "16px",
                    color: "#fff",
                    fontSize: "11px",
                    border: "none",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
                    padding: "10px 14px",
                  }}
                  itemStyle={{ color: "#fff", fontSize: "11px" }}
                  labelStyle={{ color: "#fff", fontWeight: 800, marginBottom: 4 }}
                />
                <Area
                  type="monotone"
                  stackId="1"
                  dataKey="actions"
                  name="Tasks"
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
                  name="Bills"
                  stroke="#FFC593"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#gradPayments)"
                />
                <Area
                  type="monotone"
                  stackId="1"
                  dataKey="fitness"
                  name="Workouts"
                  stroke="#60A5FA"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#gradFitness)"
                />
                <Area
                  type="monotone"
                  stackId="1"
                  dataKey="glasses"
                  name="Water"
                  stroke="#22D3EE"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#gradGlasses)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3.5 gap-y-1 text-[10.5px] font-bold text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-[#7C5CFC]" /> Tasks
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-[#34D399]" /> Doses
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-[#FFC593]" /> Bills
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-[#60A5FA]" /> Fitness
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-[#22D3EE]" /> Water
          </span>
        </div>
      </div>

      {/* Medication Doses Bar Chart */}
      {stats.dosesTaken > 0 && (
        <div className="mt-4 card-soft bg-white p-4 border border-border/60 shadow-2xs">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-extrabold text-[#12131A] flex items-center gap-1.5">
              💊 Dose Logging History
            </h3>
            <span className="text-xs font-semibold text-muted-foreground">{stats.dosesTaken} logged</span>
          </div>
          <div className="h-40 min-h-[160px] w-full relative">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData.filter((d) => d.doses > 0 || d.actions > 0)}
                margin={{ top: 5, right: 5, left: -25, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#64748B" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#64748B" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0F172A",
                    borderRadius: "14px",
                    color: "#fff",
                    fontSize: "11px",
                    border: "none",
                  }}
                />
                <Bar dataKey="doses" name="Doses Taken" fill="#34D399" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Screen>
  );
}
