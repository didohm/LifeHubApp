import { useEffect, useState, useMemo, useCallback } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { sounds } from "@/lib/sound";
import {
  Search,
  Wallet,
  FolderClosed,
  ListChecks,
  Pill,
  Calendar as CalendarIcon,
  Activity,
  Zap,
  Bot,
  Cake,
  ChevronRight,
  Droplets,
  Plus,
  Minus,
  Check,
  CheckCircle2,
  Clock,
  Dumbbell,
  Footprints,
  FileText,
  Stethoscope,
  ChevronLeft,
  Flame,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Screen } from "@/components/lifehub/Screen";
import { UserAvatar } from "@/components/lifehub/UserAvatar";
import { useAuth } from "@/hooks/use-auth";
import { useData } from "@/lib/data-context";
import { useHydration } from "@/lib/use-hydration";
import { getActivityTimeline, ActivityEntry, todayLocalDate } from "@/lib/api";
import { GlobalSearchModal } from "@/components/lifehub/GlobalSearchModal";
import { DashboardSkeleton } from "@/components/lifehub/SkeletonLoader";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LifeHub — Plan your day. Elevate your life." },
      {
        name: "description",
        content:
          "LifeHub keeps your schedule, habits, health, workouts, and daily tasks together in one elegant, calm space.",
      },
    ],
  }),
  component: Index,
});

const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const kindMeta: Record<ActivityEntry["kind"], { Icon: LucideIcon; bg: string }> = {
  workout: { Icon: Dumbbell, bg: "bg-orange-500/10 text-orange-600" },
  water: { Icon: Droplets, bg: "bg-sky-500/10 text-sky-600" },
  task: { Icon: ListChecks, bg: "bg-emerald-500/10 text-emerald-600" },
  appointment: { Icon: CalendarIcon, bg: "bg-purple-500/10 text-purple-600" },
  medication: { Icon: Pill, bg: "bg-pink-500/10 text-pink-600" },
  walk: { Icon: Footprints, bg: "bg-emerald-500/10 text-emerald-600" },
  document: { Icon: FileText, bg: "bg-blue-500/10 text-blue-600" },
  bill: { Icon: Wallet, bg: "bg-amber-500/10 text-amber-600" },
  other: { Icon: Zap, bg: "bg-[#E8E2FF] text-[#7C5CFC]" },
};

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function Index() {
  const { user, loading: authLoading } = useAuth();

  const {
    medications,
    bills,
    appointments,
    todos,
    workouts,
    walkSessions,
    medLoading,
    appLoading,
    toggleMedication,
  } = useData();

  const {
    glasses: waterGlasses,
    goal: waterGoal,
    pct: waterPct,
    goalReached: waterGoalReached,
    busy: waterBusy,
    addWater,
    removeWater,
  } = useHydration(user?.id);

  const RING_CIRCUMFERENCE = 2 * Math.PI * 52;

  const [activityTimeline, setActivityTimeline] = useState<ActivityEntry[]>([]);
  const [extraLoading, setExtraLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [togglingMedId, setTogglingMedId] = useState<string | null>(null);

  // Dynamic week strip: track base date (start of week) and selected date
  const [weekBase, setWeekBase] = useState(() => {
    const today = new Date();
    const base = new Date(today);
    base.setDate(today.getDate() - today.getDay());
    base.setHours(0, 0, 0, 0);
    return base;
  });
  const [selectedDate, setSelectedDate] = useState(() => todayLocalDate());

  const refreshWeekBase = useCallback(() => {
    const today = new Date();
    const base = new Date(today);
    base.setDate(today.getDate() - today.getDay());
    base.setHours(0, 0, 0, 0);
    setWeekBase(base);
    const sel = new Date(selectedDate);
    if (sel < base || sel >= new Date(base.getTime() + 7 * 86400000)) {
      setSelectedDate(todayLocalDate());
    }
  }, [selectedDate]);

  useEffect(() => {
    refreshWeekBase();
    const onVis = () => {
      if (document.visibilityState === "visible") refreshWeekBase();
    };
    document.addEventListener("visibilitychange", onVis);
    const iv = window.setInterval(refreshWeekBase, 60000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(iv);
    };
  }, [refreshWeekBase]);

  const weekStrip = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekBase);
      d.setDate(weekBase.getDate() + i);
      const key = todayLocalDate(d);
      return {
        day: daysOfWeek[d.getDay()],
        date: d.getDate(),
        dayIndex: d.getDay(),
        key,
        isToday: key === todayLocalDate(),
      };
    });
  }, [weekBase]);

  const goPrevWeek = useCallback(() => {
    const prev = new Date(weekBase);
    prev.setDate(weekBase.getDate() - 7);
    setWeekBase(prev);
    sounds.playNavClick();
  }, [weekBase]);

  const goNextWeek = useCallback(() => {
    const next = new Date(weekBase);
    next.setDate(weekBase.getDate() + 7);
    setWeekBase(next);
    sounds.playNavClick();
  }, [weekBase]);

  const handleDaySelect = useCallback((key: string) => {
    setSelectedDate(key);
    sounds.playNavClick();
  }, []);

  useEffect(() => {
    if (!user) return;
    setExtraLoading(true);
    getActivityTimeline(user.id, 10)
      .then((logsData) => {
        setActivityTimeline(logsData);
      })
      .catch((err) => {
        console.error("Dashboard activity timeline load error:", err);
      })
      .finally(() => {
        setExtraLoading(false);
      });
  }, [user]);

  // Medication compliance
  const { takenMeds, compliancePct } = useMemo(() => {
    const taken = medications.filter((m) => m.taken).length;
    const pct = medications.length > 0 ? Math.round((taken / medications.length) * 100) : 0;
    return { takenMeds: taken, compliancePct: pct };
  }, [medications]);

  // Overall Daily Pulse Score (Weighted combo of Meds, Water, Tasks, Workouts)
  const dailyScore = useMemo(() => {
    let components = 0;
    let scoreSum = 0;

    if (medications.length > 0) {
      components++;
      scoreSum += compliancePct;
    }
    if (waterGoal > 0) {
      components++;
      scoreSum += Math.min(100, waterPct);
    }
    if (todos.length > 0) {
      components++;
      const doneTodos = todos.filter((t) => t.completed).length;
      scoreSum += Math.round((doneTodos / todos.length) * 100);
    }
    if (workouts.length > 0 || walkSessions.length > 0) {
      components++;
      const todayDone =
        workouts.filter((w) => w.status === "completed").length + (walkSessions.length > 0 ? 1 : 0);
      scoreSum += Math.min(100, todayDone > 0 ? 100 : 0);
    }

    if (components === 0) return 0;
    return Math.round(scoreSum / components);
  }, [medications, compliancePct, waterGoal, waterPct, todos, workouts, walkSessions]);

  const upcomingApp = useMemo(
    () => appointments.find((a) => a.status !== "completed") || appointments[0],
    [appointments],
  );

  const upcomingMed = useMemo(
    () => medications.find((m) => !m.taken) || medications[0],
    [medications],
  );

  // Direct toggle medication dose from Home card
  const handleToggleMed = async (e: React.MouseEvent, medId: string, currentTaken: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user || togglingMedId) return;

    setTogglingMedId(medId);
    try {
      if (!currentTaken) {
        sounds.playSuccess?.();
        toast.success("Dose logged as taken!");
      } else {
        sounds.playClick();
        toast.info("Dose marked as pending");
      }
      await toggleMedication(medId, !currentTaken);
    } catch {
      toast.error("Failed to update medication status");
    } finally {
      setTogglingMedId(null);
    }
  };

  if (authLoading) {
    return (
      <Screen>
        <DashboardSkeleton />
      </Screen>
    );
  }

  return (
    <Screen contentClassName="max-w-3xl lg:max-w-4xl xl:max-w-5xl !px-4 sm:!px-6 lg:!px-8 !pt-4 sm:!pt-6 lg:!pt-8 !pb-28 sm:!pb-32">
      {/* ════════════════════════════════════════════════════════════
          APP HEADER — GREETING & SEARCH (responsive padding per html-tailwind)
          ════════════════════════════════════════════════════════════ */}
      <header className="flex items-center justify-between gap-3">
        <Link to="/profile" className="flex items-center gap-3 group">
          <UserAvatar
            name={user?.full_name}
            src={user?.avatar_url}
            alt={user?.full_name || "User profile"}
            className="size-11 rounded-full border-2 border-[#7C5CFC]/25 shadow-xs group-hover:scale-105 transition-transform"
            initialsClassName="text-xs font-bold"
          />
          <div>
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-extrabold text-[#12131A] tracking-tight">
                {getGreeting()}, {user?.full_name?.split(" ")[0] || "Friend"}
              </h2>
            </div>
            <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <span>
                {new Date().toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <span>•</span>
              <span className="text-[#7C5CFC] font-bold">
                {dailyScore >= 80 ? "🔥 High Focus" : "⚡ Daily Pulse"}
              </span>
            </p>
          </div>
        </Link>

        <button
          onClick={() => {
            sounds.playNavClick();
            setSearchOpen(true);
          }}
          aria-label="Search"
          title="Search features and items"
          className="tap flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white shadow-xs border border-border/60 hover:bg-accent active:scale-95 text-[#12131A] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC]"
        >
          <Search className="size-[18px] sm:size-4.5" />
        </button>
      </header>

      {/* ════════════════════════════════════════════════════════════
          HERO "DAILY PULSE" CARD — Dynamic Health & Progress Hub
          ════════════════════════════════════════════════════════════ */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="card-soft relative mt-4 sm:mt-5 lg:mt-6 overflow-hidden bg-gradient-to-br from-[#EAE6FF] via-[#F4F1FF] to-[#FAF8FF] p-4 sm:p-5 lg:p-6 shadow-sm border border-[#7C5CFC]/15"
      >
        <div className="max-w-[62%] sm:max-w-[60%] lg:max-w-[58%] relative z-10">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 text-[11px] font-black text-[#7C5CFC] shadow-2xs">
            <Zap className="size-3 text-[#7C5CFC]" />
            {dailyScore > 0 ? `${dailyScore}% Daily Score` : "Daily Routine"}
          </span>

          <h1 className="mt-2.5 text-2xl font-black text-[#12131A] leading-tight tracking-tight">
            Today's
            <br />
            Health Pulse
          </h1>

          <p className="mt-1 text-xs font-medium text-[#12131A]/75 leading-relaxed">
            {medications.length > 0 || waterGoal > 0
              ? `${takenMeds}/${medications.length} meds taken · ${waterGlasses}/${waterGoal} glasses water`
              : "Organize workouts, appointments & daily habits."}
          </p>

          <div className="mt-4 flex items-center gap-2">
            <Link
              to="/medications"
              onClick={() => sounds.playActionClick()}
              className="tap inline-flex items-center gap-1.5 rounded-full bg-[#12131A] px-4 py-2 text-xs font-extrabold text-white shadow-sm hover:bg-[#12131A]/90 transition-transform active:scale-95"
            >
              <Pill className="size-3.5" /> Start Routine
            </Link>

            <Link
              to="/analytics"
              onClick={() => sounds.playNavClick()}
              className="tap inline-flex items-center justify-center size-11 min-h-[44px] min-w-[44px] rounded-full bg-white text-[#12131A] shadow-xs border border-border/60 hover:bg-slate-50 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC]"
              title="View Analytics"
              aria-label="View Analytics"
            >
              <ArrowUpRight className="size-4 text-[#7C5CFC]" />
            </Link>
          </div>
        </div>

        <img
          src="/illustration/hero-health.webp"
          alt="Health & LifeHub Illustration"
          width={400}
          height={400}
          className="pointer-events-none absolute right-0 sm:right-1 top-1/2 w-32 sm:w-44 lg:w-52 max-h-36 sm:max-h-44 lg:max-h-48 -translate-y-1/2 object-contain drop-shadow-[0_12px_24px_rgba(124,92,252,0.25)] max-w-[42%]"
        />
      </motion.section>

      {/* ════════════════════════════════════════════════════════════
          7-DAY DATE STRIP — Dynamic Calendar Navigation
          ════════════════════════════════════════════════════════════ */}
      <section className="mt-4 sm:mt-5">
        <div className="flex items-center justify-between gap-2 mb-2.5 px-1">
          <button
            onClick={goPrevWeek}
            className="tap flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs border border-border/60 hover:bg-accent shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC]"
            aria-label="Previous week"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-xs sm:text-[13px] font-extrabold text-muted-foreground flex-1 text-center px-2">
            {weekStrip[0]
              ? `${weekStrip[0].day} ${weekStrip[0].date} – ${weekStrip[6].day} ${weekStrip[6].date}`
              : "Current Week"}
          </span>
          <button
            onClick={goNextWeek}
            className="tap flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs border border-border/60 hover:bg-accent shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC]"
            aria-label="Next week"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 sm:gap-2.5 overflow-x-auto pb-2 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {weekStrip.map(({ day, date, key, isToday }) => {
            const isSelected = key === selectedDate;
            return (
              <button
                key={key}
                onClick={() => handleDaySelect(key)}
                aria-label={`${day} ${date}${isToday ? " today" : ""}`}
                aria-pressed={isSelected}
                className={cn(
                  "tap flex-shrink-0 flex flex-col items-center justify-center py-2.5 px-3 rounded-2xl transition-all min-w-[48px] min-h-[56px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC] focus-visible:ring-offset-2",
                  isSelected
                    ? "bg-[#12131A] text-white shadow-md font-bold scale-105"
                    : isToday
                      ? "bg-[#EAE6FF] text-[#7C5CFC] border-2 border-[#7C5CFC]/30 font-bold"
                      : "bg-white text-muted-foreground border border-border/60 hover:bg-slate-50 font-semibold",
                )}
              >
                <span className="text-[11px] uppercase tracking-wider">{day}</span>
                <span className="text-sm font-extrabold mt-0.5">{date}</span>
                {isToday && (
                  <span
                    className={cn(
                      "size-1 rounded-full mt-1",
                      isSelected ? "bg-[#7C5CFC]" : "bg-[#7C5CFC]",
                    )}
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          "YOUR PLAN" SECTION — Real Appointment & Dose Action Cards
          ════════════════════════════════════════════════════════════ */}
      <div className="mt-5 sm:mt-6 flex items-center justify-between px-1">
        <h2 className="text-lg sm:text-xl font-extrabold text-[#12131A] tracking-tight">
          Today's Schedule
        </h2>
        <Link
          to="/appointments"
          onClick={() => sounds.playNavClick()}
          className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-[#12131A] hover:bg-slate-200 transition-colors shrink-0"
        >
          View All ({appointments.length}) <ChevronRight className="size-3.5" />
        </Link>
      </div>

      <section className="mt-3 grid grid-cols-2 gap-3 sm:gap-4 lg:gap-5">
        {/* Real Appointment Card */}
        {appLoading ? (
          <div className="card-soft animate-pulse flex flex-col justify-between bg-[#FFC593]/70 p-4 min-h-[160px]" />
        ) : upcomingApp ? (
          <Link
            to="/appointments"
            onClick={() => sounds.playCardClick()}
            className="card-soft tap group relative flex flex-col justify-between bg-gradient-to-br from-[#FFE0C7] to-[#FFD2AE] p-4 text-[#12131A] hover:shadow-md transition-all min-h-[160px] border border-amber-400/20"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide text-amber-900 shadow-2xs">
                  {upcomingApp.priority}
                </span>
                <span className="text-[11px] font-bold text-amber-900/80">
                  {upcomingApp.start_time || "Scheduled"}
                </span>
              </div>

              <h3 className="mt-3 text-[15px] font-extrabold leading-snug line-clamp-1 group-hover:text-amber-950">
                {upcomingApp.title}
              </h3>

              <p className="mt-1 text-[11px] font-medium text-[#12131A]/80 line-clamp-1">
                {upcomingApp.appointment_date}
                {upcomingApp.location ? ` · ${upcomingApp.location}` : ""}
              </p>

              <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-[#12131A]/90">
                <span className="flex size-5 items-center justify-center rounded-full bg-white/80 text-[#12131A] shadow-2xs">
                  <Stethoscope className="size-3" />
                </span>
                <span className="truncate">{upcomingApp.doctor_name || "Doctor Visit"}</span>
              </p>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-black/10 pt-2.5">
              <span className="text-[11px] font-bold">Session</span>
              <span
                className={cn(
                  "flex size-7 min-h-[28px] min-w-[28px] items-center justify-center rounded-full shadow-2xs transition-all",
                  upcomingApp.status === "completed"
                    ? "bg-emerald-600 text-white"
                    : "bg-white text-[#12131A]",
                )}
                aria-hidden
              >
                {upcomingApp.status === "completed" ? (
                  <Check className="size-3.5" strokeWidth={3} />
                ) : (
                  <Clock className="size-3.5" strokeWidth={3} />
                )}
              </span>
            </div>
          </Link>
        ) : (
          <Link
            to="/appointments"
            onClick={() => sounds.playClick()}
            className="card-soft tap flex flex-col justify-center items-center bg-white p-4 border border-dashed border-border text-center min-h-[160px] hover:border-[#7C5CFC]/40"
          >
            <CalendarIcon className="size-7 text-[#7C5CFC]/60" />
            <span className="mt-2 text-xs font-extrabold text-[#12131A]">No Sessions</span>
            <span className="text-[11px] text-muted-foreground font-medium mt-0.5">
              Tap to add doctor visit
            </span>
          </Link>
        )}

        {/* Real Medication Dose Card with DIRECT ONE-TAP LOGGING */}
        {medLoading ? (
          <div className="card-soft animate-pulse flex flex-col justify-between bg-[#BEE3FF]/70 p-4 min-h-[160px]" />
        ) : upcomingMed ? (
          <div className="card-soft group relative flex flex-col justify-between bg-gradient-to-br from-[#D9EFFF] to-[#C3E5FF] p-4 text-[#12131A] shadow-xs border border-sky-400/20 min-h-[160px]">
            <Link to="/medications" className="flex-1">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide text-sky-900 shadow-2xs">
                  {upcomingMed.scheduled_time}
                </span>
                <span className="text-[11px] font-bold text-sky-900/80">Dose</span>
              </div>

              <h3 className="mt-3 text-[15px] font-extrabold leading-snug line-clamp-1 group-hover:text-sky-950">
                {upcomingMed.name}
              </h3>

              <p className="mt-1 text-[11px] font-medium text-[#12131A]/80">
                {upcomingMed.dosage}
                <br />
                {upcomingMed.frequency}
              </p>
            </Link>

            {/* Interactive One-Tap Log Button directly on Home Card */}
            <div className="mt-3 flex items-center justify-between border-t border-black/10 pt-2.5">
              <span className="text-[11px] font-bold">
                {upcomingMed.taken ? "Taken" : "Take Dose"}
              </span>
              <button
                onClick={(e) => handleToggleMed(e, upcomingMed.id, upcomingMed.taken)}
                disabled={togglingMedId === upcomingMed.id}
                aria-label={upcomingMed.taken ? "Mark dose as pending" : "Mark dose as taken"}
                className={cn(
                  "tap flex size-10 min-h-[44px] min-w-[44px] items-center justify-center rounded-full shadow-xs transition-all active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2",
                  upcomingMed.taken
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-white text-sky-900 hover:bg-sky-50",
                )}
              >
                {upcomingMed.taken ? (
                  <Check className="size-4" strokeWidth={3} />
                ) : (
                  <Pill className="size-3.5 text-sky-700" />
                )}
              </button>
            </div>
          </div>
        ) : (
          <Link
            to="/medications"
            onClick={() => sounds.playClick()}
            className="card-soft tap flex flex-col justify-center items-center bg-white p-4 border border-dashed border-border text-center min-h-[160px] hover:border-[#7C5CFC]/40"
          >
            <Pill className="size-7 text-[#7C5CFC]/60" />
            <span className="mt-2 text-xs font-extrabold text-[#12131A]">No Prescriptions</span>
            <span className="text-[11px] text-muted-foreground font-medium mt-0.5">
              Tap to add dose schedule
            </span>
          </Link>
        )}
      </section>

      {/* ════════════════════════════════════════════════════════════
          QUICK TRACKERS — Hydration & Health Adherence (gap scales per html-tailwind)
          ════════════════════════════════════════════════════════════ */}
      <section className="mt-4 sm:mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:gap-5">
        {/* Interactive Circular Hydration Tracker */}
        <div className="card-soft relative overflow-hidden border border-border/60 bg-gradient-to-br from-[#F0F9FF] via-white to-[#F5F0FF] p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground">Hydration</span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-black",
                waterGoalReached
                  ? "bg-emerald-500/15 text-emerald-700"
                  : "bg-sky-500/15 text-sky-700",
              )}
            >
              <Droplets className="size-3" />
              {waterPct}%
            </span>
          </div>

          {/* Circular Progress Ring */}
          <div className="relative mx-auto mt-3 size-24">
            <div
              aria-hidden
              className={cn(
                "absolute -inset-2 rounded-full blur-lg opacity-40",
                waterGoalReached ? "bg-emerald-400" : "bg-sky-400",
              )}
            />
            <svg viewBox="0 0 120 120" className="relative size-full -rotate-90">
              <circle cx="60" cy="60" r="52" fill="none" stroke="#EEF2F7" strokeWidth="10" />
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke={waterGoalReached ? "url(#waterDoneGradient)" : "url(#waterGradient)"}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE * (1 - waterPct / 100)}
                className="transition-[stroke-dashoffset,stroke] duration-500 ease-out"
              />
              <defs>
                <linearGradient id="waterGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#38BDF8" />
                  <stop offset="100%" stopColor="#7C5CFC" />
                </linearGradient>
                <linearGradient id="waterDoneGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#34D399" />
                  <stop offset="100%" stopColor="#38BDF8" />
                </linearGradient>
              </defs>
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-black text-[#12131A] leading-none">
                {waterGlasses}
              </span>
              <span className="mt-0.5 text-[11px] font-bold text-muted-foreground">
                of {waterGoal} gl
              </span>
            </div>
          </div>

          <p className="mt-2.5 text-center text-[11px] font-semibold text-muted-foreground">
            {waterGoalReached
              ? "🎉 Target achieved!"
              : `${Math.max(0, waterGoal - waterGlasses)} glasses remaining`}
          </p>

          {/* Quick Glass Controls */}
          <div className="mt-2.5 flex items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                sounds.playActionClick();
                removeWater();
              }}
              disabled={waterBusy || waterGlasses <= 0}
              aria-label="Remove glass of water"
              className="tap flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-border/80 bg-white text-[#12131A] shadow-xs active:scale-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              <Minus className="size-3.5" />
            </button>
            <span className="text-[11px] font-black uppercase text-muted-foreground">Water</span>
            <button
              type="button"
              onClick={() => {
                sounds.playActionClick();
                addWater();
              }}
              disabled={waterBusy}
              aria-label="Add glass of water"
              className="tap flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-[#12131A] text-white shadow-xs hover:bg-[#12131A]/90 active:scale-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Dose Rate / Adherence Tracker */}
        {medications.length === 0 ? (
          <Link
            to="/medications"
            onClick={() => sounds.playClick()}
            className="card-soft tap flex flex-col items-center justify-center bg-white p-4 border border-dashed border-border text-center shadow-xs hover:border-[#7C5CFC]/40"
          >
            <Pill className="size-7 text-[#7C5CFC]/50" />
            <span className="mt-2 text-xs font-extrabold text-[#12131A]">Medication Rate</span>
            <span className="text-[11px] text-muted-foreground font-medium mt-0.5">
              Add prescriptions to track
            </span>
          </Link>
        ) : (
          <Link
            to="/analytics"
            onClick={() => sounds.playNavClick()}
            className="card-soft tap flex flex-col justify-between bg-white p-4 border border-border/60 shadow-xs hover:shadow-md transition-all"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-muted-foreground">Dose Adherence</span>
                <Pill className="size-4 text-[#7C5CFC]" />
              </div>
              <p className="mt-2 text-3xl font-black text-[#12131A]">{compliancePct}%</p>
              <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                {takenMeds} of {medications.length} doses logged
              </p>
            </div>

            <div className="mt-3">
              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-[#7C5CFC] rounded-full transition-all duration-500"
                  style={{ width: `${compliancePct}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] font-bold text-muted-foreground">
                <span>Analytics Details</span>
                <ChevronRight className="size-3 text-[#7C5CFC]" />
              </div>
            </div>
          </Link>
        )}
      </section>

      {/* ════════════════════════════════════════════════════════════
          QUICK SERVICES DOCK — 5 Core Daily Tools (touch-spacing ≥8px)
          ════════════════════════════════════════════════════════════ */}
      <section className="mt-4 sm:mt-5 card-soft bg-gradient-to-br from-[#FFF0F5] via-[#FFF5F8] to-[#FFE8F0] p-3.5 sm:p-4 lg:p-5 text-[#12131A] border border-pink-200/40 shadow-xs">
        <div className="flex items-center justify-between mb-3 sm:mb-4 px-1">
          <span className="text-xs font-extrabold uppercase tracking-wider text-pink-950">
            Quick Services
          </span>
          <span className="text-[11px] font-bold text-pink-900/70">5 Essentials</span>
        </div>

        <div className="flex items-center justify-between gap-2 sm:gap-3 lg:gap-4">
          <Link
            to="/bills"
            title="Bills & Finance"
            onClick={() => sounds.playNavClick()}
            className="tap flex flex-col items-center gap-1 group"
          >
            <div className="flex size-11 items-center justify-center rounded-2xl bg-white text-[#12131A] shadow-xs border border-pink-100 group-hover:scale-105 transition-transform">
              <Wallet className="size-5 text-amber-600" />
            </div>
            <span className="text-[10.5px] font-bold text-[#12131A]">Bills</span>
          </Link>

          <Link
            to="/documents"
            title="Documents"
            onClick={() => sounds.playNavClick()}
            className="tap flex flex-col items-center gap-1 group"
          >
            <div className="flex size-11 items-center justify-center rounded-2xl bg-white text-[#12131A] shadow-xs border border-pink-100 group-hover:scale-105 transition-transform">
              <FolderClosed className="size-5 text-blue-600" />
            </div>
            <span className="text-[10.5px] font-bold text-[#12131A]">Docs</span>
          </Link>

          <Link
            to="/tasks"
            title="To-Do Tasks"
            onClick={() => sounds.playNavClick()}
            className="tap flex flex-col items-center gap-1 group"
          >
            <div className="flex size-11 items-center justify-center rounded-2xl bg-white text-[#12131A] shadow-xs border border-pink-100 group-hover:scale-105 transition-transform">
              <ListChecks className="size-5 text-emerald-600" />
            </div>
            <span className="text-[10.5px] font-bold text-[#12131A]">Tasks</span>
          </Link>

          <Link
            to="/birthdays"
            title="Birthdays"
            onClick={() => sounds.playNavClick()}
            className="tap flex flex-col items-center gap-1 group"
          >
            <div className="flex size-11 items-center justify-center rounded-2xl bg-white text-[#12131A] shadow-xs border border-pink-100 group-hover:scale-105 transition-transform">
              <Cake className="size-5 text-purple-600" />
            </div>
            <span className="text-[10.5px] font-bold text-[#12131A]">Events</span>
          </Link>

          <Link
            to="/ai"
            title="AI Health Assistant"
            onClick={() => sounds.playNavClick()}
            className="tap flex flex-col items-center gap-1 group"
          >
            <div className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#7C5CFC] to-[#906FFA] text-white shadow-sm group-hover:scale-105 transition-transform">
              <Bot className="size-5" />
            </div>
            <span className="text-[10.5px] font-bold text-[#7C5CFC]">AI Chat</span>
          </Link>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          ACTIVITY TIMELINE — Live Chronological Stream
          ════════════════════════════════════════════════════════════ */}
      <div className="mt-5 flex items-center justify-between px-1">
        <h2 className="text-base font-extrabold text-[#12131A] flex items-center gap-2">
          <Activity className="size-4 text-[#7C5CFC]" /> Activity Timeline
        </h2>
        <Link
          to="/analytics"
          onClick={() => sounds.playNavClick()}
          className="text-xs font-bold text-[#7C5CFC] hover:underline"
        >
          See Analytics
        </Link>
      </div>

      <div className="mt-2.5 space-y-2">
        {activityTimeline.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-5 text-center bg-white">
            <Activity className="mx-auto size-7 text-muted-foreground/50" />
            <p className="mt-1.5 text-xs text-muted-foreground font-medium">
              No activity recorded yet
            </p>
          </div>
        ) : (
          activityTimeline.slice(0, 5).map((log) => {
            const { Icon, bg } = kindMeta[log.kind] ?? kindMeta.other;

            return (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="card-soft bg-white p-3 flex items-center justify-between border border-border/50 shadow-2xs"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-xl",
                      bg,
                    )}
                  >
                    <Icon className="size-4" strokeWidth={2.5} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-[#12131A] truncate">{log.action}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{log.description}</p>
                  </div>
                </div>
                <span className="text-[11px] font-semibold text-muted-foreground shrink-0 ml-2">
                  {new Date(log.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Global Search Modal */}
      {user && (
        <GlobalSearchModal
          isOpen={searchOpen}
          onClose={() => setSearchOpen(false)}
          userId={user.id}
        />
      )}
    </Screen>
  );
}
