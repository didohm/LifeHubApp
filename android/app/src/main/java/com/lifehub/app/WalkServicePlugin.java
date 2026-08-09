package com.lifehub.app;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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
                    WalkService.isTracking && !WalkService.paused,
                    WalkService.durationSec,
                    WalkService.currentCalories,
                    WalkService.currentPace,
                    WalkService.updateCount,
                    System.currentTimeMillis(),
                    null
            );
        }
    }

    /** Emit the current native tracking state to the JS listeners. */
    static void publish(
            double distanceKm,
            int steps,
            android.location.Location location,
            boolean tracking,
            long durationSec,
            double calories,
            double pace,
            int updateCount,
            long timestamp,
            String action
    ) {
        WalkServicePlugin p = instance;
        if (p == null) return;
        try {
            p.notifyListeners("walkUpdate", buildStatus(distanceKm, steps, location, tracking,
                    durationSec, calories, pace, updateCount, timestamp, action));
        } catch (Exception ignored) {
            // Bridge may be mid-teardown; nothing to push to.
        }
    }

    private static JSObject buildStatus(
            double distanceKm,
            int steps,
            android.location.Location location,
            boolean tracking,
            long durationSec,
            double calories,
            double pace,
            int updateCount,
            long timestamp,
            String action
    ) {
        JSObject ret = new JSObject();
        ret.put("tracking", tracking);
        ret.put("distanceKm", distanceKm);
        ret.put("steps", steps);
        ret.put("durationSec", durationSec);
        ret.put("calories", calories);
        ret.put("paceMinPerKm", pace);
        ret.put("updateCount", updateCount);
        ret.put("timestamp", timestamp);
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
        // Double-tapping "Start" must never reset a live walk: a second
        // ACTION_START would zero the native counters. Idempotent start.
        if (WalkService.isTracking && !WalkService.paused) {
            ret.put("started", true);
            call.resolve(ret);
            return;
        }

        Double distanceKmObj = call.getDouble("distanceKm", 0.0);
        Integer stepsObj = call.getInt("steps", 0);
        Long durationObj = call.getLong("durationSec", 0L);
        Double caloriesObj = call.getDouble("calories", 0.0);
        Double paceObj = call.getDouble("paceMinPerKm", 0.0);
        double distanceKm = distanceKmObj != null ? distanceKmObj : 0.0;
        int steps = stepsObj != null ? stepsObj : 0;
        long duration = durationObj != null ? durationObj : 0L;
        double calories = caloriesObj != null ? caloriesObj : 0.0;
        double pace = paceObj != null ? paceObj : 0.0;

        try {
            Intent intent = new Intent(getContext(), WalkService.class);
            intent.setAction(WalkService.ACTION_START);
            intent.putExtra(WalkService.EXTRA_DISTANCE_KM, distanceKm);
            intent.putExtra(WalkService.EXTRA_STEPS, steps);
            intent.putExtra(WalkService.EXTRA_DURATION_SEC, duration);
            intent.putExtra(WalkService.EXTRA_CALORIES, calories);
            intent.putExtra(WalkService.EXTRA_PACE, pace);
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
        double distanceKm = distanceKmObj != null ? distanceKmObj : 0.0;
        int steps = stepsObj != null ? stepsObj : 0;
        long duration = durationObj != null ? durationObj : 0L;
        double calories = caloriesObj != null ? caloriesObj : 0.0;
        double pace = paceObj != null ? paceObj : 0.0;

        try {
            Intent intent = new Intent(getContext(), WalkService.class);
            intent.setAction(WalkService.ACTION_UPDATE);
            intent.putExtra(WalkService.EXTRA_DISTANCE_KM, distanceKm);
            intent.putExtra(WalkService.EXTRA_STEPS, steps);
            intent.putExtra(WalkService.EXTRA_DURATION_SEC, duration);
            intent.putExtra(WalkService.EXTRA_CALORIES, calories);
            intent.putExtra(WalkService.EXTRA_PACE, pace);
            getContext().startService(intent);
        } catch (Exception ignored) {
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
        } catch (Exception ignored) {
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
        double distanceKm = distanceKmObj != null ? distanceKmObj : 0.0;
        int steps = stepsObj != null ? stepsObj : 0;
        long duration = durationObj != null ? durationObj : 0L;
        double calories = caloriesObj != null ? caloriesObj : 0.0;
        double pace = paceObj != null ? paceObj : 0.0;

        try {
            Intent intent = new Intent(getContext(), WalkService.class);
            intent.setAction(WalkService.ACTION_RESUME);
            intent.putExtra(WalkService.EXTRA_DISTANCE_KM, distanceKm);
            intent.putExtra(WalkService.EXTRA_STEPS, steps);
            intent.putExtra(WalkService.EXTRA_DURATION_SEC, duration);
            intent.putExtra(WalkService.EXTRA_CALORIES, calories);
            intent.putExtra(WalkService.EXTRA_PACE, pace);
            getContext().startService(intent);
        } catch (Exception ignored) {
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
        } catch (Exception ignored) {
        }
        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }

    /**
     * Live snapshot of the currently tracked walk (works even if the JS event
     * stream was throttled, e.g. right after the app resumes from background).
     */
    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(buildStatus(
                WalkService.currentDistanceKm,
                WalkService.currentSteps,
                WalkService.lastLocation,
                WalkService.isTracking && !WalkService.paused,
                WalkService.durationSec,
                WalkService.currentCalories,
                WalkService.currentPace,
                WalkService.updateCount,
                System.currentTimeMillis(),
                null
        ));
    }

    /**
     * Start the service defensively. On Android 12+ starting an FGS from a
     * background context is restricted, and on 14+ the chosen foreground type
     * must match a granted permission — the service itself guards this, but we
     * also catch any start failure so the app never crashes.
     */
    private void startServiceSafe(Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
        } catch (Exception e) {
            // Fall back to a plain start; the service will degrade gracefully.
            try {
                getContext().startService(intent);
            } catch (Exception ignored) {
            }
        }
    }
}
