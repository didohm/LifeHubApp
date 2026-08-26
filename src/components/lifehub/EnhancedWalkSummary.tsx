import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  X,
  TrendingUp,
  Flame,
  Footprints,
  Gauge,
  Car,
  Activity,
  Download,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { registerOverlay } from "@/lib/overlay-registry";
import type { WalkSummary, WalkSplit, WalkSession } from "@/lib/types";
import { getWalkSplits } from "@/lib/walk-storage";
import { renderActivityCard } from "@/lib/activity-card";
import { savePngToGallery } from "@/lib/gallery";
import { WalkServicePlugin } from "@/lib/notifications-integration";
import {
  formatPace,
  formatDuration,
  computeWalkStats,
  decodePolyline,
  type GPSPoint,
} from "@/lib/walk-gps-utils";
import RouteMap, { type RoutePoint } from "@/components/lifehub/RouteMap";

interface EnhancedWalkSummaryProps {
  summary?: WalkSummary | null;
  session?: WalkSession | null;
  onClose: () => void;
}

/**
 * Post-Walk Activity Modal
 *
 * Provides a rich, beautiful post-activity breakdown:
 * - High-contrast route map with start/finish pins & km badges
 * - Big hero metrics (Distance, Pace, Time)
 * - Secondary metrics (Calories, Steps, Avg Speed, Elevation)
 * - Kilometer splits with pace comparison bar chart
 */
export default function EnhancedWalkSummary({
  summary,
  session,
  onClose,
}: EnhancedWalkSummaryProps) {
  // Normalize metrics from either WalkSummary or WalkSession
  const rawDistance = summary?.distance ?? session?.distance ?? 0;
  const rawDuration = summary?.duration ?? session?.duration ?? 0;
  const rawCalories = Math.round(summary?.calories ?? session?.calories ?? 0);
  const rawSteps = summary?.steps ?? session?.steps ?? 0;
  const rawStartedAt =
    summary?.started_at || session?.started_at || session?.created_at || new Date().toISOString();
  const rawFinishedAt = summary?.finished_at || session?.finished_at || new Date().toISOString();
  const isVehicle = summary?.vehicle_flagged ?? session?.vehicle ?? false;

  const [splits, setSplits] = useState<WalkSplit[]>([]);
  const [loadingSplits, setLoadingSplits] = useState(true);
  const [downloading, setDownloading] = useState(false);

  // Extract route points from all possible formats
  const routePoints = useMemo<RoutePoint[]>(() => {
    if (summary?.encoded_polyline) {
      const decoded = decodePolyline(summary.encoded_polyline);
      if (decoded.length > 0) return decoded;
    }
    if (session?.path && Array.isArray(session.path) && session.path.length > 0) {
      return session.path;
    }
    if (summary?.start_lat != null && summary?.start_lng != null) {
      const pts: RoutePoint[] = [{ lat: summary.start_lat, lng: summary.start_lng }];
      if (summary.end_lat != null && summary.end_lng != null) {
        pts.push({ lat: summary.end_lat, lng: summary.end_lng });
      }
      return pts;
    }
    return [];
  }, [summary, session]);

  // Pace calculations
  const avgPaceSec = useMemo(() => {
    if (summary?.avg_pace) return summary.avg_pace;
    if (rawDistance > 0 && rawDuration > 0) {
      return rawDuration / (rawDistance / 1000);
    }
    return null;
  }, [summary, rawDistance, rawDuration]);

  const avgSpeedKmH = useMemo(() => {
    if (rawDuration <= 0 || rawDistance <= 0) return null;
    return rawDistance / 1000 / (rawDuration / 3600);
  }, [rawDistance, rawDuration]);

  const elevationGain = summary?.elevation_gain;

  useEffect(() => {
    // Keep the bottom navigation hidden only while this summary is mounted.
    // Returning the cleanup is essential: otherwise the global overlay count
    // stays positive after the summary closes and the nav never comes back.
    const unregisterOverlay = registerOverlay();
    loadSplits();
    return unregisterOverlay;
  }, [summary?.id, session?.id]);

  async function loadSplits() {
    setLoadingSplits(true);
    const sessionId = summary?.id || session?.id;
    if (sessionId) {
      try {
        const data = await getWalkSplits(sessionId);
        if (data && data.length > 0) {
          setSplits(data);
          setLoadingSplits(false);
          return;
        }
      } catch (error) {
        // Fallback to dynamic computation
      }
    }

    // Dynamic computation of splits if route points exist and distance >= 1000m
    if (routePoints.length >= 2 && rawDuration > 0) {
      const gpsPoints: GPSPoint[] = routePoints.map((p) => ({
        lat: p.lat,
        lng: p.lng,
        ts: p.ts || Date.now(),
      }));
      const computed = computeWalkStats(gpsPoints, rawDuration);
      if (computed.splits && computed.splits.length > 0) {
        setSplits(
          computed.splits.map((s) => ({
            session_id: sessionId || "temp",
            split_number: s.splitNumber,
            distance: s.distance,
            duration: s.duration,
            pace: s.pace,
            elevation_change: s.elevationChange,
          })),
        );
      }
    }
    setLoadingSplits(false);
  }

  // Render the activity card (1080×1920 PNG) and save it to the device
  // Gallery. Reuses the exact metrics shown in this modal — no new
  // statistics, no second calculation system.
  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      // Route trail: prefer the native SQLite route points when available,
      // then the persisted encoded polyline (itself derived from those GPS
      // points), then start/end coordinates. Falls back to a placeholder.
      let cardPoints = routePoints;
      const sessionId = summary?.id || session?.id;
      if (Capacitor.isNativePlatform() && sessionId) {
        try {
          const route = await WalkServicePlugin.getRoutePoints({ sessionId });
          const parsed = route?.points ? JSON.parse(route.points) : [];
          if (Array.isArray(parsed) && parsed.length >= 2) {
            cardPoints = parsed;
          }
        } catch {
          /* fall back to the summary route below */
        }
      }

      const blob = await renderActivityCard({
        dateLabel: new Date(rawFinishedAt).toLocaleString([], {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        distanceMeters: rawDistance,
        durationSeconds: rawDuration,
        paceSecondsPerKm: avgPaceSec,
        calories: rawCalories,
        steps: rawSteps,
        avgSpeedKmH,
        elevationGain: elevationGain ?? null,
        routePoints: cardPoints,
        logoSrc: "/illustration/LifeHub icon.webp",
      });

      const fileName = `lifehub-activity-${sessionId || "walk"}.png`;
      const location = await savePngToGallery(blob, fileName);
      toast.success(`Activity image saved to ${location}`);
    } catch (error) {
      console.error("Failed to save activity image:", error);
      const message = error instanceof Error && error.message ? error.message : "";
      toast.error(
        message
          ? `Could not save the image — ${message}`
          : "Could not save the image — please try again.",
      );
    } finally {
      setDownloading(false);
    }
  };

  const modal = (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 backdrop-blur-md p-0 sm:items-center sm:p-4 overflow-hidden"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg min-h-0 max-h-[92vh] flex flex-col rounded-t-[28px] sm:rounded-3xl bg-[#0F172A] text-slate-100 shadow-2xl border border-slate-800 animate-in fade-in slide-in-from-bottom-4 duration-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FC5200]/20 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider text-[#FC5200] border border-[#FC5200]/30">
              <Activity className="size-3" /> LifeHub Activity
            </span>
            {isVehicle && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-black text-amber-400 border border-amber-500/30">
                <Car className="size-3" /> Vehicle
              </span>
            )}
          </div>

          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-all active:scale-95"
            aria-label="Close modal"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain space-y-4 p-5">
          {/* Cancelled / too-short walk banner — Finish always yields visible
              feedback, so a stray session explains itself instead of looking
              like the button did nothing. */}
          {session?.status === "cancelled" && (
            <div className="flex items-center gap-2 rounded-2xl bg-amber-500/15 border border-amber-500/30 px-4 py-3">
              <Footprints className="size-4 shrink-0 text-amber-400" />
              <p className="text-xs font-bold text-amber-300">
                Walk too short to record — tap Start New Walk to begin again.
              </p>
            </div>
          )}

          {/* Activity Title & Time */}
          <div>
            <h2 className="text-2xl font-black tracking-tight text-white">Your Progress</h2>

            <p className="mt-1 text-xs font-semibold text-slate-400">
              {new Date(rawFinishedAt).toLocaleString([], {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>

          {/* Route Map */}
          <div className="rounded-2xl overflow-hidden border border-slate-700/80 shadow-lg">
            <RouteMap
              points={routePoints}
              encodedPolyline={summary?.encoded_polyline || undefined}
              startLat={summary?.start_lat}
              startLng={summary?.start_lng}
              endLat={summary?.end_lat}
              endLng={summary?.end_lng}
              height={280}
              interactive={true}
              showMarkers={true}
              showKmMarkers={true}
              showStatsOverlay={true}
              distanceMeters={rawDistance}
              durationSeconds={rawDuration}
              paceSecondsPerKm={avgPaceSec}
              allowFullscreen={true}
              allowLayerToggle={true}
            />
          </div>

          {/* Core 3-Hero Stats Bar */}
          <div className="grid grid-cols-3 divide-x divide-slate-800 rounded-2xl bg-slate-900 border border-slate-800 shadow-md">
            {/* Distance */}
            <div className="p-3.5 text-center">
              <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                Distance
              </p>
              <div className="mt-1 flex items-baseline justify-center gap-0.5">
                <span className="text-2xl font-black tracking-tight text-white tabular-nums">
                  {(rawDistance / 1000).toFixed(2)}
                </span>
                <span className="text-xs font-bold text-slate-400">km</span>
              </div>
            </div>

            {/* Avg Pace */}
            <div className="p-3.5 text-center">
              <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                Avg Pace
              </p>
              <div className="mt-1 flex items-baseline justify-center gap-0.5">
                <span className="text-2xl font-black tracking-tight text-[#FC5200] tabular-nums">
                  {avgPaceSec ? formatPace(avgPaceSec) : "--:--"}
                </span>
                <span className="text-xs font-bold text-slate-400">/km</span>
              </div>
            </div>

            {/* Time */}
            <div className="p-3.5 text-center">
              <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                Moving Time
              </p>
              <div className="mt-1">
                <span className="text-2xl font-black tracking-tight text-white tabular-nums">
                  {formatDuration(rawDuration)}
                </span>
              </div>
            </div>
          </div>

          {/* Secondary Metric Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {/* Calories */}
            <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-3 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-orange-500/10 text-orange-400">
                <Flame className="size-4.5" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase text-slate-400">Calories</p>
                <p className="text-sm font-black text-white tabular-nums">{rawCalories} kcal</p>
              </div>
            </div>

            {/* Steps */}
            <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-3 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                <Footprints className="size-4.5" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase text-slate-400">Steps</p>
                <p className="text-sm font-black text-white tabular-nums">
                  {rawSteps.toLocaleString()}
                </p>
              </div>
            </div>

            {/* Avg Speed */}
            <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-3 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
                <Gauge className="size-4.5" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase text-slate-400">Avg Speed</p>
                <p className="text-sm font-black text-white tabular-nums">
                  {avgSpeedKmH ? `${avgSpeedKmH.toFixed(1)} km/h` : "--"}
                </p>
              </div>
            </div>

            {/* Elevation */}
            <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-3 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
                <TrendingUp className="size-4.5" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase text-slate-400">Elevation</p>
                <p className="text-sm font-black text-white tabular-nums">
                  {elevationGain ? `+${Math.round(elevationGain)}m` : "--"}
                </p>
              </div>
            </div>
          </div>

          {/* Kilometer Splits Breakdown */}
          {!loadingSplits && splits.length > 0 && (
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-[#FC5200]" /> Kilometer Splits
                </h3>
                <span className="text-[11px] font-bold text-slate-400">Pace vs Avg</span>
              </div>

              <div className="space-y-2">
                {splits.map((split) => {
                  const splitPace = split.pace;
                  const isFaster = avgPaceSec ? splitPace < avgPaceSec : false;
                  // Compute bar percentage (clamped between 25% and 100%)
                  const relativeDiff = avgPaceSec ? (splitPace - avgPaceSec) / avgPaceSec : 0;
                  const barWidthPct = Math.min(Math.max(100 - relativeDiff * 50, 25), 100);

                  return (
                    <div
                      key={split.split_number}
                      className="flex items-center justify-between gap-3 text-xs py-1.5 px-2 rounded-lg bg-slate-800/60"
                    >
                      <span className="w-8 font-black text-white tabular-nums">
                        KM {split.split_number}
                      </span>

                      {/* Visual Pace Bar */}
                      <div className="flex-1 h-3 bg-slate-950 rounded-full overflow-hidden p-0.5 flex items-center">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isFaster ? "bg-emerald-500" : "bg-[#FC5200]"
                          }`}
                          style={{ width: `${barWidthPct}%` }}
                        />
                      </div>

                      <div className="flex items-center gap-3 text-right">
                        <span className="font-bold text-slate-300 tabular-nums">
                          {formatDuration(split.duration)}
                        </span>
                        <span
                          className={`font-black tabular-nums w-14 ${
                            isFaster ? "text-emerald-400" : "text-slate-200"
                          }`}
                        >
                          {formatPace(split.pace)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Action Bar */}
        <div className="p-4 bg-slate-900 border-t border-slate-800 shrink-0 flex gap-3">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex-1 py-3.5 rounded-xl text-sm font-black text-white bg-slate-800 border border-slate-700 hover:bg-slate-700 disabled:opacity-60 disabled:pointer-events-none flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
          >
            {downloading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {downloading ? "Saving…" : "Download Activity"}
          </button>
          <button
            onClick={onClose}
            className="flex-[1.4] py-3.5 rounded-xl text-sm font-black text-white bg-gradient-to-r from-[#FC5200] to-[#FF7A00] hover:brightness-110 shadow-lg shadow-[#FC5200]/25 active:scale-[0.99] transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
