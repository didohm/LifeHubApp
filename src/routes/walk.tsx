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
  Target,
  Sparkles,
  Map as MapIcon,
  Zap,
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
import { cn } from "@/lib/utils";

const RouteMap = lazy(() => import("@/components/lifehub/RouteMap"));
const EnhancedWalkSummary = lazy(() => import("@/components/lifehub/EnhancedWalkSummary"));
import PersonalStats, { StatCard } from "@/components/lifehub/PersonalStats";

export const Route = createFileRoute("/walk")({
  head: () => ({
    meta: [
      { title: "Walk & GPS Route Tracker — LifeHub" },
      {
        name: "description",
        content: "Track outdoor walks, real-time pace, GPS route trails, and calorie metrics.",
      },
    ],
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
  if (distanceMeters <= 50 || durationSec <= 0) return "--";
  const minPerKm = durationSec / 60 / (distanceMeters / 1000);
  if (minPerKm > 60) return "--";
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
  const [showLiveMap, setShowLiveMap] = useState(false);

  // In-context rationale dialogs
  const [showBgLocationDialog, setShowBgLocationDialog] = useState(false);
  const [showBatteryDialog, setShowBatteryDialog] = useState(false);

  const userWeightKg = user?.weight && Number(user.weight) > 0 ? Number(user.weight) : 0;
  const hasValidWeight = user?.weight && Number(user.weight) > 0;

  // Finished session shown in the summary modal.
  const [completedSummary, setCompletedSummary] = useState<WalkSummary | null>(null);
  const [completedSession, setCompletedSession] = useState<WalkSession | null>(null);

  const handleWalkComplete = useCallback(
    async (result: WalkSession) => {
      if (!result) return;
      refreshFitness();
      if (result.status === "cancelled") {
        toast.info("Walk cancelled — too short to record. Tap Start to begin again.");
        return;
      }
      sounds.playWalkFinish();
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
    path,
    gpsAvailable,
    vehicleFlagged,
    loading,
    startWalk,
    pauseWalk,
    resumeWalk,
    finishWalk,
  } = useWalk(user?.id, userWeightKg, handleWalkComplete);

  const continueStartSequence = useCallback(async () => {
    try {
      const { exempt } = await WalkServicePlugin.isBatteryOptimizationExempt();
      if (!exempt) {
        setShowBatteryDialog(true);
        return;
      }
    } catch {
      /* web fallback */
    }
    sounds.playWalkStart();
    startWalk();
  }, [startWalk]);

  const handleStartClick = useCallback(async () => {
    sounds.playActionClick();
    if (!hasValidWeight) {
      toast.warning(
        "Weight not set — walk calories won't be estimated until you complete profile weight.",
      );
    }
    await PermissionManager.ensurePermission("location");
    await PermissionManager.ensurePermission("activity");
    await PermissionManager.ensurePermission("health");

    if (await PermissionManager.check("location")) {
      const bg = await PermissionManager.check("background");
      if (!bg) {
        if (PermissionManager.wasDenied("background")) {
          toast.warning(
            "Background location is off — tracking may pause when app is minimized.",
          );
        } else {
          setShowBgLocationDialog(true);
          return;
        }
      }
    }
    await continueStartSequence();
  }, [continueStartSequence, hasValidWeight]);

  const acceptBgLocationDialog = useCallback(async () => {
    setShowBgLocationDialog(false);
    const granted = await PermissionManager.request("background");
    if (!granted) {
      toast.warning("Background location is off.");
    }
    await continueStartSequence();
  }, [continueStartSequence]);

  const acceptBatteryDialog = useCallback(async () => {
    setShowBatteryDialog(false);
    try {
      await WalkServicePlugin.requestBatteryOptimizationExemption();
    } catch (e) {
      console.warn("Failed to open battery optimization request:", e);
    }
    sounds.playWalkStart();
    startWalk();
  }, [startWalk]);

  const handlePause = () => {
    sounds.playWalkPause();
    pauseWalk();
  };

  const handleResume = () => {
    sounds.playWalkStart();
    resumeWalk();
  };

  const handleFinish = async () => {
    try {
      sounds.playActionClick();
      const result = await finishWalk();
      if (result) {
        await handleWalkComplete(result);
      } else {
        toast.error("Could not finish the walk — please try again.");
      }
    } catch (error) {
      console.error("Failed to finish walk:", error);
      toast.error("Could not finish the walk — please try again.");
    }
  };

  // Aggregated walking stats
  const stats = useMemo(() => {
    const todayStr = todayLocalDate();
    const startOfPeriod = (offsetDays: number) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - offsetDays);
      return todayLocalDate(d);
    };

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

  // Recent finished walks
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

  const currentPaceStr = useMemo(() => formatPace(duration, distance), [duration, distance]);

  // Daily distance target (3.0 km standard baseline)
  const dailyTargetMeters = 3000;
  const todayProgressPct = Math.min(100, Math.round((distance / dailyTargetMeters) * 100));

  return (
    <Screen>
      <ScreenHeader
        title="Walking Service"
        subtitle="GPS route tracking, pace & live telemetry"
        showBack
        action={
          <button
            type="button"
            onClick={() => navigate({ to: "/walk/history" })}
            className="tap flex items-center gap-1 text-xs font-black text-[#12131A] bg-white border border-border/60 px-3.5 py-1.5 rounded-full shadow-2xs hover:bg-slate-50 transition-transform active:scale-95"
          >
            <History className="size-3.5 text-[#7C5CFC]" /> History
          </button>
        }
      />

      {/* ══════════════════════════════════════════════════════════════
          MAIN TELEMETRY & LIVE TRACKING COCKPIT
          ══════════════════════════════════════════════════════════════ */}
      <section className="card-soft relative overflow-hidden bg-gradient-to-br from-[#0D0F17] via-[#151824] to-[#22283A] p-6 text-white shadow-xl mb-5 rounded-3xl border border-white/10">
        {/* Glow ambient circle */}
        <div
          className={cn(
            "absolute -top-10 -right-10 size-48 rounded-full blur-3xl pointer-events-none opacity-25",
            status === "active" ? "bg-emerald-500" : status === "paused" ? "bg-amber-500" : "bg-indigo-500",
          )}
        />

        <div className="relative z-10 flex items-center justify-between gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black backdrop-blur-md shadow-2xs",
              status === "active"
                ? "bg-emerald-500/25 text-emerald-300 border border-emerald-400/30"
                : status === "paused"
                  ? "bg-amber-500/25 text-amber-300 border border-amber-400/30"
                  : "bg-white/10 text-white/80 border border-white/10",
            )}
          >
            <Navigation
              className={cn(
                "size-3.5",
                status === "active" && "animate-pulse text-emerald-300",
              )}
            />
            {status === "active"
              ? "Walk in Progress"
              : status === "paused"
                ? isAutoPaused
                  ? "Auto-Paused"
                  : "Walk Paused"
                : "Ready to Walk"}
          </span>

          <span
            className={cn(
              "text-[11px] font-bold flex items-center gap-1.5 rounded-full px-2.5 py-0.5 backdrop-blur-xs",
              gpsAvailable === false
                ? "bg-amber-500/20 text-amber-300 border border-amber-400/30"
                : "bg-white/5 text-white/70",
            )}
          >
            <Satellite className="size-3.5 text-emerald-400" />
            {status === "active" || status === "paused"
              ? gpsAvailable === true
                ? "GPS Fixed"
                : gpsAvailable === false
                  ? "GPS Searching"
                  : "Acquiring Fix"
              : "GPS Ready"}
            {vehicleFlagged && (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] font-black text-amber-300">
                <Car className="size-2.5" /> Vehicle
              </span>
            )}
          </span>
        </div>

        {/* Live Distance Hero Indicator */}
        <div className="relative z-10 my-6 text-center">
          <div className="text-5xl sm:text-6xl font-extrabold tracking-tight text-white">
            {formatKm(distance)} <span className="text-xl font-bold text-white/60">km</span>
          </div>
          <p className="text-xs font-black text-emerald-400 mt-1 uppercase tracking-widest flex items-center justify-center gap-1">
            <Footprints className="size-3.5" /> Total Distance Walked
          </p>
        </div>

        {/* Live Telemetry Grid (Pace, Duration, Calories, Steps) */}
        <div className="relative z-10 grid grid-cols-4 gap-1.5 rounded-2xl bg-white/10 p-3 backdrop-blur-md border border-white/10 text-center">
          <div>
            <div className="flex items-center justify-center gap-1 text-white/70 text-[10px] font-black uppercase tracking-wider mb-0.5">
              <Gauge className="size-3 text-cyan-400" /> Pace
            </div>
            <span className="text-xs sm:text-sm font-black text-white">{currentPaceStr}</span>
          </div>

          <div className="border-l border-white/10">
            <div className="flex items-center justify-center gap-1 text-white/70 text-[10px] font-black uppercase tracking-wider mb-0.5">
              <Clock className="size-3 text-[#7C5CFC]" /> Time
            </div>
            <span className="text-xs sm:text-sm font-black text-white">{formatDuration(duration)}</span>
          </div>

          <div className="border-l border-white/10">
            <div className="flex items-center justify-center gap-1 text-white/70 text-[10px] font-black uppercase tracking-wider mb-0.5">
              <Flame className="size-3 text-orange-400" /> Burn
            </div>
            <span className="text-xs sm:text-sm font-black text-white">{calories} kcal</span>
          </div>

          <div className="border-l border-white/10">
            <div className="flex items-center justify-center gap-1 text-white/70 text-[10px] font-black uppercase tracking-wider mb-0.5">
              <Footprints className="size-3 text-emerald-400" /> Steps
            </div>
            <span className="text-xs sm:text-sm font-black text-white">{steps.toLocaleString()}</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="relative z-10 mt-6 flex items-center justify-center gap-3">
          {status === "idle" && (
            <button
              type="button"
              onClick={handleStartClick}
              disabled={loading}
              className="tap flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-8 py-3.5 text-sm font-black text-white shadow-lg hover:bg-emerald-600 active:scale-95 transition-all w-full max-w-xs"
            >
              <Play className="size-4.5 fill-white" /> Start New Walk
            </button>
          )}

          {status === "active" && (
            <div className="flex items-center gap-2.5 w-full max-w-sm">
              <button
                type="button"
                onClick={handlePause}
                className="tap flex-1 flex items-center justify-center gap-1.5 rounded-2xl bg-amber-500 py-3.5 text-xs font-black text-white shadow-md hover:bg-amber-600 active:scale-95 transition-all"
              >
                <Pause className="size-4 fill-white" /> Pause
              </button>
              <button
                type="button"
                onClick={handleFinish}
                disabled={loading}
                className="tap flex-1 flex items-center justify-center gap-1.5 rounded-2xl bg-rose-500 py-3.5 text-xs font-black text-white shadow-md hover:bg-rose-600 active:scale-95 transition-all"
              >
                <Square className="size-4 fill-white" /> Finish Walk
              </button>
            </div>
          )}

          {status === "paused" && (
            <div className="flex items-center gap-2.5 w-full max-w-sm">
              <button
                type="button"
                onClick={handleResume}
                className="tap flex-1 flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-500 py-3.5 text-xs font-black text-white shadow-md hover:bg-emerald-600 active:scale-95 transition-all"
              >
                <Play className="size-4 fill-white" /> Resume
              </button>
              <button
                type="button"
                onClick={handleFinish}
                disabled={loading}
                className="tap flex-1 flex items-center justify-center gap-1.5 rounded-2xl bg-rose-500 py-3.5 text-xs font-black text-white shadow-md hover:bg-rose-600 active:scale-95 transition-all"
              >
                <Square className="size-4 fill-white" /> Finish
              </button>
            </div>
          )}
        </div>

        {/* Live Route Map Toggle during Active Walk */}
        {(status === "active" || status === "paused") && (
          <div className="relative z-10 mt-4 pt-3 border-t border-white/10 text-center">
            <button
              type="button"
              onClick={() => {
                sounds.playClick();
                setShowLiveMap(!showLiveMap);
              }}
              className="inline-flex items-center gap-1.5 text-xs font-black text-white/80 hover:text-white transition-colors"
            >
              <MapIcon className="size-3.5 text-cyan-400" />
              {showLiveMap ? "Hide Live GPS Map" : "Show Live GPS Route Trail"}
            </button>

            {showLiveMap && (
              <div className="mt-3 h-56 rounded-2xl overflow-hidden border border-white/20 shadow-md">
                <Suspense fallback={<div className="h-full bg-slate-900 animate-pulse" />}>
                  <RouteMap points={path || []} interactive />
                </Suspense>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════════
          WALKING STATISTICS & PERIOD SELECTOR
          ══════════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-base font-black text-[#12131A] flex items-center gap-2">
          <TrendingUp className="size-4.5 text-[#7C5CFC]" /> Walking Statistics
        </h2>

        {/* Period Selector */}
        <div className="flex rounded-full bg-black/5 p-1 text-[11px] font-black">
          {(["daily", "weekly", "monthly"] as const).map((period) => (
            <button
              key={period}
              type="button"
              onClick={() => {
                sounds.playNavClick();
                setStatsPeriod(period);
              }}
              className={cn(
                "px-3 py-1 rounded-full capitalize transition-all",
                statsPeriod === period ? "bg-white text-[#12131A] shadow-xs" : "text-muted-foreground",
              )}
            >
              {period}
            </button>
          ))}
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

      {/* Personal Records & Trend */}
      {user?.id && (
        <div className="mb-5">
          <Suspense fallback={<div className="h-40 bg-slate-100 rounded-xl animate-pulse" />}>
            <PersonalStats userId={user.id} walkSessions={walkSessions} />
          </Suspense>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          RECENT WALKS HISTORY
          ══════════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-base font-black text-[#12131A] flex items-center gap-2">
          <History className="size-4.5 text-[#7C5CFC]" /> Recent Walk Sessions
        </h2>
        <button
          type="button"
          onClick={() => {
            sounds.playClick();
            navigate({ to: "/walk/history" });
          }}
          className="text-xs font-black text-[#7C5CFC] hover:underline flex items-center gap-1"
        >
          View All ({totalFinishedWalks}) &rarr;
        </button>
      </div>

      <div className="space-y-2.5 mb-6">
        {walkHistory.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-center shadow-xs">
            <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <Footprints className="size-6" />
            </div>
            <p className="text-sm font-black text-[#12131A]">No walks completed yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tap "Start New Walk" above to begin tracking your route and pace!
            </p>
          </div>
        ) : (
          walkHistory.map((s) => {
            const hasRoute = s.path && s.path.length >= 2;
            const pace = formatPace(s.duration || 0, s.distance || 0);

            return (
              <button
                key={s.id}
                type="button"
                onClick={async () => {
                  sounds.playClick();
                  const summary = await getWalkSummary(s.id);
                  if (summary) {
                    setCompletedSummary(summary);
                  } else {
                    setCompletedSession(s);
                  }
                }}
                className="tap card-soft bg-white p-4 border border-black/5 shadow-xs hover:shadow-sm flex items-center justify-between w-full text-left transition-all rounded-2xl group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 shrink-0 border border-emerald-500/15">
                    <Footprints className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-black text-[#12131A] tracking-tight">
                        {formatKm(s.distance)} km Walk
                      </span>
                      {pace !== "--" && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black text-slate-700">
                          {pace}/km
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-semibold text-muted-foreground mt-0.5 truncate">
                      {new Date(s.finished_at || s.started_at).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      · {formatDuration(s.duration)} · {s.calories} kcal · {s.steps.toLocaleString()} steps
                      {s.vehicle && " · 🚗 Vehicle flagged"}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
                  <span className="text-[10px] font-black text-muted-foreground bg-slate-100 rounded-full px-2 py-0.5">
                    {new Date(s.finished_at || s.started_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black",
                      hasRoute
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200/50"
                        : "bg-slate-100 text-slate-400",
                    )}
                  >
                    <MapPin className="size-2.5" />
                    {hasRoute ? "Route Map" : "Steps only"}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Summary Modal for finished/selected walks */}
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

      {/* Background-location rationale */}
      {showBgLocationDialog &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-4 sm:items-center"
            onClick={() => {
              setShowBgLocationDialog(false);
              void continueStartSequence();
            }}
          >
            <div
              className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-base font-black text-[#12131A]">
                Keep tracking in background?
              </h3>
              <p className="mt-2 text-xs font-semibold leading-relaxed text-muted-foreground">
                Allow background location so your walk continues recording accurate distance and
                route trail while the phone is in your pocket or screen is locked.
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => {
                    setShowBgLocationDialog(false);
                    void continueStartSequence();
                  }}
                  className="flex-1 rounded-full bg-slate-100 px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-slate-200"
                >
                  Not now
                </button>
                <button
                  onClick={() => void acceptBgLocationDialog()}
                  className="flex-1 rounded-full bg-emerald-500 px-4 py-2.5 text-xs font-black text-white hover:bg-emerald-600"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Battery-optimization explainer */}
      {showBatteryDialog &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-4 sm:items-center"
            onClick={() => {
              setShowBatteryDialog(false);
              startWalk();
            }}
          >
            <div
              className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-base font-black text-[#12131A]">
                Keep steps &amp; distance counting?
              </h3>
              <p className="mt-2 text-xs font-semibold leading-relaxed text-muted-foreground">
                Android battery optimization can suspend step sensors mid-walk. Allow background
                activity so tracking remains continuous.
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => {
                    setShowBatteryDialog(false);
                    startWalk();
                  }}
                  className="flex-1 rounded-full bg-slate-100 px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-slate-200"
                >
                  Skip
                </button>
                <button
                  onClick={() => void acceptBatteryDialog()}
                  className="flex-1 rounded-full bg-emerald-500 px-4 py-2.5 text-xs font-black text-white hover:bg-emerald-600"
                >
                  Allow background
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </Screen>
  );
}
