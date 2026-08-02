import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  getTodayWaterLog,
  addWaterGlass,
  removeWaterGlass,
  setWaterGoal,
  DEFAULT_WATER_GOAL,
} from "./api";
import { WaterLog } from "./types";

/**
 * Hydration hook backed by Firestore.
 *
 * - Shows today's progress only (a document keyed by the local date).
 * - Resets automatically at the start of a new local day because no
 *   document exists yet → glasses default to 0. Past days are kept in
 *   the database for analytics (see getWaterLogs / streak).
 * - Polls for day rollover while the app is open so the UI updates
 *   without user interaction.
 */
export function useHydration(userId: string | null | undefined) {
  const [log, setLog] = useState<WaterLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const todayKeyRef = useRef<string>("");
  const userIdRef = useRef<string | null | undefined>(userId);
  userIdRef.current = userId;

  const fetchToday = useCallback(async (silent = false) => {
    const uid = userIdRef.current;
    if (!uid) {
      setLog(null);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const todayLog = await getTodayWaterLog(uid);
      setLog(todayLog);
    } catch (err) {
      console.error("Failed to load today water log:", err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Initial load + refresh whenever userId changes
  useEffect(() => {
    fetchToday();
  }, [userId, fetchToday]);

  // Day-rollover detection: when the local date changes, refresh so the
  // UI resets to the new (empty) day automatically.
  useEffect(() => {
    const checkRollover = () => {
      const key = localDayKey(new Date());
      if (todayKeyRef.current && todayKeyRef.current !== key) {
        fetchToday(true);
      }
      todayKeyRef.current = key;
    };
    todayKeyRef.current = localDayKey(new Date());
    const interval = window.setInterval(checkRollover, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkRollover();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchToday]);

  const add = useCallback(async (amount = 1) => {
    const uid = userIdRef.current;
    if (!uid) return;
    setBusy(true);
    try {
      const updated = await addWaterGlass(uid, amount);
      setLog(updated);
    } finally {
      setBusy(false);
    }
  }, []);

  const remove = useCallback(async (amount = 1) => {
    const uid = userIdRef.current;
    if (!uid) return;
    setBusy(true);
    try {
      const updated = await removeWaterGlass(uid, amount);
      setLog(updated);
    } finally {
      setBusy(false);
    }
  }, []);

  const updateGoal = useCallback(
    async (goal: number) => {
      const uid = userIdRef.current;
      if (!uid) return;
      setBusy(true);
      try {
        await setWaterGoal(uid, goal);
        await fetchToday(true);
      } finally {
        setBusy(false);
      }
    },
    [fetchToday],
  );

  const glasses = log?.glasses ?? 0;
  const goal = log?.goal ?? DEFAULT_WATER_GOAL;
  const pct = goal > 0 ? Math.min(100, Math.round((glasses / goal) * 100)) : 0;

  return {
    glasses,
    goal,
    pct,
    goalReached: log?.goal_reached ?? false,
    loading,
    busy,
    addWater: add,
    removeWater: remove,
    setGoal: updateGoal,
    refresh: () => fetchToday(true),
  };
}

function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
