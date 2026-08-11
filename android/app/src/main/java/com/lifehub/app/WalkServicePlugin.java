package com.lifehub.app;

import android.content.Intent;
import android.os.Build;

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

    private void startServiceSafe(Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
        } catch (Exception e) {
            android.util.Log.w("WalkServicePlugin", "Failed to start foreground service, retrying as regular service", e);
            try {
                getContext().startService(intent);
            } catch (Exception e2) {
                android.util.Log.e("WalkServicePlugin", "Failed to start service completely", e2);
            }
        }
    }
}
