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
import { Notifications, WalkServicePlugin, WalkStatusUpdate } from "@/lib/notifications-integration";

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

    if (data.updateCount > 0) {
      // A real native location fix exists → native values become the single
      // source of truth for the session metrics (they keep counting in the
      // background even when the WebView JS is throttled).
      nativeActiveRef.current = true;
      setNativeTracking(data.tracking);
      lastMotionTimeRef.current = Date.now();
      if (typeof data.distanceKm === "number") {
        setDistance(Math.round(data.distanceKm * 1000));
      }
      if (typeof data.steps === "number" && data.steps > 0) {
        // Monotonic merge: never step backwards even if the native session
        // was restarted while the JS accumulated a few fallback steps.
        setSteps((prev) => Math.max(prev, data.steps as number));
      }
      if (data.accuracy !== undefined) {
        setGpsAvailable(data.accuracy <= 30);
      }
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

  // Periodic status poll — covers WebView suspension gaps and event loss.
  useEffect(() => {
    if (!isNative || status !== "active") return;
    const poll = window.setInterval(async () => {
      try {
        const data = await WalkServicePlugin.getStatus();
        if (data && data.tracking) applyNativeStatus(data);
      } catch (e) {
        // Service may not be running (e.g. web or device without location)
      }
    }, 4000);
    return () => clearInterval(poll);
  }, [isNative, status, applyNativeStatus]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      Notifications.startWalkForeground(0, 0);
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
    Notifications.stopWalkForeground();
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
    // Pass the saved session baseline so the native service continues from it.
    Notifications.startWalkForeground(distance / 1000, steps);
    try {
      await updateWalkSession(activeSession.id, userId, { status: "active" });
    } catch (e) {
      console.error("Failed to resume walk session:", e);
    }
  }, [activeSession, userId, distance, steps]);

  // Finish Walk Session
  const finishWalk = useCallback(async () => {
    if (!activeSession || !userId) return null;
    userActedRef.current = true;
    setLoading(true);
    try {
      // Pull the latest native snapshot before saving so the recorded
      // distance/steps match what the foreground service accumulated.
      let finalDistance = distance;
      let finalSteps = steps;
      if (isNative) {
        try {
          const data = await WalkServicePlugin.getStatus();
          if (data && data.tracking) {
            applyNativeStatus(data);
            if (typeof data.distanceKm === "number" && data.distanceKm > 0) {
              finalDistance = Math.round(data.distanceKm * 1000);
            }
            if (typeof data.steps === "number" && data.steps > 0) {
              finalSteps = data.steps;
            }
          }
        } catch (e) {
          /* fall back to JS values */
        }
      }

      await updateWalkSession(activeSession.id, userId, {
        duration,
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
  }, [activeSession, userId, duration, distance, calories, steps, isNative, userWeightKg, applyNativeStatus]);

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