package com.lifehub.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "StepCounter",
    permissions = {
        @Permission(
            alias = "activity",
            strings = { Manifest.permission.ACTIVITY_RECOGNITION }
        )
    }
)
public class StepCounterPlugin extends Plugin implements SensorEventListener {

    private SensorManager sensorManager;
    private Sensor stepCounterSensor;
    private Sensor stepDetectorSensor;
    private boolean isListening = false;
    private int initialStepCount = -1;
    private int sessionSteps = 0;

    @Override
    public void load() {
        super.load();
        Context context = getContext();
        sensorManager = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) {
            stepDetectorSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR);
            stepCounterSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        boolean available = (stepCounterSensor != null || stepDetectorSensor != null);
        ret.put("available", available);
        ret.put("hasCounter", stepCounterSensor != null);
        ret.put("hasDetector", stepDetectorSensor != null);
        call.resolve(ret);
    }

    @PluginMethod
    public void startStepping(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACTIVITY_RECOGNITION)
                    != PackageManager.PERMISSION_GRANTED) {
                requestPermissionForAlias("activity", call, "activityPermissionCallback");
                return;
            }
        }
        doStartStepping(call);
    }

    @PermissionCallback
    private void activityPermissionCallback(PluginCall call) {
        if (getPermissionState("activity") == PermissionState.GRANTED) {
            doStartStepping(call);
        } else {
            call.reject("Permission to track physical activity was denied.");
        }
    }

    private void doStartStepping(PluginCall call) {
        if (sensorManager == null) {
            call.reject("SensorManager is not available.");
            return;
        }

        initialStepCount = -1;
        sessionSteps = 0;

        boolean registered = false;
        if (stepDetectorSensor != null) {
            registered = sensorManager.registerListener(this, stepDetectorSensor, SensorManager.SENSOR_DELAY_FASTEST);
        }
        if (stepCounterSensor != null) {
            boolean reg2 = sensorManager.registerListener(this, stepCounterSensor, SensorManager.SENSOR_DELAY_UI);
            registered = registered || reg2;
        }

        if (!registered) {
            call.reject("Hardware step sensors are unavailable on this device.");
            return;
        }

        isListening = true;
        JSObject ret = new JSObject();
        ret.put("started", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stopStepping(PluginCall call) {
        if (sensorManager != null && isListening) {
            sensorManager.unregisterListener(this);
            isListening = false;
        }
        initialStepCount = -1;
        sessionSteps = 0;
        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (!isListening) return;

        if (event.sensor.getType() == Sensor.TYPE_STEP_DETECTOR) {
            sessionSteps++;
            emitStepEvent(sessionSteps, 1);
        } else if (event.sensor.getType() == Sensor.TYPE_STEP_COUNTER) {
            int totalSteps = (int) event.values[0];
            if (initialStepCount < 0) {
                initialStepCount = totalSteps;
            }
            int deltaSteps = totalSteps - initialStepCount;
            if (deltaSteps > sessionSteps) {
                int increment = deltaSteps - sessionSteps;
                sessionSteps = deltaSteps;
                emitStepEvent(sessionSteps, increment);
            }
        }
    }

    private void emitStepEvent(int totalSessionSteps, int stepIncrement) {
        JSObject ret = new JSObject();
        ret.put("steps", totalSessionSteps);
        ret.put("increment", stepIncrement);
        ret.put("timestamp", System.currentTimeMillis());
        notifyListeners("stepEvent", ret);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        // No action required
    }
}
