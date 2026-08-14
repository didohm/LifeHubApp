import { useState, useMemo, useEffect, useRef, lazy, Suspense, useCallback } from "react";
import { createPortal } from "react-dom";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import {
  Play,
  Pause,
  Square,
  Footprints,
  Clock,
  Flame,
  MapPin,
  TrendingUp,
  History,
  Navigation,
  X,
  Car,
  Gauge,
  Satellite,
} from "lucide-react";
import { toast } from "sonner";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { registerOverlay } from "@/lib/overlay-registry";
import { useAuth } from "@/hooks/use-auth";
import { useData } from "@/lib/data-context";
import { useWalk } from "@/hooks/use-walk";
import { todayLocalDate } from "@/lib/api";
import { sounds } from "@/lib/sound";
import { PermissionManager } from "@/lib/permissions";
import { WalkServicePlugin, WalkRoutePoint } from "@/lib/notifications-integration";
import { WalkSession, WalkSummary } from "@/lib/types";
import { getWalkSummary } from "@/lib/walk-storage";

const RouteMap = lazy(() => import("@/components/lifehub/RouteMap"));
const EnhancedWalkSummary = lazy(() => import("@/components/lifehub/EnhancedWalkSummary"));
import PersonalStats, { StatCard } from "@/components/lifehub/PersonalStats";

export const Route = createFileRoute("/walk")({
  head: () => ({
    meta: [{ title: "Walk — Walking Tracker & Statistics" }],
  }),
  component: WalkPage,
});

function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) {
    const remMins = mins % 60;
    return `${hrs}h ${remMins}m ${secs}s`;
  }
  return `${mins}m ${secs}s`;
}

function formatKm(meters: number): string {
  return (meters / 1000).toFixed(2);
}

/** Strava-style pace: min per km (0.0 = no distance yet). */
function formatPace(durationSec: number, distanceMeters: number): string {
  if (distanceMeters <= 0 || durationSec <= 0) return "--";
  const minPerKm = durationSec / 60 / (distanceMeters / 1000);
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}'${secs.toString().padStart(2, "0")}"`;
}

/** Strava-style summary modal shown right after a walk/run finishes. */
export function WalkSummaryModal({
  session,
  summary,
  onClose,
}: {
  session?: WalkSession | null;
  summary?: WalkSummary | null;
  onClose: () => void;
}) {
  return (
    <Suspense fallback={null}>
      <EnhancedWalkSummary session={session} summary={summary} onClose={onClose} />
    </Suspense>
  );
}

function WalkPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { walkSessions, refreshFitness } = useData();

  const [statsPeriod, setStatsPeriod] = useState<"daily" | "weekly" | "monthly">("daily");

  // Validate user weight for accurate calorie calculation. Without it, no
  // calorie estimate is produced (0 kcal) — never a made-up 70kg default.
  const userWeightKg = user?.weight && Number(user.weight) > 0 ? Number(user.weight) : 0;
  const hasValidWeight = user?.weight && Number(user.weight) > 0;

  // Finished session shown in the summary modal.
  const [completedSummary, setCompletedSummary] = useState<WalkSummary | null>(null);
  const [completedSession, setCompletedSession] = useState<WalkSession | null>(null);

  // Single completion experience: summary modal + chime, refreshed stats.
  const handleWalkComplete = useCallback(
    async (result: WalkSession) => {
      if (!result) return;
      refreshFitness();
      // Stray sessions (accidental start/stop, <60s and <50m) are saved as
      // "cancelled" — no summary modal, no chime, just refreshed stats.
      if (result.status === "cancelled") return;
      sounds.playSuccess();
      // Load the full summary from local SQLite (includes splits, elevation, etc.)
      try {
        const summary = await getWalkSummary(result.id);
        if (summary) {
          setCompletedSummary(summary);
        } else {
          setCompletedSession(result);
        }
      } catch (error) {
        console.error("Failed to load walk summary:", error);
        setCompletedSession(result);
      }
    },
    [refreshFitness],
  );

  const {
    status,
    isAutoPaused,
    duration,
    distance,
    calories,
    steps,
    gpsAvailable,
    vehicleFlagged,
    loading,
    startWalk,
    pauseWalk,
    resumeWalk,
    finishWalk,
  } = useWalk(user?.id, userWeightKg, handleWalkComplete);

  // Native walk notification buttons (Pause/Finish) are handled inside use-walk
  // via the walkUpdate "action" field, which keeps the React session and the
  // foreground service perfectly in sync. Notification "Finish" routes through
  // the same handler above so the summary always appears.

  const handleFinish = async () => {
    const result = await finishWalk();
    if (result) handleWalkComplete(result);
  };

  // Calculate stats based on real database records.
  // Every session is an independent record, so all sessions in the selected
  // period are aggregated (distance, duration, steps, calories, count).
  // Periods are calendar-based and computed with the LOCAL date (the `day`
  // field is the local YYYY-MM-DD the walk belongs to), so they stay correct
  // across midnight and in any timezone.
  const stats = useMemo(() => {
    const todayStr = todayLocalDate();
    const startOfPeriod = (offsetDays: number) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - offsetDays);
      return todayLocalDate(d);
    };
    // Daily = today; Weekly = today + previous 6 calendar days;
    // Monthly = today + previous 29 calendar days. YYYY-MM-DD strings
    // compare lexicographically, so string comparison is a valid date range.
    const periodStart =
      statsPeriod === "daily"
        ? todayStr
        : statsPeriod === "weekly"
          ? startOfPeriod(6)
          : startOfPeriod(29);

    const filtered = walkSessions.filter((s) => {
      const walkDay =
        s.day ||
        (s.started_at ? s.started_at.slice(0, 10) : s.created_at ? s.created_at.slice(0, 10) : "");
      return s.status === "finished" && !!walkDay && walkDay >= periodStart && walkDay <= todayStr;
    });

    const totalDistance = filtered.reduce((sum, s) => sum + (s.distance || 0), 0);
    const totalDuration = filtered.reduce((sum, s) => sum + (s.duration || 0), 0);
    const totalCalories = filtered.reduce((sum, s) => sum + (s.calories || 0), 0);
    const totalSteps = filtered.reduce((sum, s) => sum + (s.steps || 0), 0);

    return {
      count: filtered.length,
      totalDistance,
      totalDuration,
      totalCalories,
      totalSteps,
    };
  }, [walkSessions, statsPeriod]);

  // Recent finished walks — the 5 newest sessions on the main screen, newest
  // first. Each item opens the same summary modal (metrics + route map) when
  // tapped. The full list lives on /walk/history ("View All").
  const walkHistory = useMemo(() => {
    return walkSessions
      .filter((s) => s.status === "finished")
      .sort((a, b) => (b.started_at || b.created_at).localeCompare(a.started_at || a.created_at))
      .slice(0, 5);
  }, [walkSessions]);

  const totalFinishedWalks = useMemo(
    () => walkSessions.filter((s) => s.status === "finished").length,
    [walkSessions],
  );

  return (
    <Screen>
      <ScreenHeader
        title="Walking Service"
        subtitle="Track walks, duration, distance & calories"
        showBack
      />

      {/* Main Walk Active / Controller Card */}
      <section className="card-soft relative overflow-hidden bg-gradient-to-br from-[#12131A] via-[#1A1C28] to-[#2E3146] p-6 text-white shadow-xl mb-5">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-extrabold text-emerald-400 backdrop-blur-xs">
            <Navigation className="size-3.5 animate-pulse" />
            {status === "active"
              ? "Walk in Progress"
              : status === "paused"
                ? isAutoPaused
                  ? "Auto-Paused (No Motion)"
                  : "Walk Paused"
                : "Ready to Walk"}
          </span>

          <span
            className={`text-[11px] font-semibold flex items-center gap-1 ${
              gpsAvailable === false ? "text-amber-300/90" : "text-white/60"
            }`}
          >
            <Satellite className="size-3.5" />
            {status === "active" || status === "paused"
              ? gpsAvailable === true
                ? "GPS Tracking"
                : gpsAvailable === false
                  ? "GPS Lost — counting steps"
                  : "GPS Searching…"
              : "GPS Ready"}
            {vehicleFlagged && (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-black text-amber-300">
                <Car className="size-3" /> Vehicle
              </span>
            )}
          </span>
        </div>

        {/* Live Metrics Display */}
        <div className="my-6 text-center">
          <div className="text-5xl font-black tracking-tight text-white">
            {formatKm(distance)} <span className="text-xl font-bold text-white/60">km</span>
          </div>
          <p className="text-xs font-bold text-emerald-400 mt-1 uppercase tracking-wider">
            Distance Walked
          </p>
        </div>

        {/* 3 Metrics Sub-Row */}
        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-white/10 p-3 backdrop-blur-md border border-white/10 text-center">
          <div>
            <div className="flex items-center justify-center gap-1 text-white/70 text-xs font-bold mb-0.5">
              <Clock className="size-3.5 text-[#7C5CFC]" /> Duration
            </div>
            <span className="text-sm font-black">{formatDuration(duration)}</span>
          </div>

          <div className="border-x border-white/10">
            <div className="flex items-center justify-center gap-1 text-white/70 text-xs font-bold mb-0.5">
              <Flame className="size-3.5 text-orange-400" /> Calories
            </div>
            <span className="text-sm font-black">{calories} kcal</span>
          </div>

          <div>
            <div className="flex items-center justify-center gap-1 text-white/70 text-xs font-bold mb-0.5">
              <Footprints className="size-3.5 text-emerald-400" /> Steps
            </div>
            <span className="text-sm font-black">{steps}</span>
          </div>
        </div>

        {/* Action Controls (Start / Pause / Resume / Finish) */}
        <div className="mt-6 flex items-center justify-center gap-3">
          {status === "idle" && (
            <button
              onClick={async () => {
                sounds.playActionClick();
                // Warn user if weight is not set (calories won't be estimated)
                if (!hasValidWeight) {
                  toast.warning(
                    "Weight not set — walk calories won't be estimated until you complete onboarding with your height & weight.",
                  );
                }
                // Feature-time permissions: if denied earlier, ask again now
                // that the user is actually using the walking feature. BODY_SENSORS
                // is requested too — it lets the foreground service combine the
                // health FGS type with location (Android 14+ requirement); the
                // service falls back to location-only when it is missing.
                await PermissionManager.ensurePermission("location");
                await PermissionManager.ensurePermission("activity");
                await PermissionManager.ensurePermission("health");
                startWalk();
              }}
              disabled={loading}
              className="tap flex items-center gap-2 rounded-full bg-emerald-500 px-8 py-3.5 text-sm font-black text-white shadow-lg hover:bg-emerald-600 active:scale-95 transition-transform"
            >
              <Play className="size-5 fill-white" /> Start New Walk
            </button>
          )}

          {status === "active" && (
            <>
              <button
                onClick={pauseWalk}
                className="tap flex items-center gap-2 rounded-full bg-amber-500 px-6 py-3.5 text-xs font-extrabold text-white shadow-md hover:bg-amber-600 active:scale-95"
              >
                <Pause className="size-4 fill-white" /> Pause
              </button>
              <button
                onClick={handleFinish}
                disabled={loading}
                className="tap flex items-center gap-2 rounded-full bg-rose-500 px-6 py-3.5 text-xs font-extrabold text-white shadow-md hover:bg-rose-600 active:scale-95"
              >
                <Square className="size-4 fill-white" /> Finish
              </button>
            </>
          )}

          {status === "paused" && (
            <>
              <button
                onClick={resumeWalk}
                className="tap flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3.5 text-xs font-extrabold text-white shadow-md hover:bg-emerald-600 active:scale-95"
              >
                <Play className="size-4 fill-white" /> Resume
              </button>
              <button
                onClick={handleFinish}
                disabled={loading}
                className="tap flex items-center gap-2 rounded-full bg-rose-500 px-6 py-3.5 text-xs font-extrabold text-white shadow-md hover:bg-rose-600 active:scale-95"
              >
                <Square className="size-4 fill-white" /> Finish
              </button>
            </>
          )}
        </div>
      </section>

      {/* Walking Statistics Section */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-extrabold text-[#12131A] flex items-center gap-2">
          <TrendingUp className="size-4.5 text-[#7C5CFC]" /> Walking Statistics
        </h2>

        {/* Period Selector Toggle */}
        <div className="flex rounded-full bg-black/5 p-1 text-[11px] font-extrabold">
          <button
            onClick={() => setStatsPeriod("daily")}
            className={`px-3 py-1 rounded-full transition-all ${
              statsPeriod === "daily" ? "bg-white text-[#12131A] shadow-xs" : "text-[#6B7280]"
            }`}
          >
            Daily
          </button>
          <button
            onClick={() => setStatsPeriod("weekly")}
            className={`px-3 py-1 rounded-full transition-all ${
              statsPeriod === "weekly" ? "bg-white text-[#12131A] shadow-xs" : "text-[#6B7280]"
            }`}
          >
            Weekly
          </button>
          <button
            onClick={() => setStatsPeriod("monthly")}
            className={`px-3 py-1 rounded-full transition-all ${
              statsPeriod === "monthly" ? "bg-white text-[#12131A] shadow-xs" : "text-[#6B7280]"
            }`}
          >
            Monthly
          </button>
        </div>
      </div>

      <div className="space-y-4 mb-5">
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<TrendingUp className="size-5 text-[#22C55E]" />}
            label="Total Distance"
            value={`${formatKm(stats.totalDistance)} km`}
            color="green"
          />
          <StatCard
            icon={<Flame className="size-5 text-[#F97316]" />}
            label="Calories Burned"
            value={`${stats.totalCalories} kcal`}
            color="orange"
          />
          <StatCard
            icon={<Clock className="size-5 text-[#EAB308]" />}
            label="Total Duration"
            value={formatDuration(stats.totalDuration)}
            color="yellow"
          />
          <StatCard
            icon={<Footprints className="size-5 text-[#7C5CFC]" />}
            label="Total Steps"
            value={stats.totalSteps.toLocaleString()}
            color="purple"
          />
        </div>
      </div>

      {/* Personal Records & Last 7 Days trend */}
      {user?.id && (
        <div className="mb-5">
          <Suspense fallback={<div className="h-40 bg-slate-100 rounded-xl animate-pulse" />}>
            <PersonalStats userId={user.id} walkSessions={walkSessions} />
          </Suspense>
        </div>
      )}

      {/* Walking History */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-extrabold text-[#12131A] flex items-center gap-2">
          <History className="size-4.5 text-[#7C5CFC]" /> Walk History
        </h2>
        <button
          onClick={() => navigate({ to: "/walk/history" })}
          className="text-xs font-extrabold text-[#7C5CFC] hover:underline flex items-center gap-1"
        >
          View All ({totalFinishedWalks}) &rarr;
        </button>
      </div>

      <div className="space-y-2">
        {walkHistory.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200/60 p-6 text-center bg-white">
            <Footprints className="mx-auto size-10 text-black/20" />
            <p className="mt-2 text-xs font-bold text-[#12131A]">No walks completed yet</p>
            <p className="text-[11px] text-[#6B7280]">Tap "Start Walk" above to begin tracking!</p>
          </div>
        ) : (
          walkHistory.map((s) => (
            <button
              key={s.id}
              onClick={async () => {
                const summary = await getWalkSummary(s.id);
                if (summary) {
                  setCompletedSummary(summary);
                } else {
                  // Fallback for session without summary in SQLite
                  setCompletedSession(s);
                }
              }}
              className="card-soft bg-white p-3.5 border border-black/5 shadow-xs flex items-center justify-between w-full text-left active:scale-[0.98] transition-transform"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
                  <Footprints className="size-5" />
                </div>
                <div>
                  <h4 className="text-sm font-extrabold text-[#12131A]">
                    {formatKm(s.distance)} km Walk
                  </h4>
                  <p className="text-[11px] font-semibold text-[#6B7280]">
                    {new Date(s.finished_at || s.started_at).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    · {formatDuration(s.duration)} · {s.calories} kcal · {s.steps} steps
                    {s.vehicle && " · 🚗"}
                  </p>
                </div>
              </div>

              <span className="flex flex-col items-end gap-1">
                <span className="text-[10px] font-bold text-[#6B7280] bg-black/5 rounded-full px-2.5 py-1">
                  {new Date(s.finished_at || s.started_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black ${
                    s.path && s.path.length >= 2
                      ? "bg-emerald-50 text-emerald-600"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  <MapPin className="size-2.5" />
                  {s.path && s.path.length >= 2 ? "Route" : "No route"}
                </span>
              </span>
            </button>
          ))
        )}
      </div>

      {/* Strava-style summary modal for finished/selected walks */}
      {(completedSummary || completedSession) && (
        <Suspense fallback={null}>
          <EnhancedWalkSummary
            summary={completedSummary}
            session={completedSession}
            onClose={() => {
              setCompletedSummary(null);
              setCompletedSession(null);
            }}
          />
        </Suspense>
      )}
    </Screen>
  );
}
