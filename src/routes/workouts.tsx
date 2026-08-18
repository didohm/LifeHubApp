import { useState, useEffect, useRef } from "react";
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
  Flame,
  Clock,
  Play,
  Pause,
  RotateCcw,
  Timer,
  ChevronDown,
  Sparkles,
  Layers,
  Activity,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { WeeklySplitGrid } from "@/components/lifehub/WeeklySplitGrid";
import { useAuth } from "@/hooks/use-auth";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useData } from "@/lib/data-context";
import { completeDayWorkout, activateWorkoutProgram, DAY_LABELS } from "@/lib/api";
import { DayKey } from "@/lib/types";
import { ListSkeleton } from "@/components/lifehub/SkeletonLoader";
import {
  focusForDay,
  isTrainingDay,
  isCardioProgram,
  localDateStr,
  dayKeyOf,
  getFocusTags,
  getFocusTips,
  formatDuration,
  DAY_KEYS,
} from "@/lib/workout-utils";
import { sounds } from "@/lib/sound";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/workouts")({
  head: () => ({
    meta: [
      { title: "Workouts & Daily Training — LifeHub" },
      {
        name: "description",
        content: "Track today's workout split, manage rest timers, and review weekly consistency.",
      },
    ],
  }),
  component: WorkoutsPage,
});

function WorkoutsPage() {
  const { user, loading: authLoading } = useAuth();
  useAuthGuard(user, authLoading);

  const { workouts, workoutPrograms, fitnessLoading, refreshFitness } = useData();

  const [completing, setCompleting] = useState(false);
  const [selectedDayKey, setSelectedDayKey] = useState<DayKey | null>(null);
  const [programDropdownOpen, setProgramDropdownOpen] = useState(false);

  // ── Workout Companion / Rest Timer States ──
  const [showTools, setShowTools] = useState(false);
  const [stopwatchRunning, setStopwatchRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const [restSeconds, setRestSeconds] = useState(0);
  const [initialRest, setInitialRest] = useState(60);
  const [restActive, setRestActive] = useState(false);

  // The page is fully driven by the active program
  const activeProgram = workoutPrograms.find((p) => p.is_active) || workoutPrograms[0] || null;

  // ── Today / Tomorrow Dates ──
  const now = new Date();
  const todayKey = dayKeyOf(now);
  const todayStr = localDateStr(now);

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = dayKeyOf(tomorrow);

  // ── Stopwatch Interval ──
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (stopwatchRunning) {
      timer = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [stopwatchRunning]);

  // ── Rest Countdown Interval ──
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (restActive && restSeconds > 0) {
      timer = setInterval(() => {
        setRestSeconds((prev) => {
          if (prev <= 1) {
            setRestActive(false);
            sounds.playNotification();
            toast.success("Rest interval complete! Time for the next set! ⚡");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [restActive, restSeconds]);

  const startRestTimer = (secs: number) => {
    sounds.playActionClick();
    setInitialRest(secs);
    setRestSeconds(secs);
    setRestActive(true);
  };

  const cancelRestTimer = () => {
    sounds.playClick();
    setRestActive(false);
    setRestSeconds(0);
  };

  // ── Current week schedule ──
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

  // Total completed workouts across lifetime
  const totalCompletedWorkouts = workouts.filter((w) => w.status === "completed").length;

  // ── Today's workout state ──
  const todayTraining = activeProgram ? isTrainingDay(activeProgram, todayKey) : false;
  const todayFocus = activeProgram ? focusForDay(activeProgram, todayKey) : "";
  const todayWorkout = activeProgram
    ? workouts.find((w) => w.program_id === activeProgram.id && w.scheduled_date === todayStr)
    : undefined;
  const todayCompleted = todayWorkout?.status === "completed";
  const tomorrowFocus = activeProgram ? focusForDay(activeProgram, tomorrowKey) : "";
  const tomorrowTraining = activeProgram ? isTrainingDay(activeProgram, tomorrowKey) : false;

  // Inspecting a specific day in the weekly split
  const inspectedKey = selectedDayKey || todayKey;
  const inspectedFocus = activeProgram ? focusForDay(activeProgram, inspectedKey) : "Rest";
  const inspectedTraining = activeProgram ? isTrainingDay(activeProgram, inspectedKey) : false;
  const inspectedCompleted = week.find((d) => d.key === inspectedKey)?.completed;

  const handleCompleteToday = async () => {
    if (!user || !activeProgram || !todayTraining || todayCompleted) return;
    setCompleting(true);
    try {
      await completeDayWorkout(user.id, activeProgram, todayStr, todayFocus);
      await refreshFitness();
      sounds.playSuccess();
      toast.success("Workout completed! Excellent work! 💪");
    } catch {
      sounds.playError();
      toast.error("Could not mark workout as completed.");
    } finally {
      setCompleting(false);
    }
  };

  const handleSwitchProgram = async (programId: string) => {
    if (!user) return;
    setProgramDropdownOpen(false);
    try {
      sounds.playActionClick();
      await activateWorkoutProgram(programId, user.id);
      await refreshFitness();
      toast.success("Switched active workout program!");
    } catch {
      toast.error("Could not switch program.");
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
              className="tap inline-flex items-center gap-1 rounded-full bg-[#12131A] px-3.5 py-1.5 text-xs font-black text-white shadow-md hover:bg-[#12131A]/90"
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
              className="tap inline-flex items-center gap-1 rounded-full bg-[#12131A] px-3.5 py-1.5 text-xs font-black text-white shadow-md hover:bg-[#12131A]/90"
            >
              Programs <ChevronRight className="size-3.5" />
            </Link>
          }
        />
        <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-center shadow-xs">
          <div className="mx-auto mb-3 flex h-36 w-full max-w-[220px] items-center justify-center">
            <img
              src="/illustration/empty-workouts.webp"
              alt="No Active Workouts"
              className="h-full w-full object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.08)]"
            />
          </div>
          <p className="mt-2 text-base font-black text-[#12131A]">No active program yet</p>
          <p className="text-xs text-[#6B7280] mt-1 max-w-sm mx-auto">
            Create or activate a workout program to start tracking your daily training sessions.
          </p>
          <Link
            to="/workout-programs"
            className="tap mt-5 inline-flex items-center gap-1.5 rounded-full bg-[#12131A] px-5 py-2.5 text-xs font-black text-white shadow-md hover:bg-slate-800 transition-transform active:scale-95"
          >
            <Plus className="size-4 stroke-[3]" /> Create First Program
          </Link>
        </div>
      </Screen>
    );
  }

  const cardio = isCardioProgram(activeProgram);
  const todayTags = getFocusTags(todayFocus, activeProgram.workout_type);

  return (
    <Screen>
      <ScreenHeader
        title="Workouts"
        subtitle="Daily training execution & consistency"
        showBack
        action={
          <Link
            to="/workout-programs"
            className="tap inline-flex items-center gap-1 rounded-full bg-[#12131A] px-3.5 py-1.5 text-xs font-black text-white shadow-md hover:bg-[#12131A]/90 transition-transform active:scale-95"
          >
            <Layers className="size-3.5" /> Programs
          </Link>
        }
      />

      {/* Program Selector Strip (if multiple programs exist) */}
      {workoutPrograms.length > 1 && (
        <div className="relative mb-3.5">
          <div className="flex items-center justify-between bg-white border border-black/5 rounded-2xl p-2.5 shadow-2xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-black uppercase text-muted-foreground tracking-wider">
                Active Split:
              </span>
              <span className="text-xs font-black text-[#12131A] truncate">
                {activeProgram.name}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setProgramDropdownOpen(!programDropdownOpen)}
              className="tap flex items-center gap-1 text-xs font-black text-[#7C5CFC] bg-[#7C5CFC]/10 px-2.5 py-1 rounded-full hover:bg-[#7C5CFC]/15 transition-colors"
            >
              Switch <ChevronDown className="size-3" />
            </button>
          </div>

          {programDropdownOpen && (
            <div className="absolute top-full left-0 right-0 z-30 mt-1.5 rounded-2xl bg-white border border-black/10 shadow-xl p-2 space-y-1 animate-in fade-in zoom-in-95 duration-150">
              {workoutPrograms.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSwitchProgram(p.id)}
                  className={cn(
                    "tap w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs font-bold transition-colors",
                    p.id === activeProgram.id
                      ? "bg-[#12131A] text-white"
                      : "hover:bg-slate-50 text-[#12131A]",
                  )}
                >
                  <span className="truncate">{p.name}</span>
                  {p.id === activeProgram.id && <Check className="size-3.5 stroke-[3] shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* HERO: TODAY'S TRAINING FOCAL POINT */}
      <section className="card-soft relative overflow-hidden bg-white p-5 sm:p-6 shadow-lg mb-4 border border-border/60 rounded-3xl">
        <div className="relative z-10 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-black uppercase tracking-wider shadow-2xs",
                  todayCompleted
                    ? "bg-emerald-500 text-white"
                    : todayTraining
                      ? "bg-amber-500 text-white"
                      : "bg-indigo-500 text-white",
                )}
              >
                {todayCompleted ? (
                  <>
                    <Check className="size-3 stroke-[3]" /> Completed Today
                  </>
                ) : todayTraining ? (
                  <>
                    <Flame className="size-3 text-white/90" /> Active Session
                  </>
                ) : (
                  <>
                    <Moon className="size-3" /> Rest & Recovery
                  </>
                )}
              </span>

              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">
                {DAY_LABELS[todayKey]}
              </span>
            </div>

            <h2 className="mt-3 text-2xl sm:text-3xl font-black text-foreground tracking-tight leading-tight">
              {todayTraining ? todayFocus : "Rest Day & Recovery"}
            </h2>

            {/* Muscle / Focus Tags */}
            <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
              {todayTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-lg bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="flex size-12 sm:size-14 items-center justify-center rounded-2xl bg-muted text-foreground shadow-2xs shrink-0 border border-border/40">
            {todayCompleted ? (
              <CheckCircle2 className="size-7 text-emerald-600" />
            ) : cardio ? (
              <Zap className="size-7 text-amber-500" />
            ) : (
              <Dumbbell className="size-7 text-amber-500" />
            )}
          </div>
        </div>

        {/* Status Box & Action */}
        <div className="relative z-10 mt-5 pt-4 border-t border-border/40">
          {!todayTraining ? (
            <div className="flex items-center gap-2.5 rounded-2xl bg-muted p-3.5 border border-border/30">
              <Moon className="size-4 text-indigo-500 shrink-0" />
              <p className="text-sm font-semibold text-muted-foreground leading-snug">
                No intense lifting scheduled today. Focus on mobility, hydration, and restful
                recovery.
              </p>
            </div>
          ) : todayCompleted ? (
            <div className="flex items-center justify-between rounded-2xl bg-emerald-50 border border-emerald-200/60 p-3.5 text-emerald-700">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-500" />
                <span className="text-sm font-black">Logged & Done for the day!</span>
              </div>
              <span className="text-xs font-semibold text-muted-foreground">Great job! 💪</span>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleCompleteToday}
                disabled={completing}
                className="tap flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3.5 text-sm font-black text-white shadow-md hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-60"
              >
                {completing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4 stroke-[3]" />
                )}
                Mark Workout Completed
              </button>

              {/* Quick Companion Toggle */}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    sounds.playClick();
                    setShowTools(!showTools);
                  }}
                  className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Timer className="size-4 text-amber-500" />
                  {showTools ? "Hide Rest & Session Timers" : "Open Rest & Session Timers"}
                </button>
                <span className="text-xs text-muted-foreground font-medium">
                  Program: {activeProgram.name}
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* LIVE COMPANION & REST TIMER WIDGET */}
      {showTools && todayTraining && (
        <div className="card-soft bg-white border border-border/40 p-4 space-y-4 mb-4 rounded-3xl shadow-xs animate-in slide-in-from-top-2 duration-200">
          {/* Stopwatch */}
          <div className="flex items-center justify-between bg-muted rounded-xl p-3 border border-border/30">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-amber-500" />
              <div>
                <span className="text-xs font-black uppercase text-muted-foreground tracking-wider block">
                  Session Duration
                </span>
                <span className="text-lg font-black text-foreground tracking-tight">
                  {formatDuration(elapsedSeconds)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  sounds.playClick();
                  setStopwatchRunning(!stopwatchRunning);
                }}
                className={cn(
                  "tap flex size-8 items-center justify-center rounded-full text-white shadow-xs transition-colors",
                  stopwatchRunning
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-emerald-600 hover:bg-emerald-700",
                )}
              >
                {stopwatchRunning ? (
                  <Pause className="size-3.5" />
                ) : (
                  <Play className="size-3.5 ml-0.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  sounds.playClick();
                  setStopwatchRunning(false);
                  setElapsedSeconds(0);
                }}
                title="Reset duration"
                className="tap flex size-8 items-center justify-center rounded-full bg-slate-200 text-slate-600 hover:bg-slate-300"
              >
                <RotateCcw className="size-3.5" />
              </button>
            </div>
          </div>

          {/* Rest Interval Timer */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-black uppercase text-muted-foreground tracking-wider flex items-center gap-1">
                <Timer className="size-3 text-[#7C5CFC]" /> Rest Interval Timer
              </span>
              {restActive && (
                <span className="text-xs font-black text-amber-600">{restSeconds}s remaining</span>
              )}
            </div>

            {/* Quick Rest Preset Buttons */}
            <div className="grid grid-cols-4 gap-1.5">
              {[30, 60, 90, 120].map((secs) => (
                <button
                  key={secs}
                  type="button"
                  onClick={() => startRestTimer(secs)}
                  className={cn(
                    "tap py-2 rounded-xl text-xs font-black transition-all",
                    restActive && initialRest === secs
                      ? "bg-[#7C5CFC] text-white shadow-md ring-2 ring-[#7C5CFC]/20"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                  )}
                >
                  {secs}s
                </button>
              ))}
            </div>

            {restActive && (
              <div className="mt-2.5 flex items-center justify-between bg-[#7C5CFC]/10 border border-[#7C5CFC]/20 rounded-xl p-2 px-3">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-amber-500 animate-pulse" />
                  <span className="text-xs font-bold text-foreground">
                    Counting down {restSeconds}s
                  </span>
                </div>
                <button
                  type="button"
                  onClick={cancelRestTimer}
                  className="text-xs font-bold text-muted-foreground hover:text-foreground underline"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* WEEKLY SCHEDULE & INTERACTIVE DAY INSPECTOR */}
      <div className="card-soft bg-white p-5 border border-black/5 shadow-xs mb-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-foreground tracking-tight">
              Weekly Training Split
            </h3>
            <p className="text-xs font-semibold text-muted-foreground">
              Tap any day to preview routine & target muscles
            </p>
          </div>
          <span className="text-xs font-black text-[#7C5CFC] bg-[#7C5CFC]/10 px-2.5 py-1 rounded-full">
            {weekCompleted}/{weekTotal} done
          </span>
        </div>

        {/* Weekly Split Grid with interactive click */}
        <WeeklySplitGrid
          days={week.map((d) => ({
            key: d.key,
            focus: activeProgram ? focusForDay(activeProgram, d.key) : "Rest",
            isToday: d.isToday,
            completed: d.training && d.completed,
          }))}
          selectedKey={inspectedKey}
          onSelectDay={(key) => setSelectedDayKey(key)}
        />

        {/* Inspected Day Detail Card */}
        <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3.5 text-left transition-all">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-foreground">
                {DAY_LABELS[inspectedKey]} Focus:
              </span>
              <span className="text-xs font-black text-[#7C5CFC]">{inspectedFocus}</span>
            </div>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-extrabold",
                inspectedCompleted
                  ? "bg-emerald-500/15 text-emerald-700"
                  : inspectedTraining
                    ? "bg-amber-500/15 text-amber-800"
                    : "bg-slate-200 text-slate-700",
              )}
            >
              {inspectedCompleted
                ? "✓ Completed"
                : inspectedTraining
                  ? "Training Day"
                  : "Rest & Recovery"}
            </span>
          </div>

          <p className="mt-2 text-xs text-muted-foreground font-medium leading-relaxed">
            💡 {getFocusTips(inspectedFocus)}
          </p>
        </div>
      </div>

      {/* WEEKLY VOLUME & CONSISTENCY BAROMETER */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        {/* Weekly Progress Card */}
        <div className="card-soft bg-white p-4 border border-black/5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600">
                <Trophy className="size-4" />
              </div>
              <div>
                <p className="text-xs font-black text-foreground">Weekly Consistency</p>
                <p className="text-xs font-semibold text-muted-foreground">
                  {weekCompleted} of {weekTotal} sessions completed
                </p>
              </div>
            </div>
            <span className="text-base font-black text-foreground">{weekPct}%</span>
          </div>

          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-500 transition-all duration-500"
              style={{ width: `${weekPct}%` }}
            />
          </div>
        </div>

        {/* Tomorrow Lookahead Card */}
        <div className="card-soft bg-white p-4 border border-black/5 shadow-xs flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-600 shrink-0">
            <CalendarDays className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">
              Tomorrow · {DAY_LABELS[tomorrowKey]}
            </p>
            <h4 className="text-xs font-black text-foreground truncate">
              {tomorrowTraining ? tomorrowFocus : "Rest Day & Recovery"}
            </h4>
          </div>
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-black shrink-0",
              tomorrowTraining ? "bg-amber-500/15 text-amber-800" : "bg-slate-100 text-slate-700",
            )}
          >
            {tomorrowTraining ? "Training" : "Rest"}
          </span>
        </div>
      </div>
    </Screen>
  );
}
