package com.lifehub.app;

import android.content.Intent;
import android.os.Build;
import android.app.ActivityManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

/**
 * Bridge between the React app and the native {@link WalkService}.
 *
 * startService / updateService / pauseService / resumeService / stopService
 * drive the foreground walk service. getStatus returns a live snapshot of the
 * running service, and publish() emits "walkUpdate" events to JS whenever the
 * native service computes a new location fix, step, or 1s tick.
 */
@CapacitorPlugin(name = "WalkService")
public class WalkServicePlugin extends Plugin {

    private static WalkServicePlugin instance;

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    @Override
    public void handleOnDestroy() {
        super.handleOnDestroy();
        if (this == instance) instance = null;
    }

    /** Re-publish the current state when the app returns to the foreground. */
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (WalkService.isTracking) {
            WalkServicePlugin.publish(
                    WalkService.currentDistanceKm,
                    WalkService.currentSteps,
                    WalkService.lastLocation,
                    WalkService.isTracking,
                    WalkService.paused,
                    WalkService.durationSec,
                    WalkService.currentCalories,
                    WalkService.currentPace,
                    WalkService.updateCount,
                    System.currentTimeMillis(),
                    null,
                    WalkService.activeSessionId,
                    WalkService.isVehicleFlagged
            );
        }
    }

    /** Emit the current native tracking state to the JS listeners. */
    static void publish(
            double distanceKm,
            int steps,
            android.location.Location location,
            boolean tracking,
            boolean paused,
            long durationSec,
            double calories,
            double pace,
            int updateCount,
            long timestamp,
            String action,
            String sessionId,
            boolean isVehicleFlagged
    ) {
        WalkServicePlugin p = instance;
        if (p == null) return;
        try {
            p.notifyListeners("walkUpdate", buildStatus(distanceKm, steps, location, tracking, paused,
                    durationSec, calories, pace, updateCount, timestamp, action, sessionId, isVehicleFlagged));
        } catch (Exception e) {
            android.util.Log.d("WalkServicePlugin", "Bridge unavailable for walkUpdate event (app may be mid-teardown)", e);
        }
    }
    
    /**
     * P4.2: Publishes health status to JS app for monitoring.
     * Emits "walkHealthUpdate" event with detailed system health.
     */
    static void publishHealth(String healthJson) {
        WalkServicePlugin p = instance;
        if (p == null) return;
        try {
            JSObject health = new JSObject(healthJson);
            p.notifyListeners("walkHealthUpdate", health);
        } catch (Exception e) {
            android.util.Log.d("WalkServicePlugin", "Failed to publish health update", e);
        }
    }

    private static JSObject buildStatus(
            double distanceKm,
            int steps,
            android.location.Location location,
            boolean tracking,
            boolean paused,
            long durationSec,
            double calories,
            double pace,
            int updateCount,
            long timestamp,
            String action,
            String sessionId,
            boolean isVehicleFlagged
    ) {
        JSObject ret = new JSObject();
        ret.put("tracking", tracking);
        ret.put("paused", paused);
        ret.put("distanceKm", distanceKm);
        ret.put("steps", steps);
        ret.put("durationSec", durationSec);
        ret.put("calories", calories);
        ret.put("paceMinPerKm", pace);
        ret.put("updateCount", updateCount);
        ret.put("timestamp", timestamp);
        ret.put("sessionId", sessionId != null ? sessionId : WalkService.activeSessionId);
        ret.put("isVehicleFlagged", isVehicleFlagged);
        if (action != null) ret.put("action", action);
        if (location != null) {
            ret.put("latitude", location.getLatitude());
            ret.put("longitude", location.getLongitude());
            ret.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : 0f);
            ret.put("speed", location.hasSpeed() ? location.getSpeed() : 0f);
        } else {
            ret.put("latitude", 0.0);
            ret.put("longitude", 0.0);
            ret.put("accuracy", 0f);
            ret.put("speed", 0f);
        }
        return ret;
    }

    @PluginMethod
    public void startService(PluginCall call) {
        JSObject ret = new JSObject();
        if (WalkService.isTracking && !WalkService.paused) {
            ret.put("started", true);
            call.resolve(ret);
            return;
        }

        String sessionId = call.getString("sessionId", "current_session");
        boolean startPaused = call.getBoolean("paused", false);
        Double distanceKmObj = call.getDouble("distanceKm", 0.0);
        Integer stepsObj = call.getInt("steps", 0);
        Long durationObj = call.getLong("durationSec", 0L);
        Double caloriesObj = call.getDouble("calories", 0.0);
        Double paceObj = call.getDouble("paceMinPerKm", 0.0);
        Double weightKgObj = call.getDouble("weightKg", 0.0);
        double distanceKm = distanceKmObj != null ? distanceKmObj : 0.0;
        int steps = stepsObj != null ? stepsObj : 0;
        long duration = durationObj != null ? durationObj : 0L;
        double calories = caloriesObj != null ? caloriesObj : 0.0;
        double pace = paceObj != null ? paceObj : 0.0;
        double weightKg = weightKgObj != null ? weightKgObj : 0.0;

        try {
            Intent intent = new Intent(getContext(), WalkService.class);
            intent.setAction(WalkService.ACTION_START);
            intent.putExtra(WalkService.EXTRA_SESSION_ID, sessionId);
            intent.putExtra(WalkService.EXTRA_PAUSED, startPaused);
            intent.putExtra(WalkService.EXTRA_DISTANCE_KM, distanceKm);
            intent.putExtra(WalkService.EXTRA_STEPS, steps);
            intent.putExtra(WalkService.EXTRA_DURATION_SEC, duration);
            intent.putExtra(WalkService.EXTRA_CALORIES, calories);
            intent.putExtra(WalkService.EXTRA_PACE, pace);
            intent.putExtra(WalkService.EXTRA_WEIGHT_KG, weightKg);
            startServiceSafe(intent);
            ret.put("started", true);
        } catch (Exception e) {
            ret.put("started", false);
            ret.put("error", e.getMessage());
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void updateService(PluginCall call) {
        Double distanceKmObj = call.getDouble("distanceKm", 0.0);
        Integer stepsObj = call.getInt("steps", 0);
        Long durationObj = call.getLong("durationSec", 0L);
        Double caloriesObj = call.getDouble("calories", 0.0);
        Double paceObj = call.getDouble("paceMinPerKm", 0.0);
        Double weightKgObj = call.getDouble("weightKg", 0.0);
        double distanceKm = distanceKmObj != null ? distanceKmObj : 0.0;
        int steps = stepsObj != null ? stepsObj : 0;
        long duration = durationObj != null ? durationObj : 0L;
        double calories = caloriesObj != null ? caloriesObj : 0.0;
        double pace = paceObj != null ? paceObj : 0.0;
        double weightKg = weightKgObj != null ? weightKgObj : 0.0;

        try {
            Intent intent = new Intent(getContext(), WalkService.class);
            intent.setAction(WalkService.ACTION_UPDATE);
            intent.putExtra(WalkService.EXTRA_DISTANCE_KM, distanceKm);
            intent.putExtra(WalkService.EXTRA_STEPS, steps);
            intent.putExtra(WalkService.EXTRA_DURATION_SEC, duration);
            intent.putExtra(WalkService.EXTRA_CALORIES, calories);
            intent.putExtra(WalkService.EXTRA_PACE, pace);
            intent.putExtra(WalkService.EXTRA_WEIGHT_KG, weightKg);
            getContext().startService(intent);
        } catch (Exception e) {
            android.util.Log.w("WalkServicePlugin", "Failed to update service", e);
        }

        JSObject ret = new JSObject();
        ret.put("updated", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void pauseService(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), WalkService.class);
            intent.setAction(WalkService.ACTION_PAUSE);
            getContext().startService(intent);
        } catch (Exception e) {
            android.util.Log.w("WalkServicePlugin", "Failed to pause service", e);
        }
        JSObject ret = new JSObject();
        ret.put("paused", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void resumeService(PluginCall call) {
        Double distanceKmObj = call.getDouble("distanceKm", 0.0);
        Integer stepsObj = call.getInt("steps", 0);
        Long durationObj = call.getLong("durationSec", 0L);
        Double caloriesObj = call.getDouble("calories", 0.0);
        Double paceObj = call.getDouble("paceMinPerKm", 0.0);
        Double weightKgObj = call.getDouble("weightKg", 0.0);
        double distanceKm = distanceKmObj != null ? distanceKmObj : 0.0;
        int steps = stepsObj != null ? stepsObj : 0;
        long duration = durationObj != null ? durationObj : 0L;
        double calories = caloriesObj != null ? caloriesObj : 0.0;
        double pace = paceObj != null ? paceObj : 0.0;
        double weightKg = weightKgObj != null ? weightKgObj : 0.0;

        try {
            Intent intent = new Intent(getContext(), WalkService.class);
            intent.setAction(WalkService.ACTION_RESUME);
            intent.putExtra(WalkService.EXTRA_DISTANCE_KM, distanceKm);
            intent.putExtra(WalkService.EXTRA_STEPS, steps);
            intent.putExtra(WalkService.EXTRA_DURATION_SEC, duration);
            intent.putExtra(WalkService.EXTRA_CALORIES, calories);
            intent.putExtra(WalkService.EXTRA_PACE, pace);
            intent.putExtra(WalkService.EXTRA_WEIGHT_KG, weightKg);
            getContext().startService(intent);
        } catch (Exception e) {
            android.util.Log.w("WalkServicePlugin", "Failed to resume service", e);
        }
        JSObject ret = new JSObject();
        ret.put("resumed", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), WalkService.class);
            intent.setAction(WalkService.ACTION_STOP);
            getContext().startService(intent);
        } catch (Exception e) {
            android.util.Log.w("WalkServicePlugin", "Failed to stop service", e);
        }
        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(buildStatus(
                WalkService.currentDistanceKm,
                WalkService.currentSteps,
                WalkService.lastLocation,
                WalkService.isTracking,
                WalkService.paused,
                WalkService.durationSec,
                WalkService.currentCalories,
                WalkService.currentPace,
                WalkService.updateCount,
                System.currentTimeMillis(),
                null,
                WalkService.activeSessionId,
                WalkService.isVehicleFlagged
        ));
    }

    @PluginMethod
    public void getRoutePoints(PluginCall call) {
        String sessionId = call.getString("sessionId", WalkService.activeSessionId);
        WalkDatabaseHelper db = WalkDatabaseHelper.getInstance(getContext());
        JSONArray points = db.getPointsJsonForSession(sessionId);
        boolean isVehicle = db.isVehicleFlagged(sessionId);

        JSObject ret = new JSObject();
        ret.put("sessionId", sessionId);
        ret.put("isVehicleFlagged", isVehicle);
        ret.put("points", points.toString());
        call.resolve(ret);
    }

    @PluginMethod
    public void clearRoutePoints(PluginCall call) {
        String sessionId = call.getString("sessionId", WalkService.activeSessionId);
        WalkDatabaseHelper db = WalkDatabaseHelper.getInstance(getContext());
        db.clearPointsForSession(sessionId);

        JSObject ret = new JSObject();
        ret.put("cleared", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void saveWalkSummary(PluginCall call) {
        try {
            WalkDatabaseHelper db = WalkDatabaseHelper.getInstance(getContext());
            
            String id = call.getString("id");
            String userId = call.getString("user_id");
            String status = call.getString("status", "finished");
            int duration = call.getInt("duration", 0);
            double distance = call.getDouble("distance", 0.0);
            double calories = call.getDouble("calories", 0.0);
            int steps = call.getInt("steps", 0);
            Double avgPace = call.getDouble("avg_pace");
            Double elevationGain = call.getDouble("elevation_gain");
            Double elevationLoss = call.getDouble("elevation_loss");
            String day = call.getString("day");
            String startedAt = call.getString("started_at");
            String finishedAt = call.getString("finished_at");
            String encodedPolyline = call.getString("encoded_polyline");
            Double startLat = call.getDouble("start_lat");
            Double startLng = call.getDouble("start_lng");
            Double endLat = call.getDouble("end_lat");
            Double endLng = call.getDouble("end_lng");
            String photoUrls = call.getString("photo_urls", "[]");
            boolean vehicleFlagged = call.getBoolean("vehicle_flagged", false);
            String createdAt = call.getString("created_at");
            String updatedAt = call.getString("updated_at");

            db.insertWalkSummary(id, userId, status, duration, distance, calories, steps,
                    avgPace, elevationGain, elevationLoss, day, startedAt, finishedAt,
                    encodedPolyline, startLat, startLng, endLat, endLng, photoUrls,
                    vehicleFlagged, createdAt, updatedAt);

            JSObject ret = new JSObject();
            ret.put("saved", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to save walk summary", e);
        }
    }

    @PluginMethod
    public void saveWalkSplit(PluginCall call) {
        try {
            WalkDatabaseHelper db = WalkDatabaseHelper.getInstance(getContext());
            
            String sessionId = call.getString("session_id");
            int splitNumber = call.getInt("split_number", 0);
            double distance = call.getDouble("distance", 0.0);
            int duration = call.getInt("duration", 0);
            double pace = call.getDouble("pace", 0.0);
            Double elevationChange = call.getDouble("elevation_change");

            db.insertWalkSplit(sessionId, splitNumber, distance, duration, pace, elevationChange);

            JSObject ret = new JSObject();
            ret.put("saved", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to save walk split", e);
        }
    }

    @PluginMethod
    public void getWalkSummaries(PluginCall call) {
        try {
            String userId = call.getString("user_id");
            int limit = call.getInt("limit", 50);
            
            WalkDatabaseHelper db = WalkDatabaseHelper.getInstance(getContext());
            JSONArray summaries = db.getWalkSummaries(userId, limit);

            JSObject ret = new JSObject();
            ret.put("summaries", summaries.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to get walk summaries", e);
        }
    }

    @PluginMethod
    public void getWalkSummary(PluginCall call) {
        try {
            String sessionId = call.getString("session_id");
            
            WalkDatabaseHelper db = WalkDatabaseHelper.getInstance(getContext());
            org.json.JSONObject summary = db.getWalkSummary(sessionId);

            JSObject ret = new JSObject();
            if (summary != null) {
                ret.put("summary", summary.toString());
            } else {
                ret.put("summary", (String) null);
            }
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to get walk summary", e);
        }
    }

    @PluginMethod
    public void getWalkSplits(PluginCall call) {
        try {
            String sessionId = call.getString("session_id");
            
            WalkDatabaseHelper db = WalkDatabaseHelper.getInstance(getContext());
            JSONArray splits = db.getWalkSplits(sessionId);

            JSObject ret = new JSObject();
            ret.put("splits", splits.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to get walk splits", e);
        }
    }

    @PluginMethod
    public void deleteWalkSummary(PluginCall call) {
        try {
            String sessionId = call.getString("session_id");
            
            WalkDatabaseHelper db = WalkDatabaseHelper.getInstance(getContext());
            db.deleteWalkSummary(sessionId);

            JSObject ret = new JSObject();
            ret.put("deleted", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to delete walk summary", e);
        }
    }

    @PluginMethod
    public void getAggregatedStats(PluginCall call) {
        try {
            String userId = call.getString("user_id");
            
            WalkDatabaseHelper db = WalkDatabaseHelper.getInstance(getContext());
            org.json.JSONObject stats = db.getAggregatedStats(userId);

            JSObject ret = new JSObject();
            ret.put("stats", stats.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to get aggregated stats", e);
        }
    }
    
    /**
     * P4.1: Retrieves diagnostic logs for debugging.
     * Returns last 100 log entries with timestamps, categories, levels, and messages.
     */
    @PluginMethod
    public void getDiagnosticLogs(PluginCall call) {
        try {
            String category = call.getString("category"); // Optional filter
            String level = call.getString("level"); // Optional filter
            
            WalkDiagnostics diagnostics = new WalkDiagnostics(getContext());
            JSONArray logs;
            
            if (category != null && !category.isEmpty()) {
                logs = diagnostics.getLogsByCategory(category);
            } else if (level != null && !level.isEmpty()) {
                logs = diagnostics.getLogsByLevel(level);
            } else {
                logs = diagnostics.getLogs();
            }
            
            JSObject ret = new JSObject();
            ret.put("logs", logs.toString());
            ret.put("count", logs.length());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to get diagnostic logs", e);
        }
    }
    
    /**
     * P4.1: Clears all diagnostic logs.
     */
    @PluginMethod
    public void clearDiagnosticLogs(PluginCall call) {
        try {
            WalkDiagnostics diagnostics = new WalkDiagnostics(getContext());
            diagnostics.clearLogs();
            
            JSObject ret = new JSObject();
            ret.put("cleared", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to clear diagnostic logs", e);
        }
    }

    /**
     * P3.1: Safe service start with Android 12+ foreground service launch restrictions.
     * Checks if app is in foreground before attempting startForegroundService().
     * On Android 12+, starting foreground service from background throws
     * ForegroundServiceStartNotAllowedException.
     */
    private void startServiceSafe(Intent intent) {
        try {
            // P3.1: Check if app is in foreground on Android 12+
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) { // API 31 (Android 12)
                if (!isAppInForeground()) {
                    android.util.Log.w("WalkServicePlugin", "App not in foreground on Android 12+, cannot start foreground service");
                    // Notify JS app to bring app to foreground first
                    if (instance != null) {
                        JSObject result = new JSObject();
                        result.put("started", false);
                        result.put("error", "app_not_in_foreground");
                        result.put("message", "Android 12+ requires app to be in foreground to start walk tracking");
                        instance.notifyListeners("walkUpdate", result);
                    }
                    return;
                }
            }
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
        } catch (Exception e) {
            android.util.Log.w("WalkServicePlugin", "Failed to start foreground service: " + e.getClass().getSimpleName(), e);
            
            // On Android 12+, this might be ForegroundServiceStartNotAllowedException
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                android.util.Log.e("WalkServicePlugin", "Foreground service launch restricted on Android 12+, app must be in foreground");
                if (instance != null) {
                    JSObject result = new JSObject();
                    result.put("started", false);
                    result.put("error", "foreground_service_restricted");
                    instance.notifyListeners("walkUpdate", result);
                }
                return;
            }
            
            // Pre-Android 12: try regular service as fallback
            try {
                getContext().startService(intent);
            } catch (Exception e2) {
                android.util.Log.e("WalkServicePlugin", "Failed to start service completely", e2);
            }
        }
    }
    
    /**
     * Checks if the app is currently in foreground (visible to user).
     * Required for Android 12+ foreground service launch restrictions.
     */
    private boolean isAppInForeground() {
        ActivityManager activityManager = (ActivityManager) getContext().getSystemService(android.content.Context.ACTIVITY_SERVICE);
        if (activityManager == null) return false;
        
        ActivityManager.RunningAppProcessInfo appProcessInfo = new ActivityManager.RunningAppProcessInfo();
        ActivityManager.getMyMemoryState(appProcessInfo);
        
        return appProcessInfo.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND ||
               appProcessInfo.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE;
    }
}
