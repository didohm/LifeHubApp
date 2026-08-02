import { useEffect, useState, useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
  Moon,
  Plus,
  Minus,
  Check,
  Dumbbell,
  Footprints,
  Stethoscope,
} from "lucide-react";
import { toast } from "sonner";
import { Screen } from "@/components/lifehub/Screen";
import { UserAvatar } from "@/components/lifehub/UserAvatar";
import { useAuth } from "@/hooks/use-auth";
import { useData } from "@/lib/data-context";
import { useHydration } from "@/lib/use-hydration";
import { getActivityTimeline, ActivityEntry } from "@/lib/api";
import { GlobalSearchModal } from "@/components/lifehub/GlobalSearchModal";
import { DashboardSkeleton } from "@/components/lifehub/SkeletonLoader";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Balance — Plan your day. Elevate your life." },
      {
        name: "description",
        content:
          "Balance keeps your schedule, habits, health, workouts, and daily tasks together in one elegant, calm space.",
      },
    ],
  }),
  component: Index,
});

const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Index() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

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
  const [extraLoading, setExtraLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedDayIndex, setSelectedDayIndex] = useState(new Date().getDay());

  useEffect(() => {
    if (!authLoading && !user) {
      navigate({ to: "/auth" });
    }
  }, [user, authLoading, navigate]);

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

  const isLoading = authLoading || medLoading || billLoading || appLoading || extraLoading;

  const { takenMeds, compliancePct } = useMemo(() => {
    const taken = medications.filter((m) => m.taken).length;
    const pct = medications.length > 0 ? Math.round((taken / medications.length) * 100) : 0;
    return { takenMeds: taken, compliancePct: pct };
  }, [medications]);

  const upcomingApp = useMemo(
    () => appointments.find((a) => a.status !== "completed") || appointments[0],
    [appointments]
  );
  const upcomingMed = useMemo(
    () => medications.find((m) => !m.taken) || medications[0],
    [medications]
  );

  // 7-day strip based on current date
  const weekStrip = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() - today.getDay() + i);
      return {
        day: daysOfWeek[d.getDay()],
        date: d.getDate(),
        dayIndex: d.getDay(),
      };
    });
  }, []);

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
              {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </p>
          </div>
        </Link>
        <button
          onClick={() => setSearchOpen(true)}
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
          alt="Health & Balance Illustration"
          width={400}
          height={400}
          className="pointer-events-none absolute -right-2 top-1/2 w-44 max-h-40 -translate-y-1/2 object-contain drop-shadow-[0_10px_20px_rgba(124,92,252,0.25)] transition-transform hover:scale-105"
        />
      </section>

      {/* 7-Day Date Selector Strip */}
      <section className="mt-4 flex items-center justify-between gap-1.5">
        {weekStrip.map(({ day, date, dayIndex }) => {
          const isSelected = dayIndex === selectedDayIndex;
          return (
            <button
              key={dayIndex}
              onClick={() => setSelectedDayIndex(dayIndex)}
              className={`tap flex flex-col items-center justify-center py-2.5 px-3 rounded-full transition-all ${
                isSelected
                  ? "bg-[#12131A] text-white shadow-md font-bold scale-105"
                  : "bg-white text-[#6B7280] border border-black/5 hover:bg-black/5 font-semibold"
              }`}
            >
              <span className="text-[10px] uppercase tracking-wider">{day}</span>
              <span className="text-sm font-extrabold mt-0.5">{date}</span>
            </button>
          );
        })}
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
        {upcomingApp ? (
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
              <h3 className="mt-3 text-lg font-extrabold leading-snug line-clamp-1">{upcomingApp.title}</h3>
              <p className="mt-1 text-[11px] font-medium text-[#12131A]/80">
                {upcomingApp.appointment_date}
                <br />
                {upcomingApp.start_time || "10:00"} {upcomingApp.location ? `· ${upcomingApp.location}` : ""}
              </p>
            </div>

            <div className="mt-4 flex items-center gap-2 border-t border-black/10 pt-2.5">
              <span className="flex size-6 items-center justify-center rounded-full bg-white/70 text-[#12131A]">
                <Stethoscope className="size-3.5" />
              </span>
              <span className="text-[11px] font-bold truncate">{upcomingApp.doctor_name || "Personal Plan"}</span>
            </div>
          </Link>
        ) : (
          <Link
            to="/appointments"
            className="card-soft tap relative flex flex-col justify-center items-center bg-white p-4 border border-dashed border-slate-200/60 text-center min-h-[160px]"
          >
            <CalendarIcon className="size-7 text-[#7C5CFC]/50" />
            <span className="mt-2 text-xs font-extrabold text-[#12131A]">No sessions</span>
            <span className="text-[10px] text-[#6B7280] font-medium mt-0.5">Tap to add appointment</span>
          </Link>
        )}

        {/* Real Medication / Health Card 2 */}
        {upcomingMed ? (
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
              <h3 className="mt-3 text-lg font-extrabold leading-snug line-clamp-1">{upcomingMed.name}</h3>
              <p className="mt-1 text-[11px] font-medium text-[#12131A]/80">
                {upcomingMed.dosage}
                <br />
                {upcomingMed.frequency}
              </p>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-black/10 pt-2.5">
              <span className="text-[11px] font-bold">Dose Status</span>
              <span className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${
                upcomingMed.taken ? "bg-[#12131A] text-white" : "bg-white text-[#12131A]"
              }`}>
                {upcomingMed.taken ? "✓" : "!"}
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
              <span className="mt-1 text-[10px] font-bold text-[#6B7280]">of {waterGoal} glasses</span>
            </div>
          </div>

          {/* Status line */}
          {waterGoalReached ? (
            <p className="mt-3 flex items-center justify-center gap-1 text-[11px] font-extrabold text-emerald-600">
              <Check className="size-3.5" /> Goal reached — stay hydrated!
            </p>
          ) : (
            <p className="mt-3 text-center text-[11px] font-semibold text-[#6B7280]">
              {Math.max(0, waterGoal - waterGlasses)} glass{waterGoal - waterGlasses === 1 ? "" : "es"} to go
            </p>
          )}

          {/* Quick controls */}
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => removeWater()}
              disabled={waterBusy || waterGlasses <= 0}
              aria-label="Remove a glass of water"
              title="Remove a glass"
              className="tap flex size-9 items-center justify-center rounded-full border border-black/10 bg-white text-[#12131A] shadow-xs transition-transform hover:bg-black/5 active:scale-90 disabled:pointer-events-none disabled:opacity-40"
            >
              <Minus className="size-4" />
            </button>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#6B7280]">Add glass</span>
            <button
              type="button"
              onClick={() => addWater()}
              disabled={waterBusy}
              aria-label="Add a glass of water"
              title="Add a glass"
              className="tap flex size-9 items-center justify-center rounded-full bg-[#12131A] text-white shadow-md transition-transform hover:bg-[#12131A]/90 active:scale-90 disabled:pointer-events-none disabled:opacity-40"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>

        <Link to="/analytics" className="card-soft bg-white p-4 border border-black/5 hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#6B7280]">Dose Rate</span>
            <Moon className="size-4 text-[#7C5CFC]" />
          </div>
          <p className="mt-2 text-2xl font-black text-[#12131A]">
            {medications.length > 0 ? `${compliancePct}%` : "0%"}
          </p>
          <p className="mt-0.5 text-[11px] font-semibold text-[#6B7280]">
            {takenMeds} of {medications.length} doses taken
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-black/5 overflow-hidden">
            <div className="h-full bg-[#7C5CFC] rounded-full" style={{ width: `${compliancePct}%` }} />
          </div>
        </Link>
      </section>

      {/* Quick Services Grid Bar */}
      <section className="mt-4 card-soft bg-gradient-to-br from-[#FFF0F5] to-[#FFE4EC] p-4 text-[#12131A]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-extrabold uppercase tracking-wide opacity-80">Quick Services</span>
          <span className="text-[11px] font-bold opacity-70">5 Tools</span>
        </div>
        <div className="flex items-center justify-between">
          <Link
            to="/bills"
            title="Pay Bills"
            className="tap flex size-11 items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs hover:scale-105"
          >
            <Wallet className="size-4.5" />
          </Link>
          <Link
            to="/documents"
            title="Documents"
            className="tap flex size-11 items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs hover:scale-105"
          >
            <FolderClosed className="size-4.5" />
          </Link>
          <Link
            to="/tasks"
            title="To-Do List"
            className="tap flex size-11 items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs hover:scale-105"
          >
            <ListChecks className="size-4.5" />
          </Link>
          <Link
            to="/birthdays"
            title="Birthdays"
            className="tap flex size-11 items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs hover:scale-105"
          >
            <Cake className="size-4.5" />
          </Link>
          <Link
            to="/ai"
            title="AI Assistant"
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
        <span className="text-xs font-bold text-[#6B7280]">Real DB feed</span>
      </div>

      <div className="mt-3 space-y-2">
        {activityTimeline.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200/60 p-5 text-center bg-white">
            <Activity className="mx-auto size-8 text-black/30" />
            <p className="mt-1 text-xs text-[#6B7280] font-medium">No activity recorded yet</p>
          </div>
        ) : (
          activityTimeline.slice(0, 5).map((log) => {
            let icon = "✓";
            let bg = "bg-[#E8E2FF] text-[#7C5CFC]";
            if (log.kind === "workout") {
              icon = "🏋️";
              bg = "bg-orange-500/10 text-orange-600";
            } else if (log.kind === "water") {
              icon = "💧";
              bg = "bg-sky-500/10 text-sky-600";
            } else if (log.kind === "task") {
              icon = "✅";
              bg = "bg-emerald-500/10 text-emerald-600";
            } else if (log.kind === "appointment") {
              icon = "📅";
              bg = "bg-purple-500/10 text-purple-600";
            } else if (log.kind === "medication") {
              icon = "💊";
              bg = "bg-pink-500/10 text-pink-600";
            } else if (log.kind === "walk") {
              icon = "🚶";
              bg = "bg-emerald-500/10 text-emerald-600";
            } else if (log.kind === "document") {
              icon = "📄";
              bg = "bg-blue-500/10 text-blue-600";
            }

            return (
              <div key={log.id} className="card-soft bg-white p-3.5 flex items-center justify-between border border-black/5 shadow-xs">
                <div className="flex items-center gap-3">
                  <span className={`flex size-8 items-center justify-center rounded-full text-xs font-bold ${bg}`}>
                    {icon}
                  </span>
                  <div>
                    <p className="text-xs font-bold text-[#12131A]">{log.action}</p>
                    <p className="text-[11px] text-[#6B7280]">{log.description}</p>
                  </div>
                </div>
                <span className="text-[10px] font-semibold text-[#6B7280] shrink-0 ml-2">
                  {new Date(log.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Global Search Modal */}
      {user && (
        <GlobalSearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} userId={user.id} />
      )}
    </Screen>
  );
}