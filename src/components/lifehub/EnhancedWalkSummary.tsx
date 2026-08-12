import { useState, useEffect, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { X, Camera, Image as ImageIcon, Upload, Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { registerOverlay } from "@/lib/overlay-registry";
import type { WalkSummary, WalkSplit } from "@/lib/types";
import { getWalkSplits } from "@/lib/walk-storage";
import { uploadWalkPhoto } from "@/lib/cloudinary";
import { formatPace, formatDuration, formatDistance } from "@/lib/walk-gps-utils";
import { Capacitor } from "@capacitor/core";
import { Camera as CapCamera, CameraResultType, CameraSource } from "@capacitor/camera";

const RouteMapGL = lazy(() => import("@/components/lifehub/RouteMapGL"));

interface EnhancedWalkSummaryProps {
  summary: WalkSummary;
  onClose: () => void;
  onPhotosAdded?: (urls: string[]) => void;
}

/**
 * Enhanced post-walk summary with splits, elevation, and photo attachment.
 * Strava-like but purely personal—no social features.
 */
export default function EnhancedWalkSummary({
  summary,
  onClose,
  onPhotosAdded,
}: EnhancedWalkSummaryProps) {
  const [splits, setSplits] = useState<WalkSplit[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>(summary.photo_urls || []);
  const [uploading, setUploading] = useState(false);
  const [loadingSplits, setLoadingSplits] = useState(true);

  const hasRoute = !!summary.encoded_polyline || (summary.start_lat && summary.start_lng);
  const hasElevation = summary.elevation_gain != null || summary.elevation_loss != null;
  const avgSpeed = summary.avg_pace ? (3600 / summary.avg_pace) : null; // km/h

  useEffect(() => {
    registerOverlay();
    loadSplits();
  }, []);

  async function loadSplits() {
    setLoadingSplits(true);
    try {
      const data = await getWalkSplits(summary.id);
      setSplits(data);
    } catch (error) {
      console.error("Failed to load splits:", error);
    } finally {
      setLoadingSplits(false);
    }
  }

  async function handlePhotoCapture() {
    if (!Capacitor.isNativePlatform()) {
      alert("Camera is only available on mobile devices");
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
      // Web fallback
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
      // Convert URI to File (simplified—adjust for actual Capacitor file handling)
      const response = await fetch(uri);
      const blob = await response.blob();
      const file = new File([blob], "walk-photo.jpg", { type: "image/jpeg" });
      await uploadPhotoFile(file);
    } catch (error) {
      console.error("Photo upload failed:", error);
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
    } catch (error) {
      console.error("Photo upload failed:", error);
    } finally {
      setUploading(false);
    }
  }

  const modal = (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto overscroll-contain rounded-t-3xl sm:rounded-3xl bg-[#F8FAFC] shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with gradient */}
        <div className="bg-gradient-to-br from-[#0A0E27] via-[#1a1d3a] to-[#2d3154] px-6 pt-6 pb-5 text-white relative">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 transition-colors"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
          
          <div className="flex items-center gap-2 text-[#22C55E]">
            <div className="size-1.5 rounded-full bg-[#22C55E] animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-[0.15em]">Walk Complete</span>
          </div>
          
          <div className="mt-3 flex items-end gap-2">
            <span className="text-6xl font-black tracking-tighter tabular-nums">
              {(summary.distance / 1000).toFixed(2)}
            </span>
            <span className="pb-2 text-lg font-bold text-white/50">km</span>
          </div>
          
          <p className="mt-1.5 text-[11px] font-semibold text-white/40">
            {new Date(summary.finished_at || summary.started_at).toLocaleString([], {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>

        {/* Core metrics grid */}
        <div className="grid grid-cols-3 divide-x divide-slate-200 border-b border-slate-200 bg-white">
          <div className="px-3 py-4 text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-[#64748B]">Time</p>
            <p className="mt-1 text-lg font-black tabular-nums text-[#0A0E27]">
              {formatDuration(summary.duration)}
            </p>
          </div>
          <div className="px-3 py-4 text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-[#64748B]">Pace</p>
            <p className="mt-1 text-lg font-black tabular-nums text-[#0A0E27]">
              {summary.avg_pace ? formatPace(summary.avg_pace) : "--:--"}
            </p>
          </div>
          <div className="px-3 py-4 text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-[#64748B]">Steps</p>
            <p className="mt-1 text-lg font-black tabular-nums text-[#0A0E27]">
              {summary.steps.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Secondary metrics */}
        <div className="flex items-center justify-between px-6 py-3.5 bg-slate-50/70 border-b border-slate-200">
          <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-[#64748B]">Calories</span>
              <span className="font-black tabular-nums text-[#F97316]">
                {Math.round(summary.calories)}
              </span>
            </div>
            {avgSpeed && (
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-[#64748B]">Speed</span>
                <span className="font-black tabular-nums text-[#0A0E27]">
                  {avgSpeed.toFixed(1)} km/h
                </span>
              </div>
            )}
          </div>
          {summary.vehicle_flagged && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-black text-amber-800">
              Vehicle
            </span>
          )}
        </div>

        {/* Elevation (if available) */}
        {hasElevation && (
          <div className="grid grid-cols-2 gap-3 px-6 py-3 bg-white border-b border-slate-200">
            {summary.elevation_gain != null && summary.elevation_gain > 0 && (
              <div className="flex items-center gap-2">
                <TrendingUp className="size-4 text-[#22C55E]" />
                <div>
                  <p className="text-xs font-bold text-[#64748B]">Elevation Gain</p>
                  <p className="text-sm font-black tabular-nums text-[#0A0E27]">
                    {summary.elevation_gain.toFixed(0)}m
                  </p>
                </div>
              </div>
            )}
            {summary.elevation_loss != null && summary.elevation_loss > 0 && (
              <div className="flex items-center gap-2">
                <TrendingDown className="size-4 text-[#F97316]" />
                <div>
                  <p className="text-xs font-bold text-[#64748B]">Elevation Loss</p>
                  <p className="text-sm font-black tabular-nums text-[#0A0E27]">
                    {summary.elevation_loss.toFixed(0)}m
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Splits table */}
        {!loadingSplits && splits.length > 0 && (
          <div className="px-6 py-4 bg-white border-b border-slate-200">
            <h3 className="text-xs font-black uppercase tracking-wide text-[#64748B] mb-2">
              Kilometer Splits
            </h3>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-left">
                      <th className="px-3 py-2 font-black text-[#64748B]">KM</th>
                      <th className="px-3 py-2 font-black text-[#64748B]">Time</th>
                      <th className="px-3 py-2 font-black text-[#64748B]">Pace</th>
                      {splits.some(s => s.elevation_change != null) && (
                        <th className="px-3 py-2 font-black text-[#64748B]">Elev</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {splits.map((split, idx) => (
                      <tr
                        key={split.split_number}
                        className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}
                      >
                        <td className="px-3 py-2 font-black tabular-nums text-[#0A0E27]">
                          {split.split_number}
                        </td>
                        <td className="px-3 py-2 font-bold tabular-nums text-[#64748B]">
                          {formatDuration(split.duration)}
                        </td>
                        <td className="px-3 py-2 font-bold tabular-nums text-[#0A0E27]">
                          {formatPace(split.pace)}
                        </td>
                        {splits.some(s => s.elevation_change != null) && (
                          <td className="px-3 py-2 font-bold tabular-nums text-[#64748B]">
                            {split.elevation_change != null
                              ? `${split.elevation_change > 0 ? '+' : ''}${split.elevation_change.toFixed(0)}m`
                              : '—'}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Route map */}
        <div className="px-6 py-4 bg-white">
          {hasRoute ? (
            <Suspense
              fallback={
                <div className="flex h-[260px] w-full items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-[#64748B]">
                  Loading map…
                </div>
              }
            >
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <RouteMapGL
                  encodedPolyline={summary.encoded_polyline || undefined}
                  startLat={summary.start_lat}
                  startLng={summary.start_lng}
                  endLat={summary.end_lat}
                  endLng={summary.end_lng}
                  height={260}
                />
              </div>
              <div className="mt-2 flex items-center justify-center gap-4 text-[10px] font-bold text-[#64748B]">
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-[#22C55E]" /> Start
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-[#EF4444]" /> Finish
                </span>
              </div>
            </Suspense>
          ) : (
            <div className="flex h-[140px] w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center px-6">
              <p className="text-xs font-black text-[#64748B]">No GPS route recorded</p>
              <p className="text-[11px] font-semibold text-[#64748B]/70">
                Location signal was unavailable during this walk
              </p>
            </div>
          )}
        </div>

        {/* Photo attachment */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-black uppercase tracking-wide text-[#64748B]">
              Photos
            </h3>
            {photoUrls.length > 0 && (
              <span className="text-[10px] font-bold text-[#64748B]">
                {photoUrls.length} {photoUrls.length === 1 ? 'photo' : 'photos'}
              </span>
            )}
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={handlePhotoCapture}
              disabled={uploading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-slate-200 text-sm font-bold text-[#0A0E27] hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <Camera className="size-4" />
              Camera
            </button>
            <button
              onClick={handleGallerySelect}
              disabled={uploading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-slate-200 text-sm font-bold text-[#0A0E27] hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <ImageIcon className="size-4" />
              Gallery
            </button>
          </div>

          {uploading && (
            <div className="mt-3 flex items-center justify-center gap-2 text-xs font-bold text-[#7C5CFC]">
              <Loader2 className="size-4 animate-spin" />
              Uploading…
            </div>
          )}

          {photoUrls.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {photoUrls.map((url, idx) => (
                <img
                  key={idx}
                  src={url}
                  alt={`Walk photo ${idx + 1}`}
                  className="aspect-square w-full rounded-lg object-cover border border-slate-200"
                />
              ))}
            </div>
          )}
        </div>

        {/* Done button */}
        <button
          onClick={onClose}
          className="w-full py-4 text-sm font-black text-white bg-[#7C5CFC] hover:bg-[#6c4de8] active:scale-[0.99] transition-all"
        >
          Done
        </button>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
