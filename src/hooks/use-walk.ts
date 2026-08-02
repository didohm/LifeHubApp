import { useState, useEffect, useRef, useCallback } from "react";
import {
  createWalkSession,
  updateWalkSession,
  finishWalkSession,
  appendWalkPoint,
  estimateWalkCalories,
} from "@/lib/api";
import { WalkSession } from "@/lib/types";

// Helper: Calculate distance between 2 coordinates in meters (Haversine Formula)
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
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

export function useWalk(userId: string | null | undefined) {
  const [activeSession, setActiveSession] = useState<WalkSession | null>(null);
  const [status, setStatus] = useState<"idle" | "active" | "paused" | "finished">("idle");
  const [duration, setDuration] = useState(0); // in seconds
  const [distance, setDistance] = useState(0); // in meters
  const [calories, setCalories] = useState(0);
  const [steps, setSteps] = useState(0);
  const [gpsAvailable, setGpsAvailable] = useState<boolean | null>(null);
  const [lastCoords, setLastCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  lastCoordsRef.current = lastCoords;

  // Sync calories & steps with duration/distance in a single pass
  useEffect(() => {
    if (status === "active" || status === "paused") {
      const estimatedCal = estimateWalkCalories(distance, duration);
      const estimatedSteps = Math.round(distance > 0 ? distance / 0.75 : duration * 1.6);
      setCalories(estimatedCal);
      setSteps(estimatedSteps);
    }
  }, [distance, duration, status]);

  // Active Timer Loop
  useEffect(() => {
    if (status === "active") {
      timerRef.current = window.setInterval(() => {
        setDuration((prev) => prev + 1);

        // Fallback distance calculation if GPS not actively moving (e.g. treadmill / device without GPS movement)
        if (!lastCoordsRef.current) {
          setDistance((prev) => prev + 1.25); // ~1.25 meters per sec average walking pace
        }
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  // GPS Geolocation Watcher
  useEffect(() => {
    if (status === "active" && typeof window !== "undefined" && "geolocation" in navigator) {
      setGpsAvailable(true);
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude: lat, longitude: lng, accuracy } = pos.coords;
          // Filter out low accuracy GPS noise (> 35 meters accuracy threshold)
          if (accuracy > 35) return;

          if (lastCoordsRef.current) {
            const distDelta = haversineDistance(
              lastCoordsRef.current.lat,
              lastCoordsRef.current.lng,
              lat,
              lng
            );
            // Only add reasonable GPS step delta (ignore huge jumps or static jitter < 1.5m)
            if (distDelta >= 1.5 && distDelta <= 20) {
              setDistance((prev) => Math.round(prev + distDelta));
            }
          }
          setLastCoords({ lat, lng });

          // Append point if session exists
          if (activeSession && userId) {
            appendWalkPoint(activeSession.id, userId, { lat, lng, ts: Date.now() }).catch(() => {});
          }
        },
        (err) => {
          console.warn("Geolocation warning/unavailable:", err.message);
          setGpsAvailable(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 }
      );
    } else {
      if (watchIdRef.current !== null && typeof window !== "undefined" && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    }
    return () => {
      if (watchIdRef.current !== null && typeof window !== "undefined" && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [status, activeSession, userId]);

  // Start Walk Session
  const startWalk = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const session = await createWalkSession(userId);
      setActiveSession(session);
      setStatus("active");
      setDuration(0);
      setDistance(0);
      setCalories(0);
      setSteps(0);
      setLastCoords(null);
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
    try {
      await updateWalkSession(activeSession.id, userId, { status: "active" });
    } catch (e) {
      console.error("Failed to resume walk session:", e);
    }
  }, [activeSession, userId]);

  // Finish Walk Session
  const finishWalk = useCallback(async () => {
    if (!activeSession || !userId) return null;
    setLoading(true);
    try {
      await updateWalkSession(activeSession.id, userId, {
        duration,
        distance,
        calories,
        steps,
      });
      const finished = await finishWalkSession(activeSession.id, userId);
      setStatus("finished");
      setActiveSession(null);
      return finished;
    } catch (e) {
      console.error("Failed to finish walk session:", e);
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeSession, userId, duration, distance, calories, steps]);

  // Reset to idle
  const resetWalk = useCallback(() => {
    setStatus("idle");
    setActiveSession(null);
    setDuration(0);
    setDistance(0);
    setCalories(0);
    setSteps(0);
    setLastCoords(null);
  }, []);

  return {
    activeSession,
    status,
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
    resetWalk,
  };
}
