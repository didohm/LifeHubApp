import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Dumbbell,
  Zap,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Trophy,
  Moon,
  CalendarDays,
  Target,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { WeeklySplitGrid } from "@/components/lifehub/WeeklySplitGrid";
import { useAuth } from "@/hooks/use-auth";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useData } from "@/lib/data-context";
import { completeDayWorkout, DAY_LABELS } from "@/lib/api";
import { WorkoutProgram, DayKey } from "@/lib/types";
import { ListSkeleton } from "@/components/lifehub/SkeletonLoader";
import { focusForDay, isTrainingDay, isCardioProgram } from "@/lib/workout-utils";

export const Route = createFileRoute("/workouts")({
  head: () => ({
    meta: [{ title: "Workouts — Fitness Tracker" }],
  }),
  component: WorkoutsPage,
});

const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayKeyOf(d: Date): DayKey {
  return DAY_KEYS[d.getDay()];
}



function WorkoutsPage() {
  const { user, loading: authLoading } = useAuth();
  useAuthGuard(user, authLoading);

  const { workouts, workoutPrograms, fitnessLoading, refreshFitness } = useData();

  const [completing, setCompleting] = useState(false);

  // The page is fully driven by the active program — no manual selection.
  const activeProgram = workoutPrograms.find((p) => p.is_active) || workoutPrograms[0] || null;

  // ── Today / Tomorrow ──
  const now = new Date();
  const todayKey = dayKeyOf(now);
  const todayStr = localDateStr(now);

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = dayKeyOf(tomorrow);

  // ── Current week (Sunday → Saturday, matching program day keys) ──
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  const week = DAY_KEYS.map((key, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const dateStr = localDateStr(d);
    const training = activeProgram ? isTrainingDay(activeProgram, key) : false;
    const completed = activeProgram
      ? workouts.some(
          (w) =>
            w.program_id === activeProgram.id &&
            w.scheduled_date === dateStr &&
            w.status === "completed",
        )
      : false;
    return {
      key,
      dateStr,
      training,
      completed,
      isToday: dateStr === todayStr,
    };
  });

  const weekCompleted = week.filter((d) => d.training && d.completed).length;
  const weekTotal = week.filter((d) => d.training).length;
  const weekPct = weekTotal > 0 ? Math.round((weekCompleted / weekTotal) * 100) : 0;

  // ── Today's workout state ──
  const todayTraining = activeProgram ? isTrainingDay(activeProgram, todayKey) : false;
  const todayFocus = activeProgram ? focusForDay(activeProgram, todayKey) : "";
  const todayWorkout = activeProgram
    ? workouts.find((w) => w.program_id === activeProgram.id && w.scheduled_date === todayStr)
    : undefined;
  const todayCompleted = todayWorkout?.status === "completed";
  const tomorrowFocus = activeProgram ? focusForDay(activeProgram, tomorrowKey) : "";
  const tomorrowTraining = activeProgram ? isTrainingDay(activeProgram, tomorrowKey) : false;

  const handleCompleteToday = async () => {
    if (!user || !activeProgram || !todayTraining || todayCompleted) return;
    setCompleting(true);
    try {
      // Completion is keyed by programId + date (deterministic document id)
      await completeDayWorkout(user.id, activeProgram, todayStr, todayFocus);
      await refreshFitness();
      toast.success("Workout completed! Excellent work! 💪");
    } catch {
      toast.error("Could not mark workout as completed.");
    } finally {
      setCompleting(false);
    }
  };

  if (fitnessLoading) {
    return (
      <Screen>
        <ScreenHeader
          title="Workouts"
          subtitle="Your daily training tracker"
          showBack
          action={
            <Link
              to="/workout-programs"
              className="tap inline-flex items-center gap-1 rounded-full bg-[#12131A] px-3.5 py-1.5 text-xs font-extrabold text-white shadow-md hover:bg-[#12131A]/90"
            >
              Programs <ChevronRight className="size-3.5" />
            </Link>
          }
        />
        <ListSkeleton count={3} />
      </Screen>
    );
  }

  if (!activeProgram) {
    return (
      <Screen>
        <ScreenHeader
          title="Workouts"
          subtitle="Your daily training tracker"
          showBack
          action={
            <Link
              to="/workout-programs"
              className="tap inline-flex items-center gap-1 rounded-full bg-[#12131A] px-3.5 py-1.5 text-xs font-extrabold text-white shadow-md hover:bg-[#12131A]/90"
            >
              Programs <ChevronRight className="size-3.5" />
            </Link>
          }
        />
        <div className="rounded-2xl border border-dashed border-slate-200/60 p-8 text-center bg-white">
          <div className="mx-auto mb-3 flex h-36 w-full max-w-[220px] items-center justify-center">
            <img
              src="/illustration/empty-workouts.png"
              alt="No Active Workouts"
              className="h-full w-full object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.08)]"
            />
          </div>
          <p className="mt-2 text-sm font-bold text-[#12131A]">No active program yet</p>
          <p className="text-xs text-[#6B7280] mt-1">
            Create a workout program to start tracking your daily training.
          </p>
          <Link
            to="/workout-programs"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#12131A] px-4 py-2 text-xs font-bold text-white shadow-xs"
          >
            <Plus className="size-3.5" /> Create First Program
          </Link>
        </div>
      </Screen>
    );
  }

  const cardio = isCardioProgram(activeProgram);

  return (
    <Screen>
      <ScreenHeader
        title="Workouts"
        subtitle="Your daily training tracker"
        showBack
        action={
          <Link
            to="/workout-programs"
            className="tap inline-flex items-center gap-1 rounded-full bg-[#12131A] px-3.5 py-1.5 text-xs font-extrabold text-white shadow-md hover:bg-[#12131A]/90"
          >
            Programs <ChevronRight className="size-3.5" />
          </Link>
        }
      />

      {/* Today's Workout */}
      <section className="card-soft relative overflow-hidden bg-gradient-to-r from-[#12131A] to-[#252836] p-5 text-white shadow-md mb-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-white/10 text-xl backdrop-blur-xs">
              {cardio ? (
                <Zap className="size-5 text-[#FFC593]" />
              ) : (
                <Dumbbell className="size-5 text-[#FFC593]" />
              )}
            </div>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-white/60">
                Today · {DAY_LABELS[todayKey]}
              </p>
              <h3 className="text-lg font-black leading-tight">
                {todayTraining ? todayFocus : "Rest Day 😌"}
              </h3>
            </div>
          </div>
          <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-extrabold text-white/80">
            {activeProgram.name}
          </span>
        </div>

        {!todayTraining ? (
          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-white/5 p-3.5">
            <Moon className="size-4 text-white/60" />
            <p className="text-xs font-semibold text-white/70">
              No training scheduled today — recover well.
            </p>
          </div>
        ) : todayCompleted ? (
          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 p-3.5">
            <CheckCircle2 className="size-4 text-emerald-400" />
            <p className="text-xs font-bold text-emerald-300">Completed ✓</p>
            <span className="ml-auto text-[11px] font-semibold text-white/50">
              See you tomorrow!
            </span>
          </div>
        ) : (
          <button
            onClick={handleCompleteToday}
            disabled={completing}
            className="tap mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3.5 text-sm font-extrabold text-white shadow-md hover:bg-emerald-600 disabled:opacity-60"
          >
            {completing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Mark as Completed
          </button>
        )}
      </section>

      {/* Tomorrow Preview */}
      <div className="card-soft bg-white p-4 border border-black/5 shadow-xs flex items-center gap-3 mb-4">
        <div className="flex size-10 items-center justify-center rounded-2xl bg-[#D4A574]/10 text-[#C49A6C]">
          <CalendarDays className="size-5" />
        </div>
        <div className="flex-1">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-[#6B7280]">
            Tomorrow · {DAY_LABELS[tomorrowKey]}
          </p>
          <h4 className="text-sm font-black text-[#12131A]">
            {tomorrowTraining ? tomorrowFocus : "Rest Day"}
          </h4>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${
            tomorrowTraining ? "bg-[#D4A574]/10 text-[#C49A6C]" : "bg-black/5 text-[#6B7280]"
          }`}
        >
          {tomorrowTraining ? "Training" : "Rest"}
        </span>
      </div>

      {/* Weekly Progress */}
      <div className="card-soft bg-white p-4 border border-black/5 shadow-xs mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600">
              <Trophy className="size-4" />
            </div>
            <div>
              <p className="text-sm font-black text-[#12131A]">This Week</p>
              <p className="text-[11px] font-semibold text-[#6B7280]">
                {weekCompleted} / {weekTotal} session{weekTotal === 1 ? "" : "s"} completed
              </p>
            </div>
          </div>
          <span className="text-lg font-black text-[#12131A]">{weekPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-black/5 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#C49A6C] to-[#D4A574] transition-all duration-500"
            style={{ width: `${weekPct}%` }}
          />
        </div>
      </div>

      {/* Weekly Schedule Strip */}
      <div className="card-soft bg-white p-4 border border-black/5 shadow-xs">
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-[#6B7280] mb-2.5">
          Weekly Schedule
        </p>
        <WeeklySplitGrid
          days={week.map((d) => ({
            key: d.key,
            focus: activeProgram ? focusForDay(activeProgram, d.key) : "Rest",
            isToday: d.isToday,
            completed: d.training && d.completed,
          }))}
        />
      </div>
    </Screen>
  );
}
