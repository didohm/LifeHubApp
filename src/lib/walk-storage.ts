/**
 * Local SQLite storage layer for walk summaries and splits
 * 
 * All walk history is stored locally in SQLite for maximum performance
 * and full offline support. No Firestore sync.
 */

import { registerPlugin, Capacitor } from "@capacitor/core";
import type { WalkSummary, WalkSplit, AggregatedWalkStats } from "./types";

interface WalkServicePlugin {
  saveWalkSummary(options: {
    id: string;
    user_id: string;
    status: string;
    duration: number;
    distance: number;
    calories: number;
    steps: number;
    avg_pace?: number;
    elevation_gain?: number;
    elevation_loss?: number;
    day: string;
    started_at: string;
    finished_at?: string;
    encoded_polyline?: string;
    start_lat?: number;
    start_lng?: number;
    end_lat?: number;
    end_lng?: number;
    photo_urls?: string;
    vehicle_flagged: boolean;
    created_at: string;
    updated_at: string;
  }): Promise<{ saved: boolean }>;

  saveWalkSplit(options: {
    session_id: string;
    split_number: number;
    distance: number;
    duration: number;
    pace: number;
    elevation_change?: number;
  }): Promise<{ saved: boolean }>;

  getWalkSummaries(options: {
    user_id: string;
    limit: number;
  }): Promise<{ summaries: string }>;

  getWalkSummary(options: {
    session_id: string;
  }): Promise<{ summary: string | null }>;

  getWalkSplits(options: {
    session_id: string;
  }): Promise<{ splits: string }>;

  deleteWalkSummary(options: {
    session_id: string;
  }): Promise<{ deleted: boolean }>;

  getAggregatedStats(options: {
    user_id: string;
  }): Promise<{ stats: string }>;
}

let walkServicePlugin: WalkServicePlugin | null = null;

if (Capacitor.isNativePlatform()) {
  walkServicePlugin = registerPlugin<WalkServicePlugin>("WalkService");
}

/**
 * Save a walk summary with splits to local SQLite
 */
export async function saveWalkSummary(
  summary: WalkSummary,
  splits: WalkSplit[]
): Promise<void> {
  if (!walkServicePlugin) {
    console.warn("WalkService plugin not available - skipping summary save");
    return;
  }

  try {
    // Save summary
    await walkServicePlugin.saveWalkSummary({
      id: summary.id,
      user_id: summary.user_id,
      status: summary.status,
      duration: summary.duration,
      distance: summary.distance,
      calories: summary.calories,
      steps: summary.steps,
      avg_pace: summary.avg_pace ?? undefined,
      elevation_gain: summary.elevation_gain ?? undefined,
      elevation_loss: summary.elevation_loss ?? undefined,
      day: summary.day,
      started_at: summary.started_at,
      finished_at: summary.finished_at ?? undefined,
      encoded_polyline: summary.encoded_polyline ?? undefined,
      start_lat: summary.start_lat ?? undefined,
      start_lng: summary.start_lng ?? undefined,
      end_lat: summary.end_lat ?? undefined,
      end_lng: summary.end_lng ?? undefined,
      photo_urls: JSON.stringify(summary.photo_urls),
      vehicle_flagged: summary.vehicle_flagged,
      created_at: summary.created_at,
      updated_at: summary.updated_at,
    });

    // Save splits
    for (const split of splits) {
      await walkServicePlugin.saveWalkSplit({
        session_id: split.session_id,
        split_number: split.split_number,
        distance: split.distance,
        duration: split.duration,
        pace: split.pace,
        elevation_change: split.elevation_change ?? undefined,
      });
    }
  } catch (error) {
    console.error("Error saving walk summary:", error);
    throw error;
  }
}

/**
 * Get walk summaries for a user (most recent first)
 */
export async function getWalkSummaries(
  userId: string,
  limit = 50
): Promise<WalkSummary[]> {
  if (!walkServicePlugin) {
    console.warn("WalkService plugin not available - returning empty array");
    return [];
  }

  try {
    const result = await walkServicePlugin.getWalkSummaries({
      user_id: userId,
      limit,
    });

    const summaries = JSON.parse(result.summaries);
    return summaries.map((s: any) => ({
      id: s.id,
      user_id: s.user_id,
      status: s.status,
      duration: s.duration,
      distance: s.distance,
      calories: s.calories,
      steps: s.steps,
      avg_pace: s.avg_pace ?? null,
      elevation_gain: s.elevation_gain ?? null,
      elevation_loss: s.elevation_loss ?? null,
      day: s.day,
      started_at: s.started_at,
      finished_at: s.finished_at ?? null,
      encoded_polyline: s.encoded_polyline ?? null,
      start_lat: s.start_lat ?? null,
      start_lng: s.start_lng ?? null,
      end_lat: s.end_lat ?? null,
      end_lng: s.end_lng ?? null,
      photo_urls: s.photo_urls ? JSON.parse(s.photo_urls) : [],
      vehicle_flagged: s.vehicle_flagged,
      created_at: s.created_at,
      updated_at: s.updated_at,
    }));
  } catch (error) {
    console.error("Error getting walk summaries:", error);
    return [];
  }
}

/**
 * Get a single walk summary by session ID
 */
export async function getWalkSummary(
  sessionId: string
): Promise<WalkSummary | null> {
  if (!walkServicePlugin) {
    console.warn("WalkService plugin not available");
    return null;
  }

  try {
    const result = await walkServicePlugin.getWalkSummary({
      session_id: sessionId,
    });

    if (!result.summary) return null;

    const s = JSON.parse(result.summary);
    return {
      id: s.id,
      user_id: s.user_id,
      status: s.status,
      duration: s.duration,
      distance: s.distance,
      calories: s.calories,
      steps: s.steps,
      avg_pace: s.avg_pace ?? null,
      elevation_gain: s.elevation_gain ?? null,
      elevation_loss: s.elevation_loss ?? null,
      day: s.day,
      started_at: s.started_at,
      finished_at: s.finished_at ?? null,
      encoded_polyline: s.encoded_polyline ?? null,
      start_lat: s.start_lat ?? null,
      start_lng: s.start_lng ?? null,
      end_lat: s.end_lat ?? null,
      end_lng: s.end_lng ?? null,
      photo_urls: s.photo_urls ? JSON.parse(s.photo_urls) : [],
      vehicle_flagged: s.vehicle_flagged,
      created_at: s.created_at,
      updated_at: s.updated_at,
    };
  } catch (error) {
    console.error("Error getting walk summary:", error);
    return null;
  }
}

/**
 * Get splits for a walk session
 */
export async function getWalkSplits(sessionId: string): Promise<WalkSplit[]> {
  if (!walkServicePlugin) {
    console.warn("WalkService plugin not available - returning empty array");
    return [];
  }

  try {
    const result = await walkServicePlugin.getWalkSplits({
      session_id: sessionId,
    });

    const splits = JSON.parse(result.splits);
    return splits.map((s: any) => ({
      id: s.id,
      session_id: s.session_id,
      split_number: s.split_number,
      distance: s.distance,
      duration: s.duration,
      pace: s.pace,
      elevation_change: s.elevation_change ?? null,
    }));
  } catch (error) {
    console.error("Error getting walk splits:", error);
    return [];
  }
}

/**
 * Delete a walk summary and its splits
 */
export async function deleteWalkSummary(sessionId: string): Promise<void> {
  if (!walkServicePlugin) {
    console.warn("WalkService plugin not available");
    return;
  }

  try {
    await walkServicePlugin.deleteWalkSummary({
      session_id: sessionId,
    });
  } catch (error) {
    console.error("Error deleting walk summary:", error);
    throw error;
  }
}

/**
 * Get aggregated stats across all walks for a user
 */
export async function getAggregatedStats(
  userId: string
): Promise<AggregatedWalkStats> {
  if (!walkServicePlugin) {
    console.warn("WalkService plugin not available - returning zero stats");
    return {
      total_walks: 0,
      total_distance: 0,
      total_duration: 0,
      total_steps: 0,
      avg_pace: null,
      longest_distance: null,
      fastest_pace: null,
    };
  }

  try {
    const result = await walkServicePlugin.getAggregatedStats({
      user_id: userId,
    });

    const stats = JSON.parse(result.stats);
    return {
      total_walks: stats.total_walks ?? 0,
      total_distance: stats.total_distance ?? 0,
      total_duration: stats.total_duration ?? 0,
      total_steps: stats.total_steps ?? 0,
      avg_pace: stats.avg_pace ?? null,
      longest_distance: stats.longest_distance ?? null,
      fastest_pace: stats.fastest_pace ?? null,
    };
  } catch (error) {
    console.error("Error getting aggregated stats:", error);
    return {
      total_walks: 0,
      total_distance: 0,
      total_duration: 0,
      total_steps: 0,
      avg_pace: null,
      longest_distance: null,
      fastest_pace: null,
    };
  }
}

/**
 * Get weekly stats (7 days from startDate)
 */
export async function getWeeklyStats(
  userId: string,
  startDate: string
): Promise<{ distance: number; duration: number; walks: number }> {
  const allSummaries = await getWalkSummaries(userId, 1000);
  
  const startTime = new Date(startDate).getTime();
  const endTime = startTime + 7 * 24 * 60 * 60 * 1000;

  const weekSummaries = allSummaries.filter((s) => {
    const walkTime = new Date(s.day).getTime();
    return walkTime >= startTime && walkTime < endTime && s.status === "finished";
  });

  return {
    distance: weekSummaries.reduce((sum, s) => sum + s.distance, 0),
    duration: weekSummaries.reduce((sum, s) => sum + s.duration, 0),
    walks: weekSummaries.length,
  };
}

/**
 * Get monthly stats (YYYY-MM format)
 */
export async function getMonthlyStats(
  userId: string,
  month: string
): Promise<{ distance: number; duration: number; walks: number }> {
  const allSummaries = await getWalkSummaries(userId, 1000);
  
  const monthSummaries = allSummaries.filter(
    (s) => s.day.startsWith(month) && s.status === "finished"
  );

  return {
    distance: monthSummaries.reduce((sum, s) => sum + s.distance, 0),
    duration: monthSummaries.reduce((sum, s) => sum + s.duration, 0),
    walks: monthSummaries.length,
  };
}
