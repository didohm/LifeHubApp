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
 * startService / updateService / stopService drive the foreground walk
 * service. getStatus returns a live snapshot of the running service, and
 * publish() emits "walkUpdate" events to JS whenever the native service
 * computes a new location fix or step.
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

    /** Emit the current native tracking state to the JS listeners. */
    static void publish(
            double distanceKm,
            int steps,
            android.location.Location location,
            boolean tracking,
            int updateCount,
            long timestamp
    ) {
        WalkServicePlugin p = instance;
        if (p == null) return;
        try {
            p.notifyListeners("walkUpdate", buildStatus(distanceKm, steps, location, tracking, updateCount, timestamp));
        } catch (Exception ignored) {
            // Bridge may be mid-teardown; nothing to push to.
        }
    }

    private static JSObject buildStatus(
            double distanceKm,
            int steps,
            android.location.Location location,
            boolean tracking,
            int updateCount,
            long timestamp
    ) {
        JSObject ret = new JSObject();
        ret.put("tracking", tracking);
        ret.put("distanceKm", distanceKm);
        ret.put("steps", steps);
        ret.put("updateCount", updateCount);
        ret.put("timestamp", timestamp);
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
        Double distanceKmObj = call.getDouble("distanceKm", 0.0);
        Integer stepsObj = call.getInt("steps", 0);
        double distanceKm = distanceKmObj != null ? distanceKmObj : 0.0;
        int steps = stepsObj != null ? stepsObj : 0;

        Intent intent = new Intent(getContext(), WalkService.class);
        intent.setAction(WalkService.ACTION_START);
        intent.putExtra(WalkService.EXTRA_DISTANCE_KM, distanceKm);
        intent.putExtra(WalkService.EXTRA_STEPS, steps);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }

        JSObject ret = new JSObject();
        ret.put("started", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void updateService(PluginCall call) {
        Double distanceKmObj = call.getDouble("distanceKm", 0.0);
        Integer stepsObj = call.getInt("steps", 0);
        double distanceKm = distanceKmObj != null ? distanceKmObj : 0.0;
        int steps = stepsObj != null ? stepsObj : 0;

        Intent intent = new Intent(getContext(), WalkService.class);
        intent.setAction(WalkService.ACTION_UPDATE);
        intent.putExtra(WalkService.EXTRA_DISTANCE_KM, distanceKm);
        intent.putExtra(WalkService.EXTRA_STEPS, steps);

        getContext().startService(intent);

        JSObject ret = new JSObject();
        ret.put("updated", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        Intent intent = new Intent(getContext(), WalkService.class);
        intent.setAction(WalkService.ACTION_STOP);
        getContext().startService(intent);

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
                WalkService.isTracking,
                WalkService.updateCount,
                System.currentTimeMillis()
        ));
    }
}