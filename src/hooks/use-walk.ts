import { useState, useEffect, useRef, useCallback } from "react";
import { registerPlugin, Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import {
  createWalkSession,
  updateWalkSession,
  finishWalkSession,
  appendWalkPoint,
  getAbandonedWalkSessions,
  cancelWalkSession,
  todayLocalDate,
} from "@/lib/api";
import { WalkSession, WalkSummary, WalkSplit } from "@/lib/types";
import {
  Notifications,
  WalkServicePlugin,
  WalkStatusUpdate,
  WalkRoutePoint,
  WalkHealthUpdate,
} from "@/lib/notifications-integration";
import { ramerDouglasPeucker } from "@/lib/rdp";
import {
  filterGPSPoints,
  computeWalkStats,
  encodePolyline,
  type GPSPoint,
  type WalkStats,
} from "@/lib/walk-gps-utils";
import { saveWalkSummary, markLocalWalkSummariesDirty } from "@/lib/walk-storage";

export interface StepCounterPluginInterface {
  isAvailable(): Promise<{ available: boolean; hasCounter: boolean; hasDetector: boolean }>;
  startStepping(): Promise<{ started: boolean }>;
  stopStepping(): Promise<{ stopped: boolean }>;
  addListener(
    eventName: "stepEvent",
    listenerFunc: (data: { steps: number; increment: number; timestamp: number }) => void,
  ): Promise<any>;
}

const StepCounter = registerPlugin<StepCounterPluginInterface>("StepCounter");

// Helper: Calculate distance between 2 coordinates in meters (Haversine Formula)
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Stray-session guard: a session that finishes in under this many seconds
// while having moved less than this many meters is an accidental start/stop
// (mis-tap on Start, start-and-immediately-finish from the notification,
// GPS never acquiring a fix). Such sessions are saved as "cancelled" in
// Firestore — kept for audit, never counted as walks — so Walk History and
// the analytics totals stop filling up with 0.00 km entries.
const STRAY_WALK_MAX_DURATION_S = 60;
const STRAY_WALK_MAX_DISTANCE_M = 50;

/**
 * Bounds a Firestore write so a slow/offline device can never leave the
 * Finish flow hanging forever (the web SDK queues offline writes and their
 * promises only resolve when connectivity returns — with no timeout the
 * Finish button stayed disabled and no summary modal ever appeared).
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms),
    ),
  ]);
}

/**
 * Helper: Monotonic merge - updates state only if new value is greater.
 * Prevents metrics from moving backwards during native/JS handover.
 */
function monotonicUpdate<T extends number>(
  setter: React.Dispatch<React.SetStateAction<T>>,
  newValue: T,
) {
  setter((prev) => Math.max(prev, newValue) as T);
}

export function useWalk(
  userId: string | null | undefined,
  userWeightKg: number = 0,
  onComplete?: (session: WalkSession) => void,
) {
  const [activeSession, setActiveSession] = useState<WalkSession | null>(null);
  const [status, setStatus] = useState<"idle" | "active" | "paused" | "finished">("idle");
  const [duration, setDuration] = useState(0); // in seconds
  const [distance, setDistance] = useState(0); // in meters
  const [calories, setCalories] = useState(0);
  const [steps, setSteps] = useState(0);
  const [gpsAvailable, setGpsAvailable] = useState<boolean | null>(null);
  const [lastCoords, setLastCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAutoPaused, setIsAutoPaused] = useState(false);
  const [nativeTracking, setNativeTracking] = useState(false);
  const [vehicleFlagged, setVehicleFlagged] = useState(false);
  // Live pace (min/km) computed by the native foreground service. 0 until the
  // service has real distance to derive a pace from.
  const [pace, setPace] = useState(0);

  const watchIdRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  lastCoordsRef.current = lastCoords;
  // Wall-clock of the last accepted JS GPS fix — feeds the displacement/time
  // speed estimate used by the motion gate when the provider omits `speed`.
  const lastFixTimeRef = useRef<number>(0);

  // JS-side fallback trackers. These ONLY fill the gap before the native
  // service reports its first real progress (or on platforms without the
  // native service). Once the native service is live it owns distance/steps,
  // and these refs are never pushed into native state.
  const jsTrailRef = useRef<WalkRoutePoint[]>([]);
  const jsStepsRef = useRef(0);
  const gpsDistanceRef = useRef(0);
  // Cleanup for the JS step-sensor fallback listener (StepCounter/devicemotion),
  // so applyNativeStatus can tear it down the moment native tracking is live.
  const stepCleanupRef = useRef<(() => void) | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const userActedRef = useRef(false);
  const lastMotionTimeRef = useRef<number>(Date.now());
  const lastStepTimeRef = useRef<number>(0);
  // Live JS metrics snapshot used by the 4s poll to refresh the JS fallback
  // notification — avoids adding distance/steps/duration/calories to the poll
  // interval's dependency array (that would recreate the interval every tick).
  const liveMetricsRef = useRef({ distance: 0, steps: 0, duration: 0, calories: 0 });
  liveMetricsRef.current = { distance, steps, duration, calories };
  // Guards the one-shot native service re-arm after a restored session, so a
  // re-run of the restore effect can never restart the service with a stale
  // baseline. Reset when a brand-new walk starts.
  const restoredRef = useRef(false);
  // In-flight restore effect — startWalk awaits it (with a cap) before tearing
  // anything down, so a quick Start tap landing in the restore window can
  // never wipe a walk the restore is about to resurrect (native prefs + the
  // Firestore session it cancels via getAbandonedWalkSessions).
  const restorePromiseRef = useRef<Promise<void> | null>(null);
  // A double-tap can arrive before React commits `status="active"`. Keep the
  // create/start transaction single-flight so two sessions cannot race for
  // one native foreground service.
  const startInFlightRef = useRef(false);
  const userWeightKgRef = useRef(userWeightKg);
  userWeightKgRef.current = userWeightKg;
  // True once the native WalkService has reported at least one live update.
  // While true, the native values are the authoritative source for
  // distance/steps and the JS fallback accumulators are paused.
  const nativeActiveRef = useRef(false);
  const lastNativeUpdateCountRef = useRef(0);
  // Last native step total — step-only progress (indoor walk with no accepted
  // GPS fixes) must count as motion for the auto-pause gate, otherwise a
  // walker inside a building would be auto-paused mid-stride.
  const lastNativeStepsRef = useRef(0);
  const statusRef = useRef(status);
  statusRef.current = status;
  // Latest pause/finish callbacks, so the native walkUpdate "action" handler
  // (which lives in a stable useCallback) can drive the current session.
  const pauseWalkRef = useRef<(() => void) | null>(null);
  const resumeWalkRef = useRef<(() => void) | null>(null);
  const finishWalkRef = useRef<(() => Promise<WalkSession | null>) | null>(null);
  const isAutoPausedRef = useRef(isAutoPaused);
  isAutoPausedRef.current = isAutoPaused;
  const isNative = Capacitor.isNativePlatform();

  // Calculate real calories based on actual movement (distance & steps).
  // Standard energy expenditure for walking is ~0.755 kcal / kg / km.
  // When the user has not moved (0 km, 0 steps), calories strictly remain 0.
  useEffect(() => {
    const distKm = distance / 1000;
    if (distKm <= 0.001 && steps === 0) {
      setCalories(0);
      return;
    }
    const weightKg = userWeightKg > 0 ? userWeightKg : 70;
    const kcal = weightKg * distKm * 0.755;
    setCalories((prev) => Math.max(prev, Math.round(kcal)));
  }, [distance, steps, userWeightKg]);

  // Active Timer Loop
  useEffect(() => {
    // The native service owns elapsed time after it becomes live. Keeping this
    // interval running made the UI duration drift ahead permanently because
    // native snapshots are deliberately merged monotonically.
    if (status === "active" && !nativeTracking) {
      timerRef.current = window.setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status, nativeTracking]);

  // ──────────────────────────────────────────────────────────────────────────
  // Native WalkService sync (Android foreground service)
  //
  // The native service is the authoritative source for distance & steps while
  // it is tracking (it keeps counting even when the WebView JS is throttled in
  // the background). Two channels feed JS:
  //   1. "walkUpdate" push events on every location fix / step
  //   2. a 4s status poll that catches up after the app resumes
  // ──────────────────────────────────────────────────────────────────────────
  const applyNativeStatus = useCallback((data: WalkStatusUpdate) => {
    if (!data || typeof data.distanceKm !== "number") return;

    // The native foreground notification exposes Pause/Resume/Finish action buttons.
    // The service republishes a walkUpdate carrying `action` when the user
    // taps one, so the React session reacts in lock-step with the native
    // service (single source of truth — no duplicate/divergent state).
    if (
      data.action === "finish" &&
      (statusRef.current === "active" || statusRef.current === "paused")
    ) {
      // Route the native notification Finish through the SAME completion flow
      // as the in-app Finish button (summary modal + sound + stats refresh),
      // so finishing from the lock screen/notification never ends silently.
      finishWalkRef.current?.().then((session) => {
        if (session) onCompleteRef.current?.(session);
      });
      return;
    }
    if (data.action === "pause" && statusRef.current === "active") {
      pauseWalkRef.current?.();
      return;
    }
    if (data.action === "resume" && statusRef.current === "paused") {
      resumeWalkRef.current?.();
      return;
    }

    // The native service is the single source of truth the moment it reports
    // REAL progress (a step or accumulated distance). A service that is
    // tracking but has produced nothing yet (no accepted GPS fix, dead step
    // sensor) must NOT disable the JS fallback counters — otherwise a walk
    // can freeze at 0.00 km / 0 steps while the native side silently accepts
    // nothing. Once real values arrive, the merge below is monotonic
    // (Math.max), so the earlier JS fallback can never double-count.
    const hasRealProgress = data.steps > 0 || data.distanceKm > 0;

    if (typeof data.isVehicleFlagged === "boolean") {
      setVehicleFlagged(data.isVehicleFlagged);
    }

    // Duration and calories are wall-clock derived on the native side and
    // must stay in sync with the UI even while the GPS/step sensors have not
    // produced their first accepted fix (indoor start, sensors denied). They
    // are NOT gated behind hasRealProgress — otherwise a walk whose sensors
    // never fire freezes the whole card at 0.00 while the native clock runs.
    if (data.tracking) {
      if (data.durationSec > 0) {
        monotonicUpdate(setDuration, data.durationSec);
      }
      if (typeof data.calories === "number" && data.calories >= 0) {
        monotonicUpdate(setCalories, Math.round(data.calories));
      }
      if (typeof data.paceMinPerKm === "number" && data.paceMinPerKm > 0) {
        setPace(data.paceMinPerKm);
      }
    }

    if (data.tracking && hasRealProgress) {
      const becameNativeActive = !nativeActiveRef.current;
      nativeActiveRef.current = true;
      setNativeTracking(true);
      // Only reset the motion clock on the JS→native handover. Resetting it on
      // every event/poll would keep refreshing it while the user stands still
      // (the 4s status poll delivers tracking+progress with frozen
      // updateCount/steps), silently disabling the 12s auto-pause gate below.
      // Ongoing motion is credited by the updateCount/steps gate at the bottom.
      if (becameNativeActive) {
        lastMotionTimeRef.current = Date.now();
      }

      // The native service owns step counting from here on. Tear down the JS
      // StepCounter/devicemotion fallback listener so both never register the
      // same sensors simultaneously (duplicate counting / sensor conflicts).
      if (becameNativeActive) {
        stepCleanupRef.current?.();
        stepCleanupRef.current = null;
      }

      // Align React session status with native service status
      if (data.paused) {
        if (statusRef.current === "active") {
          setStatus("paused");
        }
      } else {
        if (statusRef.current === "idle" || statusRef.current === "paused") {
          setStatus("active");
          setIsAutoPaused(false);
        }
      }

      setDistance((prev) => {
        // Monotonic merge — native distance is authoritative, but never move
        // backwards (native session restart vs. already-accumulated JS value).
        const nativeMeters = Math.round(data.distanceKm * 1000);
        return Math.max(prev, nativeMeters);
      });

      if (data.steps > 0) {
        monotonicUpdate(setSteps, data.steps);
      } else if (data.distanceKm > 0.01) {
        // Sensorless / silent-sensor devices: native GPS distance is the only
        // movement signal, so mirror the native stride estimate (0.762 m/step)
        // as a floor — the counter must never sit at 0 while distance moves.
        monotonicUpdate(setSteps, Math.round((data.distanceKm * 1000) / 0.762));
      }

      // Feed native GPS fixes into the JS coordinate trail so the path
      // recorded to Firestore keeps growing even when the WebView watcher
      // is throttled in the background.
      if (
        data.updateCount > 0 &&
        data.accuracy !== undefined &&
        data.accuracy > 0 &&
        data.accuracy <= 30 &&
        typeof data.latitude === "number" &&
        typeof data.longitude === "number" &&
        (data.latitude !== 0 || data.longitude !== 0)
      ) {
        const coords = { lat: data.latitude, lng: data.longitude };
        setLastCoords((prev) => {
          if (!prev) return coords;
          // Only record a new trail point for a meaningful displacement.
          const d = haversineDistance(prev.lat, prev.lng, coords.lat, coords.lng);
          return d >= 1.2 ? coords : prev;
        });
        // Mirror the accepted fix into the JS trail so the route survives even
        // if the native SQLite copy is unavailable at finish time.
        const trail = jsTrailRef.current;
        const lastTrail = trail.length > 0 ? trail[trail.length - 1] : null;
        if (
          !lastTrail ||
          haversineDistance(lastTrail.lat, lastTrail.lng, coords.lat, coords.lng) >= 1.2
        ) {
          trail.push({ lat: coords.lat, lng: coords.lng, ts: Date.now() });
        }
      }
    }

    if (data.updateCount > 0 && data.accuracy !== undefined && data.accuracy > 0) {
      setGpsAvailable(data.accuracy <= 30);
    }

    if (
      data.updateCount > lastNativeUpdateCountRef.current ||
      (data.steps > 0 && data.steps > lastNativeStepsRef.current)
    ) {
      lastNativeUpdateCountRef.current = data.updateCount;
      lastNativeStepsRef.current = data.steps;
      lastMotionTimeRef.current = Date.now();
    }
  }, []);

  // Restore in-progress walk after reload.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const run = (async () => {
      try {
        let nativeStatus: WalkStatusUpdate | null = null;
        if (isNative) {
          try {
            nativeStatus = await WalkServicePlugin.getStatus();
          } catch (e) {
            console.warn("Failed to check native status during restore:", e);
          }
        }

        const isNativeTracking = !!(nativeStatus && nativeStatus.tracking);
        const abandoned = await getAbandonedWalkSessions(userId);
        if (cancelled || userActedRef.current) return;
        const latest = abandoned[0];
        const startedAtMs = latest?.started_at ? new Date(latest.started_at).getTime() : 0;
        const isRecent =
          Number.isFinite(startedAtMs) && Date.now() - startedAtMs < 12 * 60 * 60 * 1000;
        const restoreSession = isNativeTracking || (!!latest && isRecent);

        if (restoreSession) {
          const sessionToUse: WalkSession = latest || {
            id: nativeStatus?.sessionId || "current_session",
            user_id: userId,
            status: "active",
            duration: nativeStatus?.durationSec || 0,
            distance: Math.round((nativeStatus?.distanceKm || 0) * 1000),
            calories: Math.round(nativeStatus?.calories || 0),
            steps: nativeStatus?.steps || 0,
            started_at: new Date(
              Date.now() - (nativeStatus?.durationSec || 0) * 1000,
            ).toISOString(),
            day: todayLocalDate(),
            path: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          setActiveSession(sessionToUse);
          if (nativeStatus && nativeStatus.tracking) {
            setStatus(nativeStatus.paused ? "paused" : "active");
            applyNativeStatus(nativeStatus);
          } else {
            setStatus("paused");
            setDuration(latest?.duration || 0);
            setDistance(latest?.distance || 0);
            setCalories(latest?.calories || 0);
            setSteps(latest?.steps || 0);
            setVehicleFlagged(!!latest?.vehicle);
            const path = latest?.path || [];
            setLastCoords(
              path.length > 0
                ? { lat: path[path.length - 1].lat, lng: path[path.length - 1].lng }
                : null,
            );
          }

          if (abandoned.length > 1) {
            abandoned.slice(1).forEach((s) => {
              cancelWalkSession(s.id, userId).catch(() => {});
            });
          }

          // Re-arm native foreground walk service if not already tracking
          if (isNative && !restoredRef.current && !isNativeTracking && latest) {
            restoredRef.current = true;
            try {
              await Notifications.startWalkForeground(
                (latest.distance || 0) / 1000,
                latest.steps || 0,
                latest.duration || 0,
                latest.calories || 0,
                0,
                userWeightKgRef.current,
                latest.id,
                true, // start paused — user resumes deliberately
              );
              const st2 = await WalkServicePlugin.getStatus();
              if (st2) applyNativeStatus(st2);
            } catch (e) {
              console.warn("Failed to re-arm native walk service after restore:", e);
            }
          }
        } else {
          abandoned.forEach((s) => {
            cancelWalkSession(s.id, userId).catch(() => {});
          });
        }
      } catch (e) {
        console.error("Failed to restore walk session:", e);
      }
    })();
    restorePromiseRef.current = run;
    return () => {
      cancelled = true;
      restorePromiseRef.current = null;
    };
  }, [userId, applyNativeStatus, isNative]);

  useEffect(() => {
    if (!isNative) return;
    let listener: { remove: () => void } | null = null;
    let cancelled = false;

    const setup = async () => {
      try {
        listener = await WalkServicePlugin.addListener("walkUpdate", (data: WalkStatusUpdate) => {
          if (!cancelled) applyNativeStatus(data);
        });
      } catch (e) {
        console.warn("Failed to attach WalkService listener:", e);
      }
    };
    setup();

    return () => {
      cancelled = true;
      listener?.remove();
    };
  }, [isNative, applyNativeStatus]);

  // Surface native health warnings (GPS lost, step sensor stalled, wake lock
  // dropped) as toasts so the user can act while walking instead of
  // discovering a frozen count at the end. Rate-limited to one toast per 60s
  // so a persistent warning never spams.
  const lastHealthToastRef = useRef(0);
  useEffect(() => {
    if (!isNative) return;
    let listener: { remove: () => void } | null = null;
    let cancelled = false;

    const setup = async () => {
      try {
        listener = await WalkServicePlugin.addListener(
          "walkHealthUpdate",
          (data: WalkHealthUpdate) => {
            if (cancelled || !data || data.status === "healthy") return;
            const now = Date.now();
            if (now - lastHealthToastRef.current < 60_000) return;
            lastHealthToastRef.current = now;
            toast.warning(data.message || "Walk tracking health issue detected");
          },
        );
      } catch (e) {
        console.warn("Failed to attach walkHealthUpdate listener:", e);
      }
    };
    setup();

    return () => {
      cancelled = true;
      listener?.remove();
    };
  }, [isNative]);

  // Periodic status poll — covers WebView suspension gaps, event loss, and
  // keeps feeding native trail points into the JS coordinate trail so a
  // resumed walk has a valid previous fix (without it the first GPS delta
  // that unlocks the distance is silently dropped and km stays at 0.00).
  useEffect(() => {
    if (!isNative || (status !== "active" && status !== "paused")) return;
    const poll = window.setInterval(async () => {
      try {
        const data = await WalkServicePlugin.getStatus();
        if (data) applyNativeStatus(data);
        // The native service is down (failed to start — e.g. missing FGS
        // permissions / Android 12+ launch restriction) while a session is
        // live: keep the JS fallback notification mirroring the live JS
        // counters instead of a frozen "Tracking your walk" notice. No-op
        // unless the fallback notification is actually showing.
        if (!data || !data.tracking) {
          const m = liveMetricsRef.current;
          Notifications.refreshWalkFallback(m.distance / 1000, m.steps, m.duration, m.calories);
        }
      } catch (e) {
        // Service may not be running (e.g. web or device without location)
      }
    }, 4000);
    return () => clearInterval(poll);
  }, [isNative, status, applyNativeStatus]);

  // App-resume catch-up: WebView timers can be suspended while backgrounded,
  // so grab a fresh native snapshot the moment the app returns to the
  // foreground — the 4s poll would otherwise leave a visible stale-value
  // (e.g. "0.00 km") window right after resuming.
  useEffect(() => {
    if (!isNative) return;
    const fetchStatus = () => {
      lastMotionTimeRef.current = Date.now();
      void WalkServicePlugin.getStatus()
        .then((data) => {
          if (data) applyNativeStatus(data);
        })
        .catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") fetchStatus();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [isNative, applyNativeStatus]);

  // Live notification sync. The native foreground service updates its own
  // notification on every fix/step/tick and is the authoritative source.
  //
  // REMOVED: The old code pushed JS values to native every second, which
  // created a race condition at startup where stale (zero) values overwrote
  // the native GPS/step counters, causing distance to stick at 0.00 km.
  //
  // The native service now owns all counters from the moment it starts, and
  // the JS fallback notification (walkFallbackActive) is only used when the
  // native service fails to start entirely (no permissions, etc.) — while it
  // is showing, the 4s poll above keeps its body refreshed with live metrics
  // via Notifications.refreshWalkFallback().

  // Step Counter Sensor / Fallback Listener.
  useEffect(() => {
    if (status !== "active") return;

    let cleanupListener: (() => void) | null = null;
    let devicemotionHandler: ((e: DeviceMotionEvent) => void) | null = null;

    const setupStepTracking = async () => {
      lastMotionTimeRef.current = Date.now();

      // No early return on native: the WebView accelerometer fallback also
      // registers here and only fills the gap while the native foreground
      // service has produced nothing yet (FGS failed to start — permissions
      // denied / Android 12+ launch restriction — or the stream is still
      // warming up). applyNativeStatus tears it down the moment the native
      // stream reports real progress (becameNativeActive), and every counter
      // merge is monotonic (Math.max), so the two can never double-count.

      // Fallback: Web DeviceMotion Accelerometer Peak Detection Filter
      devicemotionHandler = (event: DeviceMotionEvent) => {
        const acc = event.accelerationIncludingGravity || event.acceleration;
        if (!acc) return;
        const x = acc.x || 0;
        const y = acc.y || 0;
        const z = acc.z || 0;
        const mag = Math.sqrt(x * x + y * y + z * z);
        const now = Date.now();

        // Step peak threshold (magnitude spike > 11.8 m/s^2 with min 320ms step interval)
        if (mag > 11.8 && now - lastStepTimeRef.current > 320) {
          lastStepTimeRef.current = now;
          lastMotionTimeRef.current = now;
          jsStepsRef.current += 1;
          setSteps(jsStepsRef.current);
          if (!nativeActiveRef.current) {
            setDistance((prev) => Math.max(prev, Math.round(jsStepsRef.current * 0.762)));
          }
          if (isAutoPausedRef.current) {
            setStatus("active");
            setIsAutoPaused(false);
          }
        }
      };

      if (typeof window !== "undefined" && "DeviceMotionEvent" in window) {
        window.addEventListener("devicemotion", devicemotionHandler);
        cleanupListener = () => {
          if (devicemotionHandler) window.removeEventListener("devicemotion", devicemotionHandler);
        };
        stepCleanupRef.current = cleanupListener;
      }
    };

    setupStepTracking();

    return () => {
      if (cleanupListener) cleanupListener();
      if (stepCleanupRef.current === cleanupListener) stepCleanupRef.current = null;
    };
    // NOTE: isAutoPaused intentionally NOT in the dependency array — toggling
    // it must not re-register the native step sensor (which would reset the
    // native session counter and double-count steps in JS).
  }, [status, isNative]);

  // Real GPS Location Watcher
  useEffect(() => {
    if (status === "active" && typeof window !== "undefined" && "geolocation" in navigator) {
      setGpsAvailable(true);
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude: lat, longitude: lng, accuracy, speed } = pos.coords;
          // Filter out very poor accuracy GPS readings (> 45 meters accuracy threshold)
          if (accuracy && accuracy > 45) return;

          const currentPoint = { lat, lng, ts: Date.now() };
          const nowTs = pos.timestamp || currentPoint.ts;

          if (lastCoordsRef.current) {
            const distDelta = haversineDistance(
              lastCoordsRef.current.lat,
              lastCoordsRef.current.lng,
              lat,
              lng,
            );
            // Motion evidence gate: a GPS delta is only real movement when
            // the step sensor registered a step recently (a walking cadence
            // fires continuously) OR the fix implies walking speed. Speed is
            // the provider-reported value when present, otherwise a
            // displacement/time estimate — many fused providers omit `speed`,
            // so without this fallback real walks stayed at 0.00 km whenever
            // the step-sensor stream was unavailable. Standing still with GPS
            // wobble (>3m fix-to-fix jitter) stays rejected by the >= 1.0m
            // displacement and 35m jump caps.
            const stepFresh = Date.now() - lastStepTimeRef.current < 15000;
            const dtMs = lastFixTimeRef.current > 0 ? nowTs - lastFixTimeRef.current : 0;
            const reportedSpeed = typeof speed === "number" && Number.isFinite(speed) ? speed : 0;
            const computedSpeed = dtMs > 0 ? (distDelta * 1000) / dtMs : 0;
            const speedMoving = Math.max(reportedSpeed, computedSpeed) >= 0.5;
            const motionPlausible = stepFresh || speedMoving;
            // Only add valid human walking speed deltas (1.0m to 35m jump)
            if (distDelta >= 1.0 && distDelta <= 35 && motionPlausible) {
              lastMotionTimeRef.current = Date.now();
              // Native service owns the accumulated distance while it's live;
              // the WebView fallback only fills in before the first native
              // report (or on platforms without the native service).
              if (!nativeActiveRef.current) {
                gpsDistanceRef.current += distDelta;
                setDistance((prev) =>
                  Math.max(
                    prev,
                    Math.round(gpsDistanceRef.current),
                    Math.round(jsStepsRef.current * 0.762),
                  ),
                );
                // GPS-derived step floor (mirrors the native stride estimate):
                // on devices where the devicemotion stream never fires
                // (permission denied / unsupported), steps still track the
                // distance instead of freezing at 0.
                const impliedSteps = Math.round(gpsDistanceRef.current / 0.762);
                if (impliedSteps > jsStepsRef.current) {
                  jsStepsRef.current = impliedSteps;
                  setSteps(impliedSteps);
                }
              }
              jsTrailRef.current.push(currentPoint);
              if (isAutoPausedRef.current) {
                setStatus("active");
                setIsAutoPaused(false);
              }
            }
          } else {
            // Record first point immediately so start location is never lost
            jsTrailRef.current.push(currentPoint);
          }
          lastFixTimeRef.current = nowTs;
          setLastCoords({ lat, lng });

          // Per-fix Firestore appends on web fallback
          if (activeSession && userId && !isNative) {
            appendWalkPoint(activeSession.id, userId, currentPoint).catch(() => {});
          }
        },
        (err) => {
          console.warn("Geolocation warning/unavailable:", err.message);
          setGpsAvailable(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 },
      );
    } else {
      if (
        watchIdRef.current !== null &&
        typeof window !== "undefined" &&
        "geolocation" in navigator
      ) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    }
    return () => {
      if (
        watchIdRef.current !== null &&
        typeof window !== "undefined" &&
        "geolocation" in navigator
      ) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [status, activeSession, userId, isNative]);

  // Start Walk Session
  const startWalk = useCallback(async () => {
    if (!userId || startInFlightRef.current) return;
    startInFlightRef.current = true;
    setLoading(true);
    try {
      // Wait for the initial restore to settle before touching anything: a
      // Start tap landing in the restore window would otherwise tear down a
      // live native walk (stopWalkForeground wipes its prefs) and cancel its
      // Firestore session. Capped so a hung restore can never block Start.
      const restorePromise = restorePromiseRef.current;
      if (restorePromise) {
        try {
          await Promise.race([restorePromise, new Promise((resolve) => setTimeout(resolve, 5000))]);
        } catch {
          /* restore self-handles errors */
        }
        restorePromiseRef.current = null;
        // The restore may have resurrected an in-progress walk — never tear
        // it down from a stale Start tap; the UI now shows Resume/Pause.
        if (statusRef.current === "active" || statusRef.current === "paused") {
          return;
        }
      }
      userActedRef.current = true;
      // Tear down any live native foreground service FIRST: its SQLite route
      // points and SharedPreferences are keyed on the previous session id. A
      // new walk must not inherit, orphan, or double-own them — the native
      // ACTION_STOP clears both (and the JS fallback notification too).
      if (isNative) {
        try {
          await Notifications.stopWalkForeground();
        } catch (e) {
          /* ignore */
        }
      }
      restoredRef.current = false;

      const abandoned = await getAbandonedWalkSessions(userId);
      await Promise.all(abandoned.map((s) => cancelWalkSession(s.id, userId).catch(() => {})));

      const session = await createWalkSession(userId);
      setActiveSession(session);
      setStatus("active");
      setIsAutoPaused(false);
      setDuration(0);
      setDistance(0);
      setCalories(0);
      setSteps(0);
      setLastCoords(null);
      lastFixTimeRef.current = 0;
      lastMotionTimeRef.current = Date.now();
      nativeActiveRef.current = false;
      setNativeTracking(false);
      setVehicleFlagged(false);
      setPace(0);
      lastNativeUpdateCountRef.current = 0;
      lastNativeStepsRef.current = 0;
      jsTrailRef.current = [];
      jsStepsRef.current = 0;
      gpsDistanceRef.current = 0;

      // Seed initial location immediately if available
      if (typeof window !== "undefined" && "geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude: lat, longitude: lng } = pos.coords;
            const startPt = { lat, lng, ts: Date.now() };
            setLastCoords({ lat, lng });
            jsTrailRef.current = [startPt];
            if (session?.id && userId && !isNative) {
              appendWalkPoint(session.id, userId, startPt).catch(() => {});
            }
          },
          (err) => {
            console.warn("Could not get initial position:", err.message);
          },
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
        );
      }

      // Persistent OS-level foreground notification in Android Control Center.
      // The native WalkService becomes the source of truth from here on and
      // streams "walkUpdate" events + poll snapshots back to this hook. The
      // Firestore session id is passed along so native SQLite route points
      // are stored under the same session that gets finalized later.
      Notifications.startWalkForeground(0, 0, 0, 0, 0, userWeightKg, session.id);
    } catch (e) {
      console.error("Failed to start walk session:", e);
    } finally {
      setLoading(false);
      startInFlightRef.current = false;
    }
  }, [userId, userWeightKg, isNative]);

  // Pause Walk Session
  const pauseWalk = useCallback(async () => {
    if (!activeSession || !userId) return;
    setStatus("paused");
    setIsAutoPaused(false);
    nativeActiveRef.current = false;
    setNativeTracking(false);
    lastNativeUpdateCountRef.current = 0;
    lastNativeStepsRef.current = 0;
    // Keep the foreground service alive (so the notification persists) but tell
    // the native side to stop the clock — the walk notification freezes on the
    // paused metrics instead of being torn down and rebuilt.
    Notifications.pauseWalkForeground();
    try {
      await updateWalkSession(activeSession.id, userId, {
        status: "paused",
        duration,
        distance,
        calories,
        steps,
      });
    } catch (e) {
      console.error("Failed to pause walk session:", e);
    }
  }, [activeSession, userId, duration, distance, calories, steps]);

  // Resume Walk Session
  const resumeWalk = useCallback(async () => {
    if (!activeSession || !userId) return;
    setStatus("active");
    setIsAutoPaused(false);
    lastMotionTimeRef.current = Date.now();
    nativeActiveRef.current = false;
    setNativeTracking(false);
    lastNativeUpdateCountRef.current = 0;
    lastNativeStepsRef.current = 0;
    setLastCoords(null);
    // Pass the saved session baseline so the native service continues the
    // duration clock exactly where we left off.
    Notifications.resumeWalkForeground(distance / 1000, steps, duration, calories, 0, userWeightKg);
    // Pull the native snapshot immediately: a service instance re-created
    // after process death restores its persisted counters (distance/steps/
    // duration) from SharedPreferences in onCreate, and if the walkUpdate
    // listener was not yet attached (cold start) the next poll would leave a
    // stale "0.00 km" window. Applying the snapshot now cleans that up.
    if (isNative) {
      WalkServicePlugin.getStatus()
        .then((data) => {
          if (data) applyNativeStatus(data);
        })
        .catch(() => {});
    }
    try {
      await updateWalkSession(activeSession.id, userId, { status: "active" });
    } catch (e) {
      console.error("Failed to resume walk session:", e);
    }
  }, [
    activeSession,
    userId,
    distance,
    steps,
    duration,
    calories,
    userWeightKg,
    isNative,
    applyNativeStatus,
  ]);

  // Finish Walk Session
  const finishWalk = useCallback(async () => {
    let sessionObj = activeSession;
    if (!sessionObj && userId) {
      if (isNative) {
        try {
          const data = await WalkServicePlugin.getStatus();
          if (data && data.tracking) {
            sessionObj = {
              id: data.sessionId || "current_session",
              user_id: userId,
              status: "active",
              duration: data.durationSec || 0,
              distance: Math.round((data.distanceKm || 0) * 1000),
              calories: Math.round(data.calories || 0),
              steps: data.steps || 0,
              started_at: new Date(Date.now() - (data.durationSec || 0) * 1000).toISOString(),
              day: todayLocalDate(),
              path: [],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            setActiveSession(sessionObj);
          }
        } catch (e) {
          console.warn("Failed to recover active session from native status:", e);
        }
      }
      if (!sessionObj) {
        try {
          const abandoned = await getAbandonedWalkSessions(userId);
          if (abandoned.length > 0) {
            sessionObj = abandoned[0];
            setActiveSession(sessionObj);
          }
        } catch (e) {
          console.warn("Failed to recover abandoned walk session:", e);
        }
      }
    }
    if (!sessionObj || !userId) return null;
    userActedRef.current = true;
    setLoading(true);
    try {
      // Pull the latest native snapshot before saving so the recorded
      // distance/steps/duration match what the foreground service accumulated
      // (it kept counting while the app was backgrounded / locked).
      let finalDistance = distance;
      let finalSteps = steps;
      let finalDuration = duration;
      let finalCalories = calories;
      let finalVehicleFlagged = vehicleFlagged;
      let nativeRoute: WalkRoutePoint[] | null = null;
      if (isNative) {
        try {
          const data = await WalkServicePlugin.getStatus();
          if (data && data.tracking) {
            applyNativeStatus(data);
            if (typeof data.distanceKm === "number" && data.distanceKm > 0) {
              finalDistance = Math.max(finalDistance, Math.round(data.distanceKm * 1000));
            }
            if (typeof data.steps === "number" && data.steps > 0) {
              finalSteps = Math.max(finalSteps, data.steps);
            }
            if (typeof data.durationSec === "number" && data.durationSec > 0) {
              finalDuration = Math.max(finalDuration, data.durationSec);
            }
            if (typeof data.calories === "number" && data.calories > 0) {
              finalCalories = Math.max(finalCalories, Math.round(data.calories));
            }
            if (typeof data.isVehicleFlagged === "boolean") {
              finalVehicleFlagged = data.isVehicleFlagged;
            }
          }
        } catch (e) {
          /* fall back to JS values */
        }

        // The native service persisted every accepted GPS fix into SQLite
        // during the session (survives process death / app swipes). Pull the
        // exact route so the summary map can render start → end even after
        // the activity ends.
        try {
          const route = await WalkServicePlugin.getRoutePoints({
            sessionId: sessionObj.id,
          });
          if (route && route.points) {
            const parsed = JSON.parse(route.points) as WalkRoutePoint[];
            if (Array.isArray(parsed) && parsed.length > 0) {
              nativeRoute = parsed;
            }
            if (typeof route.isVehicleFlagged === "boolean") {
              finalVehicleFlagged = route.isVehicleFlagged;
            }
          }
        } catch (e) {
          console.warn("Failed to pull native route points:", e);
        }
      }

      // Merge the native SQLite trail (authoritative) with the JS-recorded
      // trail (web fallback / native SQLite unavailable), dedupe by proximity,
      // then simplify with light RDP so the saved path is smooth and compact.
      // The live JS trail (jsTrailRef) is kept so a real multi-point route is
      // never lost — previously only the LAST coordinate was kept, which
      // produced the "No GPS route available" summary for real walks.
      let finalPath: WalkRoutePoint[] = [];
      if (nativeRoute && nativeRoute.length > 0) {
        finalPath = nativeRoute;
      } else if (jsTrailRef.current.length > 0) {
        finalPath = [...jsTrailRef.current];
        if (lastCoords) {
          const lastPt = finalPath[finalPath.length - 1];
          if (
            !lastPt ||
            haversineDistance(lastPt.lat, lastPt.lng, lastCoords.lat, lastCoords.lng) >= 1.2
          ) {
            finalPath.push({ lat: lastCoords.lat, lng: lastCoords.lng, ts: Date.now() });
          }
        }
      } else if (lastCoords) {
        finalPath = [{ lat: lastCoords.lat, lng: lastCoords.lng, ts: Date.now() }];
      }

      if (finalPath.length > 2) {
        finalPath = ramerDouglasPeucker(finalPath, 0.00003);
      }

      // Convert route points to GPSPoint format for stats computation
      const gpsPoints: GPSPoint[] = finalPath.map((pt) => ({
        lat: pt.lat,
        lng: pt.lng,
        altitude: null,
        accuracy: null,
        speed: null,
        ts: pt.ts,
      }));

      // Filter GPS noise and compute comprehensive stats
      let stats: WalkStats;
      let pointsForStats: GPSPoint[] = gpsPoints;
      try {
        const filteredPoints = filterGPSPoints(gpsPoints);
        pointsForStats = filteredPoints.length > 0 ? filteredPoints : gpsPoints;
        stats = computeWalkStats(pointsForStats, finalDuration);
      } catch (e) {
        stats = {
          totalDistance: 0,
          duration: 0,
          avgPace: null,
          avgSpeed: null,
          elevationGain: null,
          elevationLoss: null,
          splits: [],
        };
      }

      const resolvedDistance = Math.max(stats.totalDistance || 0, finalDistance || 0);

      // Stray-session guard: finishing in under STRAY_WALK_MAX_DURATION_S while
      // having moved less than STRAY_WALK_MAX_DISTANCE_M means an accidental
      // start/stop (mis-tap on Start, start-and-immediately-finish from the
      // notification, GPS never acquiring a fix). Save such sessions as
      // "cancelled" in Firestore — kept for audit, never counted as walks —
      // and skip the local summary so history/analytics stop filling up with
      // 0.00 km entries. A session that registered STEPS is a real (if short)
      // walk — never cancelled: that previously ate real walks whose GPS was
      // weak and left "nothing happened" after Finish.
      const isStray =
        finalDuration <= STRAY_WALK_MAX_DURATION_S &&
        resolvedDistance <= STRAY_WALK_MAX_DISTANCE_M &&
        finalSteps === 0;

      // Encode polyline for efficient storage. When the strict noise filter
      // drops everything (short walk, indoor GPS), fall back to the raw trail
      // so the summary map still renders a route instead of an empty box.
      const pointsForEncoding = pointsForStats.length > 0 ? pointsForStats : gpsPoints;
      const encodedPolyline =
        pointsForEncoding.length > 0 ? encodePolyline(pointsForEncoding) : null;

      // Prepare start/end coordinates — prefer the filtered trail, then the
      // raw trail, then the last live fix.
      const routeStart =
        pointsForStats.length > 0 ? pointsForStats[0] : finalPath.length > 0 ? finalPath[0] : null;
      const routeEnd =
        pointsForStats.length > 0
          ? pointsForStats[pointsForStats.length - 1]
          : finalPath.length > 0
            ? finalPath[finalPath.length - 1]
            : null;
      const startLat = routeStart?.lat ?? lastCoords?.lat ?? null;
      const startLng = routeStart?.lng ?? lastCoords?.lng ?? null;
      const endLat = routeEnd?.lat ?? lastCoords?.lat ?? null;
      const endLng = routeEnd?.lng ?? lastCoords?.lng ?? null;

      const finalEffectiveWeight = userWeightKg > 0 ? userWeightKg : 70;
      const finalCaloriesValue =
        resolvedDistance > 1 || finalSteps > 0
          ? Math.max(
              finalCalories,
              Math.round(finalEffectiveWeight * (resolvedDistance / 1000) * 0.755),
            )
          : 0;

      // Create walk summary for local SQLite storage
      const now = new Date().toISOString();
      const summary: WalkSummary = {
        id: sessionObj.id,
        user_id: userId,
        status: isStray ? "cancelled" : "finished",
        duration: finalDuration,
        distance: resolvedDistance,
        calories: finalCaloriesValue,
        steps: finalSteps,
        avg_pace:
          stats.avgPace ||
          (resolvedDistance > 0 && finalDuration > 0
            ? finalDuration / (resolvedDistance / 1000)
            : null),
        elevation_gain: stats.elevationGain,
        elevation_loss: stats.elevationLoss,
        day: todayLocalDate(),
        started_at: sessionObj.started_at,
        finished_at: now,
        encoded_polyline: encodedPolyline,
        start_lat: startLat,
        start_lng: startLng,
        end_lat: endLat,
        end_lng: endLng,
        photo_urls: [],
        vehicle_flagged: finalVehicleFlagged,
        created_at: sessionObj.created_at || now,
        updated_at: now,
      };

      // Convert splits to WalkSplit format
      const splits: WalkSplit[] = stats.splits.map((split) => ({
        session_id: sessionObj.id,
        split_number: split.splitNumber,
        distance: split.distance,
        duration: split.duration,
        pace: split.pace,
        elevation_change: split.elevationChange,
      }));

      // Save to local SQLite (for offline/native history) and update Firestore
      if (isStray) {
        // Accidentally started session: record as cancelled (audit only).
        try {
          await cancelWalkSession(sessionObj.id, userId);
        } catch (error) {
          console.error("Failed to cancel stray walk session in Firestore:", error);
        }
      } else {
        try {
          await saveWalkSummary(summary, splits);
          // Tell the next mergeLocalWalkSummaries call to re-read SQLite even
          // if the Firestore snapshot has not changed yet (offline write).
          markLocalWalkSummariesDirty();
        } catch (error) {
          console.error("Failed to save walk summary locally:", error);
        }
        try {
          await withTimeout(
            finishWalkSession(sessionObj.id, userId, {
              duration: finalDuration,
              distance: resolvedDistance,
              calories: finalCaloriesValue,
              steps: finalSteps,
              day: sessionObj.day || todayLocalDate(),
              finished_at: now,
              path: finalPath.length > 0 ? finalPath : null,
              vehicle: finalVehicleFlagged,
            }),
            8_000,
            "finishWalkSession",
          );
        } catch (error) {
          // The local SQLite summary above is already saved — the walk is not
          // lost. The Firestore finish is retried by the merge/backfill path
          // (mergeLocalWalkSummaries) and by the realtime subscription's
          // upsert, so a timeout/offline write converges once connectivity is
          // back.
          console.error("Failed to finish walk session in Firestore:", error);
        }
      }

      // Clean up state
      setActiveSession(null);
      setStatus("idle");
      setIsAutoPaused(false);
      setDuration(0);
      setDistance(0);
      setCalories(0);
      setSteps(0);
      setPace(0);
      setLastCoords(null);
      setVehicleFlagged(false);
      nativeActiveRef.current = false;
      setNativeTracking(false);
      jsTrailRef.current = [];
      jsStepsRef.current = 0;
      gpsDistanceRef.current = 0;
      stepCleanupRef.current?.();
      stepCleanupRef.current = null;
      Notifications.stopWalkForeground();

      // Free the native SQLite route_points storage — the route now lives in
      // walk_summaries table with encoded polyline
      if (isNative) {
        WalkServicePlugin.clearRoutePoints({ sessionId: sessionObj.id }).catch(() => {});
      }

      // Create a finished session object for the callback
      const finishedSession: WalkSession = {
        ...sessionObj,
        status: isStray ? "cancelled" : "finished",
        duration: finalDuration,
        distance: resolvedDistance,
        calories: finalCaloriesValue,
        steps: finalSteps,
        finished_at: now,
        path: finalPath.length > 0 ? finalPath : null,
        vehicle: finalVehicleFlagged,
        updated_at: now,
      };

      return finishedSession;
    } catch (e) {
      console.error("Failed to finish walk session:", e);
      return null;
    } finally {
      setLoading(false);
    }
  }, [
    activeSession,
    userId,
    duration,
    distance,
    steps,
    calories,
    vehicleFlagged,
    lastCoords,
    isNative,
    userWeightKg,
    applyNativeStatus,
  ]);

  const resetWalk = useCallback(() => {
    setStatus("idle");
    setIsAutoPaused(false);
    setActiveSession(null);
    setDuration(0);
    setDistance(0);
    setCalories(0);
    setSteps(0);
    setPace(0);
    setLastCoords(null);
    lastFixTimeRef.current = 0;
    setVehicleFlagged(false);
    nativeActiveRef.current = false;
    setNativeTracking(false);
    jsTrailRef.current = [];
    jsStepsRef.current = 0;
    gpsDistanceRef.current = 0;
    stepCleanupRef.current?.();
    stepCleanupRef.current = null;
    Notifications.stopWalkForeground();
  }, []);

  // Keep the native-action refs pointed at the latest callbacks.
  useEffect(() => {
    pauseWalkRef.current = pauseWalk;
    resumeWalkRef.current = resumeWalk;
    finishWalkRef.current = finishWalk;
  }, [pauseWalk, resumeWalk, finishWalk]);

  return {
    activeSession,
    status,
    isAutoPaused,
    duration,
    distance,
    calories,
    steps,
    path:
      activeSession?.path && activeSession.path.length > 0
        ? activeSession.path
        : jsTrailRef.current,
    lastCoords,
    gpsAvailable,
    nativeTracking,
    vehicleFlagged,
    pace,
    loading,
    startWalk,
    pauseWalk,
    resumeWalk,
    finishWalk,
    resetWalk,
  };
}
