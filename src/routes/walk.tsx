import { useState, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Play,
  Pause,
  Square,
  Footprints,
  Clock,
  Flame,
  Compass,
  MapPin,
  TrendingUp,
  History,
  Navigation,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { useAuth } from "@/hooks/use-auth";
import { useData } from "@/lib/data-context";
import { useWalk } from "@/hooks/use-walk";
import { todayLocalDate } from "@/lib/api";
import { sounds } from "@/lib/sound";
import { PermissionManager } from "@/lib/permissions";
import { WalkSession } from "@/lib/types";

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

function WalkPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { walkSessions, refreshFitness } = useData();

  const [statsPeriod, setStatsPeriod] = useState<"daily" | "weekly" | "monthly">("daily");

  const {
    status,
    isAutoPaused,
    duration,
    distance,
    calories,
    steps,
    gpsAvailable,
    loading,
    startWalk,
    pauseWalk,
    resumeWalk,
    finishWalk,
  } = useWalk(user?.id, user?.weight ? Number(user.weight) : 70);

  const handleFinish = async () => {
    const result = await finishWalk();
    if (result) {
      sounds.playSuccess();
      toast.success(
        `Walk finished! 🚶 ${formatKm(result.distance)} km · ${formatDuration(
          result.duration,
        )} · ${result.calories} kcal`,
      );
      await refreshFitness();
    }
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

    const filtered = walkSessions.filter(
      (s) => s.status === "finished" && !!s.day && s.day >= periodStart && s.day <= todayStr,
    );

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

  // Today's walk history list — every finished session from the local day,
  // in chronological order (oldest first).
  const todayHistory = useMemo(() => {
    const todayStr = todayLocalDate();
    return walkSessions
      .filter((s) => s.status === "finished" && s.day === todayStr)
      .sort((a, b) => (a.started_at || a.created_at).localeCompare(b.started_at || b.created_at));
  }, [walkSessions]);

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

          <span className="text-[11px] font-semibold text-white/60 flex items-center gap-1">
            <Compass className="size-3.5" />
            {gpsAvailable === true
              ? "Real GPS Location"
              : gpsAvailable === false
                ? "Sensor Estimate"
                : "GPS Ready"}
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
                // Feature-time permissions: if denied earlier, ask again now
                // that the user is actually using the walking feature.
                await PermissionManager.ensurePermission("location");
                await PermissionManager.ensurePermission("activity");
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

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="card-soft bg-white p-4 border border-black/5 shadow-xs">
          <span className="text-xs font-extrabold text-[#6B7280]">Total Distance</span>
          <p className="mt-1 text-2xl font-black text-[#12131A]">
            {formatKm(stats.totalDistance)} <span className="text-xs font-bold">km</span>
          </p>
          <span className="text-[10px] text-[#6B7280] font-semibold mt-1 block">
            {stats.count} walk session{stats.count === 1 ? "" : "s"}
          </span>
        </div>

        <div className="card-soft bg-white p-4 border border-black/5 shadow-xs">
          <span className="text-xs font-extrabold text-[#6B7280]">Calories Burned</span>
          <p className="mt-1 text-2xl font-black text-orange-600">
            {stats.totalCalories} <span className="text-xs font-bold">kcal</span>
          </p>
          <span className="text-[10px] text-[#6B7280] font-semibold mt-1 block">
            {stats.count} walk session{stats.count === 1 ? "" : "s"} total
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="card-soft bg-white p-4 border border-black/5 shadow-xs">
          <span className="text-xs font-extrabold text-[#6B7280]">Total Duration</span>
          <p className="mt-1 text-2xl font-black text-[#12131A]">
            {formatDuration(stats.totalDuration)}
          </p>
          <span className="text-[10px] text-[#6B7280] font-semibold mt-1 block">
            across all sessions
          </span>
        </div>

        <div className="card-soft bg-white p-4 border border-black/5 shadow-xs">
          <span className="text-xs font-extrabold text-[#6B7280]">Total Steps</span>
          <p className="mt-1 text-2xl font-black text-emerald-600">
            {stats.totalSteps.toLocaleString()} <span className="text-xs font-bold">steps</span>
          </p>
          <span className="text-[10px] text-[#6B7280] font-semibold mt-1 block">
            combined from all walks
          </span>
        </div>
      </div>

      {/* Daily Walking History */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-extrabold text-[#12131A] flex items-center gap-2">
          <History className="size-4.5 text-[#7C5CFC]" /> Today's Walking History
        </h2>
        <span className="text-xs font-bold text-[#6B7280]">{todayHistory.length} Walks</span>
      </div>

      <div className="space-y-2">
        {todayHistory.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200/60 p-6 text-center bg-white">
            <Footprints className="mx-auto size-10 text-black/20" />
            <p className="mt-2 text-xs font-bold text-[#12131A]">No walks logged today yet</p>
            <p className="text-[11px] text-[#6B7280]">Tap "Start Walk" above to begin tracking!</p>
          </div>
        ) : (
          todayHistory.map((s) => (
            <div
              key={s.id}
              className="card-soft bg-white p-3.5 border border-black/5 shadow-xs flex items-center justify-between"
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
                    {formatDuration(s.duration)} · {s.calories} kcal · {s.steps} steps
                  </p>
                </div>
              </div>

              <span className="text-[10px] font-bold text-[#6B7280] bg-black/5 rounded-full px-2.5 py-1">
                {new Date(s.finished_at || s.started_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))
        )}
      </div>
    </Screen>
  );
}
