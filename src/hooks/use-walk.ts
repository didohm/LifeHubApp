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
import { WalkSession } from "@/lib/types";
import {
  Notifications,
  WalkServicePlugin,
  WalkStatusUpdate,
} from "@/lib/notifications-integration";

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

export function useWalk(userId: string | null | undefined, userWeightKg: number = 70) {
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

  const watchIdRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  lastCoordsRef.current = lastCoords;

  const userActedRef = useRef(false);
  const lastMotionTimeRef = useRef<number>(Date.now());
  const lastStepTimeRef = useRef<number>(0);
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
  const finishWalkRef = useRef<(() => void) | null>(null);
  const isAutoPausedRef = useRef(isAutoPaused);
  isAutoPausedRef.current = isAutoPaused;
  const isNative = Capacitor.isNativePlatform();

  // Calculate real calories based on distance, steps, and weight
  useEffect(() => {
    if (distance === 0 && steps === 0) {
      setCalories(0);
      return;
    }
    // ACSM formula for walking energy expenditure:
    // Calories from distance (km * weight * 0.57) + Calories per step (~0.04 kcal/step)
    const km = distance / 1000;
    const distanceCal = km * userWeightKg * 0.57;
    const stepCal = steps * 0.04;
    setCalories(Math.round(distanceCal + stepCal));
  }, [distance, steps, userWeightKg]);

  // Restore in-progress walk after reload
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
          const path = latest.path || [];
          setLastCoords(
            path.length > 0
              ? { lat: path[path.length - 1].lat, lng: path[path.length - 1].lng }
              : null,
          );
          abandoned.slice(1).forEach((s) => {
            cancelWalkSession(s.id, userId).catch(() => {});
          });
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
  }, [userId]);

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

    // The native foreground notification exposes Pause/Finish action buttons.
    // The service republishes a walkUpdate carrying `action` when the user
    // taps one, so the React session reacts in lock-step with the native
    // service (single source of truth — no duplicate/divergent state).
    if (data.action === "finish" && statusRef.current === "active") {
      finishWalkRef.current?.();
      return;
    }
    if (data.action === "pause" && statusRef.current === "active") {
      pauseWalkRef.current?.();
      return;
    }

    // The native service is the single source of truth the moment it reports
    // ANY real progress — a GPS fix (updateCount > 0), a step (steps > 0), or
    // accumulated distance (distanceKm > 0). Previously we required
    // updateCount > 0, so without a GPS lock steps were detected natively but
    // the UI stayed stuck at 0.00 km.
    const hasProgress = data.updateCount > 0 || data.steps > 0 || data.distanceKm > 0;

    if (data.tracking && (hasProgress || data.updateCount > 0)) {
      nativeActiveRef.current = true;
      setNativeTracking(true);
      lastMotionTimeRef.current = Date.now();

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
  // notification on every fix/step/tick, but when it runs without motion
  // data (no GPS lock, no step sensor) the app keeps counting in JS while
  // the native counter would sit at 0.00 km. While the JS fallback is the
  // active source, push the app's counters into the native service every
  // second (monotonic merge) and refresh the JS fallback notification, so
  // the OS notification always mirrors what the app shows.
  useEffect(() => {
    if (!isNative || status !== "active") return;
    const push = () => {
      if (nativeActiveRef.current) return;
      Notifications.updateWalkForeground(distance / 1000, steps, duration, calories, 0);
    };
    push();
    const id = window.setInterval(push, 1000);
    return () => clearInterval(id);
  }, [isNative, status, distance, steps, duration, calories]);

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
              setSteps((prev) => prev + data.increment);
              if (isAutoPausedRef.current) {
                setStatus("active");
                setIsAutoPaused(false);
              }
            });
            cleanupListener = () => {
              listener.remove();
              StepCounter.stopStepping().catch(() => {});
            };
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
          setSteps((prev) => prev + 1);
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
      }
    };

    setupStepTracking();

    return () => {
      if (cleanupListener) cleanupListener();
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
                setDistance((prev) => Math.round(prev + distDelta));
              }
              if (isAutoPausedRef.current) {
                setStatus("active");
                setIsAutoPaused(false);
              }
            }
          }
          setLastCoords({ lat, lng });

          if (activeSession && userId) {
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
  }, [status, activeSession, userId]);

  // Start Walk Session
  const startWalk = useCallback(async () => {
    if (!userId) return;
    userActedRef.current = true;
    setLoading(true);
    try {
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
      lastNativeUpdateCountRef.current = 0;
      // Persistent OS-level foreground notification in Android Control Center.
      // The native WalkService becomes the source of truth from here on and
      // streams "walkUpdate" events + poll snapshots back to this hook.
      Notifications.startWalkForeground(0, 0, 0, 0, 0);
    } catch (e) {
      console.error("Failed to start walk session:", e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

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
    Notifications.resumeWalkForeground(distance / 1000, steps, duration, calories, 0);
    try {
      await updateWalkSession(activeSession.id, userId, { status: "active" });
    } catch (e) {
      console.error("Failed to resume walk session:", e);
    }
  }, [activeSession, userId, distance, steps, duration, calories]);

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
          }
        } catch (e) {
          /* fall back to JS values */
        }
      }

      await updateWalkSession(activeSession.id, userId, {
        duration: finalDuration,
        distance: finalDistance,
        calories:
          finalDistance > 0 || finalSteps > 0
            ? Math.round((finalDistance / 1000) * userWeightKg * 0.57 + finalSteps * 0.04)
            : calories,
        steps: finalSteps,
      });
      const finished = await finishWalkSession(activeSession.id, userId);
      setActiveSession(null);
      setStatus("idle");
      setIsAutoPaused(false);
      setDuration(0);
      setDistance(0);
      setCalories(0);
      setSteps(0);
      setLastCoords(null);
      nativeActiveRef.current = false;
      setNativeTracking(false);
      Notifications.stopWalkForeground();
      return finished;
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
    calories,
    steps,
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
    nativeActiveRef.current = false;
    setNativeTracking(false);
    Notifications.stopWalkForeground();
  }, []);

  // Keep the native-action refs pointed at the latest callbacks.
  useEffect(() => {
    pauseWalkRef.current = pauseWalk;
    finishWalkRef.current = finishWalk;
  }, [pauseWalk, finishWalk]);

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
    loading,
    startWalk,
    pauseWalk,
    resumeWalk,
    finishWalk,
    resetWalk,
  };
}
