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
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Screen } from "@/components/lifehub/Screen";
import { UserAvatar } from "@/components/lifehub/UserAvatar";
import { useAuth } from "@/hooks/use-auth";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useData } from "@/lib/data-context";
import { useHydration } from "@/lib/use-hydration";
import { getActivityTimeline, ActivityEntry, todayLocalDate } from "@/lib/api";
import { GlobalSearchModal } from "@/components/lifehub/GlobalSearchModal";
import { DashboardSkeleton } from "@/components/lifehub/SkeletonLoader";

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

// Semantic icons + colors for activity timeline entries (same vocabulary as
// the rest of the app — lucide icons in tinted circles, no platform emoji).
// Moved outside component to prevent recreation on every render
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

function Index() {
  const { user, loading: authLoading } = useAuth();
  useAuthGuard(user, authLoading);

  const {
    medications,
    bills,
    appointments,
    workouts,
    medLoading,
    billLoading,
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

  // Circular hydration ring geometry (r = 52 in a 120 viewBox)
  const RING_CIRCUMFERENCE = 2 * Math.PI * 52;

  const [activityTimeline, setActivityTimeline] = useState<ActivityEntry[]>([]);
  const [extraLoading, setExtraLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Dynamic week strip: track the base date (start of current week) and selected date
  const [weekBase, setWeekBase] = useState(() => {
    const today = new Date();
    const base = new Date(today);
    base.setDate(today.getDate() - today.getDay());
    base.setHours(0, 0, 0, 0);
    return base;
  });
  const [selectedDate, setSelectedDate] = useState(() => todayLocalDate());

  // Keep weekBase in sync with actual current date (midnight rollover, visibility)
  const refreshWeekBase = useCallback(() => {
    const today = new Date();
    const base = new Date(today);
    base.setDate(today.getDate() - today.getDay());
    base.setHours(0, 0, 0, 0);
    setWeekBase(base);
    // If selected date is no longer in the current week, snap to today
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

  const { takenMeds, compliancePct } = useMemo(() => {
    const taken = medications.filter((m) => m.taken).length;
    const pct = medications.length > 0 ? Math.round((taken / medications.length) * 100) : 0;
    return { takenMeds: taken, compliancePct: pct };
  }, [medications]);

  const upcomingApp = useMemo(
    () => appointments.find((a) => a.status !== "completed") || appointments[0],
    [appointments],
  );
  const upcomingMed = useMemo(
    () => medications.find((m) => !m.taken) || medications[0],
    [medications],
  );

  return (
    <Screen>
      {/* Top Header */}
      <header className="flex items-center justify-between">
        <Link to="/profile" className="flex items-center gap-3 group">
          <UserAvatar
            name={user?.full_name}
            src={user?.avatar_url}
            alt={user?.full_name || "User"}
            className="size-11 rounded-full border-2 border-[#7C5CFC]/20 shadow-xs group-hover:scale-105 transition-transform"
            initialsClassName="text-xs"
          />
          <div>
            <h2 className="text-base font-extrabold text-[#12131A]">
              Hello, {user?.full_name?.split(" ")[0] || "Friend"}
            </h2>
            <p className="text-xs font-semibold text-[#6B7280]">
              {new Date().toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
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
          className="tap flex size-10 items-center justify-center rounded-full bg-white shadow-xs border border-black/5 hover:bg-black/5 active:scale-95"
        >
          <Search className="size-4.5 text-[#12131A]" />
        </button>
      </header>

      {/* Daily Challenge Hero Banner */}
      <section className="card-soft relative mt-5 overflow-hidden bg-[#E8E2FF] p-5 shadow-sm">
        <div className="max-w-[62%]">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-0.5 text-[11px] font-extrabold text-[#12131A] backdrop-blur-xs">
            <Zap className="size-3 text-[#7C5CFC]" />
            {medications.length > 0 ? `${compliancePct}% completed` : "Daily Routine"}
          </span>
          <h1 className="mt-2 text-2xl font-extrabold text-[#12131A] leading-tight tracking-tight">
            Daily
            <br />
            challenge
          </h1>
          <p className="mt-1 text-xs font-medium text-[#12131A]/70">
            {medications.length > 0
              ? `${takenMeds} of ${medications.length} doses taken today`
              : "Organize workouts, health & bills."}
          </p>

          <div className="mt-4 flex items-center gap-2">
            <Link
              to="/medications"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#12131A] px-4 py-2 text-xs font-extrabold text-white transition-transform active:scale-95 hover:bg-[#12131A]/90"
            >
              <Pill className="size-3.5" /> Start Routine
            </Link>
          </div>
        </div>
        <img
          src="/illustration/hero-health.png"
          alt="Health & LifeHub Illustration"
          width={400}
          height={400}
          className="pointer-events-none absolute -right-2 top-1/2 w-44 max-h-40 -translate-y-1/2 object-contain drop-shadow-[0_10px_20px_rgba(124,92,252,0.25)]"
        />
      </section>

      {/* 7-Day Date Selector Strip — dynamic, real dates, week navigation */}
      <section className="mt-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <button
            onClick={goPrevWeek}
            className="tap flex size-8 items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs border border-black/5 hover:bg-black/5"
            aria-label="Previous week"
          >
            <ChevronLeft className="size-4.5" />
          </button>
          <span className="text-xs font-extrabold text-[#6B7280] flex-1 text-center">
            {weekStrip[0]
              ? `${weekStrip[0].day} ${weekStrip[0].date} – ${weekStrip[6].day} ${weekStrip[6].date}`
              : "Week"}
          </span>
          <button
            onClick={goNextWeek}
            className="tap flex size-8 items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs border border-black/5 hover:bg-black/5"
            aria-label="Next week"
          >
            <ChevronRight className="size-4.5" />
          </button>
        </div>
        <div className="flex items-center justify-between gap-1.5 overflow-x-auto pb-2 -mx-5 px-5">
          {weekStrip.map(({ day, date, key, isToday }) => {
            const isSelected = key === selectedDate;
            return (
              <button
                key={key}
                onClick={() => handleDaySelect(key)}
                className={`tap flex-shrink-0 flex flex-col items-center justify-center py-2.5 px-3 rounded-full transition-all min-w-[44px] ${
                  isSelected
                    ? "bg-[#12131A] text-white shadow-md font-bold scale-105"
                    : isToday
                      ? "bg-[#E8E2FF] text-[#7C5CFC] border-2 border-[#7C5CFC]/30 font-bold"
                      : "bg-white text-[#6B7280] border border-black/5 hover:bg-black/5 font-semibold"
                }`}
              >
                <span className="text-[10px] uppercase tracking-wider">{day}</span>
                <span className="text-sm font-extrabold mt-0.5">{date}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* "Your plan" Grid Section with REAL USER DATA */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-xl font-extrabold text-[#12131A]">Your plan</h2>
        <Link
          to="/appointments"
          className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-[#12131A] transition-colors hover:bg-gray-200"
        >
          See all ({appointments.length}) <ChevronRight className="size-3.5" />
        </Link>
      </div>

      <section className="mt-3 grid grid-cols-2 gap-3">
        {/* Real Appointment Card 1 */}
        {appLoading ? (
          <div
            role="status"
            aria-label="Loading your sessions"
            className="card-soft animate-pulse flex flex-col justify-between bg-[#FFC593]/70 p-4 min-h-[160px]"
          >
            <div>
              <div className="h-4 w-16 rounded-full bg-white/60" />
              <div className="mt-3 h-5 w-3/4 rounded-md bg-white/60" />
              <div className="mt-2 h-3 w-1/2 rounded-md bg-white/60" />
              <div className="mt-1.5 h-3 w-2/3 rounded-md bg-white/60" />
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-black/10 pt-2.5">
              <div className="h-3 w-20 rounded-md bg-white/60" />
              <div className="size-6 rounded-full bg-white/60" />
            </div>
          </div>
        ) : upcomingApp ? (
          <Link
            to="/appointments"
            className="card-soft tap relative flex flex-col justify-between bg-[#FFC593] p-4 text-[#12131A] hover:shadow-md transition-all min-h-[160px]"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-white/70 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide">
                  {upcomingApp.priority}
                </span>
              </div>
              <h3 className="mt-3 text-lg font-extrabold leading-snug line-clamp-1">
                {upcomingApp.title}
              </h3>
              <p className="mt-1 text-[11px] font-medium text-[#12131A]/80">
                {upcomingApp.appointment_date}
                <br />
                {upcomingApp.start_time || "10:00"}{" "}
                {upcomingApp.location ? `· ${upcomingApp.location}` : ""}
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-[#12131A]/90">
                <span className="flex size-5 items-center justify-center rounded-full bg-white/70 text-[#12131A]">
                  <Stethoscope className="size-3" />
                </span>
                <span className="truncate">{upcomingApp.doctor_name || "Personal Plan"}</span>
              </p>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-black/10 pt-2.5">
              <span className="text-[11px] font-bold">Session Status</span>
              <span
                className={`flex size-6 items-center justify-center rounded-full transition-all duration-300 ${
                  upcomingApp.status === "completed"
                    ? "bg-emerald-500/15 text-emerald-600"
                    : "bg-white text-[#12131A]"
                }`}
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
            className="card-soft tap relative flex flex-col justify-center items-center bg-white p-4 border border-dashed border-slate-200/60 text-center min-h-[160px]"
          >
            <CalendarIcon className="size-7 text-[#7C5CFC]/50" />
            <span className="mt-2 text-xs font-extrabold text-[#12131A]">No sessions</span>
            <span className="text-[10px] text-[#6B7280] font-medium mt-0.5">
              Tap to add appointment
            </span>
          </Link>
        )}

        {/* Real Medication / Health Card 2 */}
        {medLoading ? (
          <div
            role="status"
            aria-label="Loading your medications"
            className="card-soft animate-pulse flex flex-col justify-between bg-[#BEE3FF]/70 p-4 min-h-[160px]"
          >
            <div>
              <div className="h-4 w-16 rounded-full bg-white/60" />
              <div className="mt-3 h-5 w-3/4 rounded-md bg-white/60" />
              <div className="mt-2 h-3 w-1/2 rounded-md bg-white/60" />
              <div className="mt-1.5 h-3 w-2/3 rounded-md bg-white/60" />
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-black/10 pt-2.5">
              <div className="h-3 w-20 rounded-md bg-white/60" />
              <div className="size-6 rounded-full bg-white/60" />
            </div>
          </div>
        ) : upcomingMed ? (
          <Link
            to="/medications"
            className="card-soft tap relative flex flex-col justify-between bg-[#BEE3FF] p-4 text-[#12131A] hover:shadow-md transition-all min-h-[160px]"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-white/70 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide">
                  {upcomingMed.scheduled_time}
                </span>
              </div>
              <h3 className="mt-3 text-lg font-extrabold leading-snug line-clamp-1">
                {upcomingMed.name}
              </h3>
              <p className="mt-1 text-[11px] font-medium text-[#12131A]/80">
                {upcomingMed.dosage}
                <br />
                {upcomingMed.frequency}
              </p>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-black/10 pt-2.5">
              <span className="text-[11px] font-bold">Dose Status</span>
              <span
                className={`flex size-6 items-center justify-center rounded-full transition-all duration-300 ${
                  upcomingMed.taken
                    ? "bg-emerald-500/15 text-emerald-600"
                    : "bg-white text-[#12131A]"
                }`}
              >
                {upcomingMed.taken ? (
                  <Check className="size-3.5" strokeWidth={3} />
                ) : (
                  <Clock className="size-3.5" strokeWidth={3} />
                )}
              </span>
            </div>
          </Link>
        ) : (
          <Link
            to="/medications"
            className="card-soft tap relative flex flex-col justify-center items-center bg-white p-4 border border-dashed border-slate-200/60 text-center min-h-[160px]"
          >
            <Pill className="size-7 text-[#7C5CFC]/50" />
            <span className="mt-2 text-xs font-extrabold text-[#12131A]">No medications</span>
            <span className="text-[10px] text-[#6B7280] font-medium mt-0.5">Tap to add dose</span>
          </Link>
        )}
      </section>

      {/* Real Quick Trackers (Hydration & Health Adherence) */}
      <section className="mt-4 grid grid-cols-2 gap-3">
        {/* Premium Circular Hydration Tracker */}
        <div className="card-soft relative overflow-hidden border border-black/5 bg-gradient-to-br from-[#F0F9FF] via-white to-[#F5F0FF] p-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#6B7280]">Hydration</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                waterGoalReached
                  ? "bg-emerald-500/10 text-emerald-600"
                  : "bg-[#38BDF8]/10 text-[#0EA5E9]"
              }`}
            >
              <Droplets className="size-3" />
              {waterPct}%
            </span>
          </div>

          {/* Circular progress ring */}
          <div className="relative mx-auto mt-4 size-28">
            {/* Soft glow behind the ring */}
            <div
              aria-hidden
              className={`absolute -inset-2 rounded-full blur-xl ${
                waterGoalReached ? "bg-emerald-400/25" : "bg-[#38BDF8]/25"
              }`}
            />
            <svg viewBox="0 0 120 120" className="relative size-full -rotate-90">
              {/* Track */}
              <circle cx="60" cy="60" r="52" fill="none" stroke="#EEF2F7" strokeWidth="11" />
              {/* Progress */}
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke={waterGoalReached ? "url(#waterDoneGradient)" : "url(#waterGradient)"}
                strokeWidth="11"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE * (1 - waterPct / 100)}
                className="transition-[stroke-dashoffset,stroke] duration-700 ease-out"
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

            {/* Center readout: glasses vs daily goal */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-black leading-none tracking-tight text-[#12131A]">
                {waterGlasses}
              </span>
              <span className="mt-1 text-[10px] font-bold text-[#6B7280]">
                of {waterGoal} glasses
              </span>
            </div>
          </div>

          {/* Status line */}
          {waterGoalReached ? (
            <p className="mt-3 flex items-center justify-center gap-1 text-[11px] font-extrabold text-emerald-600">
              <Check className="size-3.5" /> Goal reached — stay hydrated!
            </p>
          ) : (
            <p className="mt-3 text-center text-[11px] font-semibold text-[#6B7280]">
              {Math.max(0, waterGoal - waterGlasses)} glass
              {waterGoal - waterGlasses === 1 ? "" : "es"} to go
            </p>
          )}

          {/* Quick controls */}
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                sounds.playActionClick();
                removeWater();
              }}
              disabled={waterBusy || waterGlasses <= 0}
              aria-label="Remove a glass of water"
              title="Remove a glass"
              className="tap flex size-9 items-center justify-center rounded-full border border-black/10 bg-white text-[#12131A] shadow-xs transition-transform hover:bg-black/5 active:scale-90 disabled:pointer-events-none disabled:opacity-40"
            >
              <Minus className="size-4" />
            </button>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#6B7280]">
              Add glass
            </span>
            <button
              type="button"
              onClick={() => {
                sounds.playActionClick();
                addWater();
              }}
              disabled={waterBusy}
              aria-label="Add a glass of water"
              title="Add a glass"
              className="tap flex size-9 items-center justify-center rounded-full bg-[#12131A] text-white shadow-md transition-transform hover:bg-[#12131A]/90 active:scale-90 disabled:pointer-events-none disabled:opacity-40"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>

        {medications.length === 0 ? (
          <Link
            to="/medications"
            className="card-soft tap flex flex-col items-center justify-center bg-white p-4 border border-dashed border-slate-200/60 text-center min-h-[160px]"
          >
            <Pill className="size-7 text-[#7C5CFC]/50" />
            <span className="mt-2 text-xs font-extrabold text-[#12131A]">No dose rate yet</span>
            <span className="text-[10px] text-[#6B7280] font-medium mt-0.5">
              Add medications to track
            </span>
          </Link>
        ) : (
          <Link
            to="/analytics"
            className="card-soft bg-white p-4 border border-black/5 hover:shadow-md transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#6B7280]">Dose Rate</span>
              <Pill className="size-4 text-[#7C5CFC]" />
            </div>
            <p className="mt-2 text-2xl font-black text-[#12131A]">{compliancePct}%</p>
            <p className="mt-0.5 text-[11px] font-semibold text-[#6B7280]">
              {takenMeds} of {medications.length} doses taken
            </p>
            <div className="mt-2 h-1.5 w-full rounded-full bg-black/5 overflow-hidden">
              <div
                className="h-full bg-[#7C5CFC] rounded-full"
                style={{ width: `${compliancePct}%` }}
              />
            </div>
          </Link>
        )}
      </section>

      {/* Quick Services Grid Bar */}
      <section className="mt-4 card-soft bg-gradient-to-br from-[#FFF0F5] to-[#FFE4EC] p-4 text-[#12131A]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-extrabold uppercase tracking-wide opacity-80">
            Quick Services
          </span>
          <span className="text-[11px] font-bold opacity-70">5 Tools</span>
        </div>
        <div className="flex items-center justify-between">
          <Link
            to="/bills"
            title="Pay Bills"
            onClick={() => sounds.playNavClick()}
            className="tap flex size-11 items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs hover:scale-105"
          >
            <Wallet className="size-4.5" />
          </Link>
          <Link
            to="/documents"
            title="Documents"
            onClick={() => sounds.playNavClick()}
            className="tap flex size-11 items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs hover:scale-105"
          >
            <FolderClosed className="size-4.5" />
          </Link>
          <Link
            to="/tasks"
            title="To-Do List"
            onClick={() => sounds.playNavClick()}
            className="tap flex size-11 items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs hover:scale-105"
          >
            <ListChecks className="size-4.5" />
          </Link>
          <Link
            to="/birthdays"
            title="Birthdays"
            onClick={() => sounds.playNavClick()}
            className="tap flex size-11 items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs hover:scale-105"
          >
            <Cake className="size-4.5" />
          </Link>
          <Link
            to="/ai"
            title="AI Assistant"
            onClick={() => sounds.playNavClick()}
            className="tap flex size-11 items-center justify-center rounded-full bg-[#12131A] text-white shadow-md hover:scale-105"
          >
            <Bot className="size-4.5" />
          </Link>
        </div>
      </section>

      {/* Real Activity Timeline (Generated from real user actions in DB) */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-lg font-extrabold text-[#12131A] flex items-center gap-2">
          <Activity className="size-4.5 text-[#7C5CFC]" /> Activity Timeline
        </h2>
      </div>

      <div className="mt-3 space-y-2">
        {activityTimeline.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200/60 p-5 text-center bg-white">
            <Activity className="mx-auto size-8 text-black/30" />
            <p className="mt-1 text-xs text-[#6B7280] font-medium">No activity recorded yet</p>
          </div>
        ) : (
          activityTimeline.slice(0, 5).map((log) => {
            const { Icon, bg } = kindMeta[log.kind] ?? kindMeta.other;

            return (
              <div
                key={log.id}
                className="card-soft bg-white p-3.5 flex items-center justify-between border border-black/5 shadow-xs"
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className={`flex size-8 items-center justify-center rounded-full ${bg}`}
                  >
                    <Icon className="size-4" strokeWidth={2.5} />
                  </span>
                  <div>
                    <p className="text-xs font-bold text-[#12131A]">{log.action}</p>
                    <p className="text-[11px] text-[#6B7280]">{log.description}</p>
                  </div>
                </div>
                <span className="text-[10px] font-semibold text-[#6B7280] shrink-0 ml-2">
                  {new Date(log.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
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
