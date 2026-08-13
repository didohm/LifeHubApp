import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Camera,
  Image as ImageIcon,
  Loader2,
  TrendingUp,
  TrendingDown,
  Share2,
  Check,
  Edit2,
  Flame,
  Footprints,
  Clock,
  Gauge,
  MapPin,
  Sparkles,
  Car,
} from "lucide-react";
import { toast } from "sonner";
import { registerOverlay } from "@/lib/overlay-registry";
import type { WalkSummary, WalkSplit, WalkSession } from "@/lib/types";
import { getWalkSplits } from "@/lib/walk-storage";
import { uploadWalkPhoto } from "@/lib/cloudinary";
import {
  formatPace,
  formatDuration,
  formatDistance,
  computeWalkStats,
  decodePolyline,
  type GPSPoint,
} from "@/lib/walk-gps-utils";
import RouteMap, { type RoutePoint } from "@/components/lifehub/RouteMap";
import { Capacitor } from "@capacitor/core";
import { Camera as CapCamera, CameraResultType, CameraSource } from "@capacitor/camera";

interface EnhancedWalkSummaryProps {
  summary?: WalkSummary | null;
  session?: WalkSession | null;
  onClose: () => void;
  onPhotosAdded?: (urls: string[]) => void;
}

/**
 * Returns a friendly Strava-like default title based on time of day
 */
function getDefaultWalkTitle(dateStr: string): string {
  const d = new Date(dateStr);
  const hour = d.getHours();
  if (hour >= 5 && hour < 12) return "Morning Walk 🌅";
  if (hour >= 12 && hour < 17) return "Afternoon Walk ☀️";
  if (hour >= 17 && hour < 21) return "Evening Walk 🌇";
  return "Night Walk 🌙";
}

/**
 * Strava-Style Post-Walk Activity Modal
 *
 * Provides a rich, beautiful post-activity breakdown:
 * - High-contrast Strava route map with start/finish pins & km badges
 * - Big hero metrics (Distance, Pace, Time)
 * - Secondary metrics (Calories, Steps, Avg Speed, Elevation)
 * - Strava-style kilometer splits with pace comparison bar chart
 * - Photo attachments and social sharing
 */
export default function EnhancedWalkSummary({
  summary,
  session,
  onClose,
  onPhotosAdded,
}: EnhancedWalkSummaryProps) {
  // Normalize metrics from either WalkSummary or WalkSession
  const rawDistance = summary?.distance ?? session?.distance ?? 0;
  const rawDuration = summary?.duration ?? session?.duration ?? 0;
  const rawCalories = Math.round(summary?.calories ?? session?.calories ?? 0);
  const rawSteps = summary?.steps ?? session?.steps ?? 0;
  const rawStartedAt = summary?.started_at || session?.started_at || session?.created_at || new Date().toISOString();
  const rawFinishedAt = summary?.finished_at || session?.finished_at || new Date().toISOString();
  const isVehicle = summary?.vehicle_flagged ?? session?.vehicle ?? false;

  const [walkTitle, setWalkTitle] = useState(() => getDefaultWalkTitle(rawStartedAt));
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [splits, setSplits] = useState<WalkSplit[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>(summary?.photo_urls || []);
  const [uploading, setUploading] = useState(false);
  const [loadingSplits, setLoadingSplits] = useState(true);
  const [copiedShare, setCopiedShare] = useState(false);

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
    return (rawDistance / 1000) / (rawDuration / 3600);
  }, [rawDistance, rawDuration]);

  const elevationGain = summary?.elevation_gain;
  const elevationLoss = summary?.elevation_loss;
  const hasElevation = (elevationGain != null && elevationGain > 0) || (elevationLoss != null && elevationLoss > 0);

  useEffect(() => {
    registerOverlay();
    loadSplits();
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
          }))
        );
      }
    }
    setLoadingSplits(false);
  }

  async function handlePhotoCapture() {
    if (!Capacitor.isNativePlatform()) {
      handleGallerySelect();
      return;
    }

    try {
      const photo = await CapCamera.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera,
      });

      if (photo.path) {
        await uploadPhotoFromUri(photo.path);
      }
    } catch (error) {
      console.error("Camera capture failed:", error);
    }
  }

  async function handleGallerySelect() {
    if (!Capacitor.isNativePlatform()) {
      // Web file input
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) await uploadPhotoFile(file);
      };
      input.click();
      return;
    }

    try {
      const photo = await CapCamera.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Photos,
      });

      if (photo.path) {
        await uploadPhotoFromUri(photo.path);
      }
    } catch (error) {
      console.error("Gallery selection failed:", error);
    }
  }

  async function uploadPhotoFromUri(uri: string) {
    setUploading(true);
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const file = new File([blob], "walk-photo.jpg", { type: "image/jpeg" });
      await uploadPhotoFile(file);
    } catch (error) {
      console.error("Photo upload failed:", error);
      toast.error("Failed to upload photo");
    } finally {
      setUploading(false);
    }
  }

  async function uploadPhotoFile(file: File) {
    setUploading(true);
    try {
      const result = await uploadWalkPhoto(file);
      const newUrls = [...photoUrls, result.secure_url];
      setPhotoUrls(newUrls);
      onPhotosAdded?.(newUrls);
      toast.success("Photo added to walk!");
    } catch (error) {
      console.error("Photo upload failed:", error);
      toast.error("Failed to upload photo");
    } finally {
      setUploading(false);
    }
  }

  // Generate Strava-like share text
  const handleShare = async () => {
    const formattedDist = (rawDistance / 1000).toFixed(2);
    const paceText = avgPaceSec ? `${formatPace(avgPaceSec)}/km` : "--";
    const durationText = formatDuration(rawDuration);
    const shareText = `🏃 ${walkTitle}\n📏 Distance: ${formattedDist} km\n⏱️ Time: ${durationText}\n⚡ Avg Pace: ${paceText}\n🔥 Calories: ${rawCalories} kcal\n👟 Steps: ${rawSteps.toLocaleString()}\n\nTracked with LifeHub`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: walkTitle,
          text: shareText,
        });
        return;
      } catch (err) {
        // Fallback to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(shareText);
      setCopiedShare(true);
      toast.success("Walk summary copied to clipboard!");
      setTimeout(() => setCopiedShare(false), 2500);
    } catch (e) {
      toast.info(shareText);
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
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FC5200]/20 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#FC5200] border border-[#FC5200]/30">
              <Sparkles className="size-3 fill-[#FC5200]" /> Strava Activity
            </span>
            {isVehicle && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-black text-amber-400 border border-amber-500/30">
                <Car className="size-3" /> Vehicle
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleShare}
              className="flex size-8 items-center justify-center rounded-full bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-all active:scale-95"
              title="Share walk"
              aria-label="Share walk summary"
            >
              {copiedShare ? <Check className="size-4 text-emerald-400" /> : <Share2 className="size-4" />}
            </button>
            <button
              onClick={onClose}
              className="flex size-8 items-center justify-center rounded-full bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-all active:scale-95 ml-1"
              aria-label="Close modal"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain space-y-4 p-5">
          {/* Activity Title & Time */}
          <div>
            <div className="flex items-center gap-2 group">
              {isEditingTitle ? (
                <input
                  type="text"
                  value={walkTitle}
                  onChange={(e) => setWalkTitle(e.target.value)}
                  onBlur={() => setIsEditingTitle(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setIsEditingTitle(false);
                  }}
                  autoFocus
                  className="bg-slate-800 border border-[#FC5200] rounded-lg px-2.5 py-1 text-xl font-black text-white w-full outline-hidden"
                />
              ) : (
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => setIsEditingTitle(true)}>
                  <h2 className="text-2xl font-black tracking-tight text-white">{walkTitle}</h2>
                  <Edit2 className="size-4 text-slate-500 group-hover:text-[#FC5200] transition-colors" />
                </div>
              )}
            </div>

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

          {/* Strava Route Map */}
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

          {/* Strava Core 3-Hero Stats Bar */}
          <div className="grid grid-cols-3 divide-x divide-slate-800 rounded-2xl bg-slate-900 border border-slate-800 shadow-md">
            {/* Distance */}
            <div className="p-3.5 text-center">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Distance</p>
              <div className="mt-1 flex items-baseline justify-center gap-0.5">
                <span className="text-2xl font-black tracking-tight text-white tabular-nums">
                  {(rawDistance / 1000).toFixed(2)}
                </span>
                <span className="text-xs font-bold text-slate-400">km</span>
              </div>
            </div>

            {/* Avg Pace */}
            <div className="p-3.5 text-center">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Avg Pace</p>
              <div className="mt-1 flex items-baseline justify-center gap-0.5">
                <span className="text-2xl font-black tracking-tight text-[#FC5200] tabular-nums">
                  {avgPaceSec ? formatPace(avgPaceSec) : "--:--"}
                </span>
                <span className="text-xs font-bold text-slate-400">/km</span>
              </div>
            </div>

            {/* Time */}
            <div className="p-3.5 text-center">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Moving Time</p>
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
                <p className="text-[10px] font-bold uppercase text-slate-400">Calories</p>
                <p className="text-sm font-black text-white tabular-nums">{rawCalories} kcal</p>
              </div>
            </div>

            {/* Steps */}
            <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-3 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                <Footprints className="size-4.5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-400">Steps</p>
                <p className="text-sm font-black text-white tabular-nums">{rawSteps.toLocaleString()}</p>
              </div>
            </div>

            {/* Avg Speed */}
            <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-3 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
                <Gauge className="size-4.5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-400">Avg Speed</p>
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
                <p className="text-[10px] font-bold uppercase text-slate-400">Elevation</p>
                <p className="text-sm font-black text-white tabular-nums">
                  {elevationGain ? `+${Math.round(elevationGain)}m` : "--"}
                </p>
              </div>
            </div>
          </div>

          {/* Strava Kilometer Splits Breakdown */}
          {!loadingSplits && splits.length > 0 && (
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-[#FC5200]" /> Kilometer Splits
                </h3>
                <span className="text-[10px] font-bold text-slate-400">Pace vs Avg</span>
              </div>

              <div className="space-y-2">
                {splits.map((split) => {
                  const splitPace = split.pace;
                  const isFaster = avgPaceSec ? splitPace < avgPaceSec : false;
                  // Compute bar percentage (clamped between 30% and 100%)
                  const maxPace = Math.max(...splits.map((s) => s.pace), avgPaceSec || 0, 1);
                  const minPace = Math.min(...splits.map((s) => s.pace), avgPaceSec || 0);
                  const relativeDiff = avgPaceSec ? (splitPace - avgPaceSec) / avgPaceSec : 0;
                  const barWidthPct = Math.min(Math.max(100 - relativeDiff * 50, 25), 100);

                  return (
                    <div
                      key={split.split_number}
                      className="flex items-center justify-between gap-3 text-xs py-1.5 px-2 rounded-lg bg-slate-800/60"
                    >
                      <span className="w-8 font-black text-white tabular-nums">KM {split.split_number}</span>

                      {/* Visual Pace Bar (Strava style) */}
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

          {/* Photo Attachments */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Camera className="size-3.5 text-[#FC5200]" /> Photos
              </h3>
              {photoUrls.length > 0 && (
                <span className="text-[11px] font-bold text-slate-400">
                  {photoUrls.length} {photoUrls.length === 1 ? "photo" : "photos"}
                </span>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={handlePhotoCapture}
                disabled={uploading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                <Camera className="size-4 text-emerald-400" />
                Camera
              </button>
              <button
                onClick={handleGallerySelect}
                disabled={uploading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                <ImageIcon className="size-4 text-cyan-400" />
                Gallery
              </button>
            </div>

            {uploading && (
              <div className="mt-3 flex items-center justify-center gap-2 text-xs font-bold text-[#FC5200]">
                <Loader2 className="size-4 animate-spin" />
                Uploading photo…
              </div>
            )}

            {photoUrls.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {photoUrls.map((url, idx) => (
                  <img
                    key={idx}
                    src={url}
                    alt={`Walk photo ${idx + 1}`}
                    className="aspect-square w-full rounded-xl object-cover border border-slate-700 shadow-sm"
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Done Bar */}
        <div className="p-4 bg-slate-900 border-t border-slate-800 shrink-0">
          <button
            onClick={onClose}
            className="w-full py-3.5 rounded-xl text-sm font-black text-white bg-gradient-to-r from-[#FC5200] to-[#FF7A00] hover:brightness-110 shadow-lg shadow-[#FC5200]/25 active:scale-[0.99] transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
