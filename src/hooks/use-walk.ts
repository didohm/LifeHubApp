import { useState, useEffect, useRef, useCallback } from "react";
import { registerPlugin, Capacitor } from "@capacitor/core";
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
} from "@/lib/notifications-integration";
import { ramerDouglasPeucker } from "@/lib/rdp";
import {
  filterGPSPoints,
  computeWalkStats,
  encodePolyline,
  type GPSPoint,
} from "@/lib/walk-gps-utils";
import { saveWalkSummary } from "@/lib/walk-storage";

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

export function useWalk(
  userId: string | null | undefined,
  userWeightKg: number = 70,
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

  const watchIdRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  lastCoordsRef.current = lastCoords;

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
  const userWeightKgRef = useRef(userWeightKg);
  userWeightKgRef.current = userWeightKg;
  // True once the native WalkService has reported at least one live update.
  // While true, the native values are the authoritative source for
  // distance/steps and the JS fallback accumulators are paused.
  const nativeActiveRef = useRef(false);
  const lastNativeUpdateCountRef = useRef(0);
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

  // Calculate real calories based on elapsed time (MET-based formula).
  // MET_WALKING (3.5) × weight × duration_hours — recomputed from the current
  // duration on every tick, so it can never stay at 0 while a walk runs and
  // never drifts out of sync with the native service (which uses the same
  // formula on the same inputs).
  useEffect(() => {
    if (duration === 0) {
      setCalories(0);
      return;
    }
    const met = 3.5;
    const weightKg = userWeightKg || 70;
    const kcal = met * weightKg * (duration / 3600);
    setCalories((prev) => Math.max(prev, Math.round(kcal)));
  }, [duration, userWeightKg]);

  // Active Timer Loop
  useEffect(() => {
    if (status === "active") {
      timerRef.current = window.setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

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
    // ANY real progress — a GPS fix (updateCount > 0), a step (steps > 0), or
    // accumulated distance (distanceKm > 0).
    const hasProgress = data.updateCount > 0 || data.steps > 0 || data.distanceKm > 0;

    if (typeof data.isVehicleFlagged === "boolean") {
      setVehicleFlagged(data.isVehicleFlagged);
    }

    if (data.tracking && (hasProgress || data.updateCount > 0)) {
      const becameNativeActive = !nativeActiveRef.current;
      nativeActiveRef.current = true;
      setNativeTracking(true);
      lastMotionTimeRef.current = Date.now();

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
        }
      }

      setDistance((prev) => {
        // Monotonic merge — native distance is authoritative, but never move
        // backwards (native session restart vs. already-accumulated JS value).
        const nativeMeters = Math.round(data.distanceKm * 1000);
        return Math.max(prev, nativeMeters);
      });

      if (data.steps > 0) {
        setSteps((prev) => Math.max(prev, data.steps));
      }

      // The native service owns elapsed time (it uses a wall-clock reference
      // that advances while the app is backgrounded / screen-locked), so a
      // minimized app no longer freezes the duration at the last foreground
      // tick.
      if (data.durationSec > 0) {
        setDuration((prev) => Math.max(prev, data.durationSec));
      }

      if (data.calories > 0) {
        setCalories((prev) => Math.max(prev, Math.round(data.calories)));
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

    if (data.updateCount > lastNativeUpdateCountRef.current) {
      lastNativeUpdateCountRef.current = data.updateCount;
      lastMotionTimeRef.current = Date.now();
    }
  }, []);

  // Restore in-progress walk after reload. Placed after applyNativeStatus
  // (stable useCallback) so the re-arm path can reuse the native snapshot
  // sync logic.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const abandoned = await getAbandonedWalkSessions(userId);
        if (cancelled || userActedRef.current) return;
        const latest = abandoned[0];
        const restoreSession =
          latest && latest.day === todayLocalDate() && (latest.duration || 0) > 0;

        if (restoreSession) {
          setActiveSession(latest);
          setStatus("paused");
          setDuration(latest.duration || 0);
          setDistance(latest.distance || 0);
          setCalories(latest.calories || 0);
          setSteps(latest.steps || 0);
          setVehicleFlagged(!!latest.vehicle);
          const path = latest.path || [];
          setLastCoords(
            path.length > 0
              ? { lat: path[path.length - 1].lat, lng: path[path.length - 1].lng }
              : null,
          );
          abandoned.slice(1).forEach((s) => {
            cancelWalkSession(s.id, userId).catch(() => {});
          });

          // Re-arm the native foreground walk service so the recovered walk
          // keeps its OS notification and background tracking instead of
          // silently degrading to JS-only tracking. The service is started
          // PAUSED: the walk stays frozen exactly where Firestore left it
          // until the user taps Resume (matching the in-app "Walk Paused"
          // state). Native startForegroundTracking() merges the persisted
          // counters, so the dead process's freshest snapshot is never lost.
          if (isNative && !restoredRef.current) {
            restoredRef.current = true;
            try {
              const st = await WalkServicePlugin.getStatus();
              if (st && st.tracking) {
                // The OS already restarted the foreground service on its own
                // (START_STICKY + stopWithTask="false") and it kept tracking
                // in the background — it is the authoritative source, so just
                // resync the UI with its current snapshot.
                applyNativeStatus(st);
              } else {
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
                // Sync the re-armed service's (possibly fresher) persisted
                // counters into the UI.
                const st2 = await WalkServicePlugin.getStatus();
                if (st2) applyNativeStatus(st2);
              }
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
    return () => {
      cancelled = true;
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

  // Auto-pause and auto-resume monitoring loop.
  // While the native service is live we do NOT auto-pause on stale JS events:
  // the WebView is throttled in the background, but the native service keeps
  // walking (and reports via the poll above). When the native service reports
  // no new fixes for a long stretch the user genuinely stopped → auto-pause.
  useEffect(() => {
    if (status !== "active" && status !== "paused") return;

    const checkInterval = window.setInterval(() => {
      if (nativeActiveRef.current) return; // native service handles tracking
      const timeSinceMotion = Date.now() - lastMotionTimeRef.current;
      if (statusRef.current === "active" && timeSinceMotion > 12000) {
        // No movement detected for 12 seconds -> auto pause
        setStatus("paused");
        setIsAutoPaused(true);
      }
    }, 3000);

    return () => clearInterval(checkInterval);
  }, [status]);

  // Step Counter Sensor / Fallback Listener
  useEffect(() => {
    if (status !== "active") return;

    let cleanupListener: (() => void) | null = null;
    let devicemotionHandler: ((e: DeviceMotionEvent) => void) | null = null;

    const setupStepTracking = async () => {
      lastMotionTimeRef.current = Date.now();

      if (isNative) {
        try {
          const avail = await StepCounter.isAvailable();
          if (avail.available && !nativeActiveRef.current) {
            await StepCounter.startStepping();
            const listener = await StepCounter.addListener("stepEvent", (data) => {
              lastMotionTimeRef.current = Date.now();
              if (nativeActiveRef.current) return; // native steps are authoritative
              jsStepsRef.current += data.increment;
              setSteps(jsStepsRef.current);
              // Step-derived distance floor — mirrors the native rule
              // (distance = max(GPS distance, steps × stride)) so a walk with
              // poor GPS never reports 0.00 km while steps are counting.
              if (!nativeActiveRef.current) {
                setDistance((prev) => Math.max(prev, Math.round(jsStepsRef.current * 0.762)));
              }
              if (isAutoPausedRef.current) {
                setStatus("active");
                setIsAutoPaused(false);
              }
            });
            cleanupListener = () => {
              listener.remove();
              StepCounter.stopStepping().catch(() => {});
            };
            stepCleanupRef.current = cleanupListener;
            return;
          }
        } catch (err) {
          console.warn("Native step counter unavailable fallback to motion events:", err);
        }
      }

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
          // Filter out poor accuracy GPS readings (> 25 meters accuracy threshold)
          if (accuracy > 25) return;

          if (lastCoordsRef.current) {
            const distDelta = haversineDistance(
              lastCoordsRef.current.lat,
              lastCoordsRef.current.lng,
              lat,
              lng,
            );
            // Only add valid human walking speed deltas (1.2m to 25m jump)
            if (distDelta >= 1.2 && distDelta <= 25) {
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
              }
              // Keep the JS fallback trail in memory so the finished session
              // still gets a real route when native SQLite is unavailable.
              jsTrailRef.current.push({ lat, lng, ts: Date.now() });
              if (isAutoPausedRef.current) {
                setStatus("active");
                setIsAutoPaused(false);
              }
            }
          }
          setLastCoords({ lat, lng });

          // Per-fix Firestore appends are only needed on the web fallback
          // (no native SQLite to fall back on there). On Android the native
          // service persists every accepted fix in SQLite and the final path
          // is merged + saved once at finish — avoiding ~1 write per 2s.
          if (activeSession && userId && !isNative) {
            appendWalkPoint(activeSession.id, userId, { lat, lng, ts: Date.now() }).catch(() => {});
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
    if (!userId) return;
    userActedRef.current = true;
    setLoading(true);
    try {
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
      lastMotionTimeRef.current = Date.now();
      nativeActiveRef.current = false;
      setNativeTracking(false);
      setVehicleFlagged(false);
      lastNativeUpdateCountRef.current = 0;
      jsTrailRef.current = [];
      jsStepsRef.current = 0;
      gpsDistanceRef.current = 0;
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
    if (!activeSession || !userId) return null;
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
            sessionId: activeSession.id,
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
      const filteredPoints = filterGPSPoints(gpsPoints);
      const stats = computeWalkStats(filteredPoints, finalDuration);

      // Stray-session guard (see constants above): short + no real movement
      // → accidental start/stop. Cancelled below, never saved as a walk.
      const recordedDistance = stats.totalDistance || finalDistance;
      const isStraySession =
        finalDuration < STRAY_WALK_MAX_DURATION_S &&
        recordedDistance < STRAY_WALK_MAX_DISTANCE_M;

      // Encode polyline for efficient storage
      const encodedPolyline = filteredPoints.length > 0 ? encodePolyline(filteredPoints) : null;

      // Prepare start/end coordinates
      const startLat = filteredPoints.length > 0 ? filteredPoints[0].lat : null;
      const startLng = filteredPoints.length > 0 ? filteredPoints[0].lng : null;
      const endLat = filteredPoints.length > 0 ? filteredPoints[filteredPoints.length - 1].lat : null;
      const endLng = filteredPoints.length > 0 ? filteredPoints[filteredPoints.length - 1].lng : null;

      const finalCaloriesValue = Math.max(
        finalCalories,
        Math.round(3.5 * (userWeightKg || 70) * (finalDuration / 3600)),
      );

      // Create walk summary for local SQLite storage
      const now = new Date().toISOString();
      const summary: WalkSummary = {
        id: activeSession.id,
        user_id: userId,
        status: "finished",
        duration: finalDuration,
        distance: stats.totalDistance || finalDistance,
        calories: finalCaloriesValue,
        steps: finalSteps,
        avg_pace: stats.avgPace,
        elevation_gain: stats.elevationGain,
        elevation_loss: stats.elevationLoss,
        day: todayLocalDate(),
        started_at: activeSession.started_at,
        finished_at: now,
        encoded_polyline: encodedPolyline,
        start_lat: startLat,
        start_lng: startLng,
        end_lat: endLat,
        end_lng: endLng,
        photo_urls: [],
        vehicle_flagged: finalVehicleFlagged,
        created_at: activeSession.created_at,
        updated_at: now,
      };

      // Convert splits to WalkSplit format
      const splits: WalkSplit[] = stats.splits.map((split) => ({
        session_id: activeSession.id,
        split_number: split.splitNumber,
        distance: split.distance,
        duration: split.duration,
        pace: split.pace,
        elevation_change: split.elevationChange,
      }));

      // Save to local SQLite (no Firestore sync) — skipped for stray trips.
      // A stray session is cancelled in Firestore instead (same status the
      // abandoned-session cleanup already uses), so it never shows up in
      // history, never counts toward stats, and stays only as an audit log.
      if (!isStraySession) {
        try {
          await saveWalkSummary(summary, splits);
        } catch (error) {
          console.error("Failed to save walk summary locally:", error);
        }
      } else {
        cancelWalkSession(activeSession.id, userId).catch((error) =>
          console.error("Failed to cancel stray walk session:", error),
        );
      }

      // Clean up state
      setActiveSession(null);
      setStatus("idle");
      setIsAutoPaused(false);
      setDuration(0);
      setDistance(0);
      setCalories(0);
      setSteps(0);
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
        WalkServicePlugin.clearRoutePoints({ sessionId: activeSession.id }).catch(() => {});
      }

      // Stray (accidental) sessions return null — no summary modal, no
      // completion chime; the caller simply ignores the result.
      if (isStraySession) return null;

      // Create a finished session object for the callback
      const finishedSession: WalkSession = {
        ...activeSession,
        status: "finished",
        duration: finalDuration,
        distance: stats.totalDistance || finalDistance,
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
    gpsAvailable,
    nativeTracking,
    vehicleFlagged,
    loading,
    startWalk,
    pauseWalk,
    resumeWalk,
    finishWalk,
    resetWalk,
  };
}
