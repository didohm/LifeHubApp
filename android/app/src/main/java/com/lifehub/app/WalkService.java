package com.lifehub.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Binder;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.util.Locale;

/**
 * Foreground Service for active walking tracking in LifeHub.
 *
 * Displays an ongoing, persistent notification in the Android Control Center
 * showing total distance walked (in km) and steps count.
 * Keeps location and step sensor updates active in the background when the
 * app is minimized or the screen is locked.
 *
 * This service is the AUTHORITATIVE source of truth for distance & steps
 * while a walk is active. It publishes live "walkUpdate" events back to the
 * React app (via WalkServicePlugin), so the JS layer never overwrites the
 * accumulated values and always renders the real, native-computed metrics.
 */
public class WalkService extends Service implements LocationListener, SensorEventListener {

    public static final String CHANNEL_ID = "lifehub_walk";
    public static final int NOTIFICATION_ID = 2001;

    public static final String ACTION_START = "com.lifehub.app.walk.START";
    public static final String ACTION_UPDATE = "com.lifehub.app.walk.UPDATE";
    public static final String ACTION_STOP = "com.lifehub.app.walk.STOP";

    public static final String EXTRA_DISTANCE_KM = "extra_distance_km";
    public static final String EXTRA_STEPS = "extra_steps";

    // Shared, volatile state so the plugin can read the live snapshot without
    // needing a direct reference to this Service instance.
    public static volatile double currentDistanceKm = 0.0;
    public static volatile int currentSteps = 0;
    public static volatile boolean isTracking = false;
    public static volatile Location lastLocation = null;
    public static volatile int updateCount = 0;

    private final IBinder binder = new LocalBinder();
    private NotificationManager notificationManager;
    private LocationManager locationManager;
    private SensorManager sensorManager;
    private Sensor stepDetectorSensor;

    public class LocalBinder extends Binder {
        public WalkService getService() {
            return WalkService.this;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);

        createNotificationChannel();

        if (sensorManager != null) {
            stepDetectorSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getAction() != null) {
            String action = intent.getAction();

            if (ACTION_START.equals(action)) {
                currentDistanceKm = intent.getDoubleExtra(EXTRA_DISTANCE_KM, 0.0);
                currentSteps = intent.getIntExtra(EXTRA_STEPS, 0);
                updateCount = 0;
                lastLocation = null; // first fix after (re)start only sets the baseline
                startForegroundTracking();
            } else if (ACTION_UPDATE.equals(action)) {
                // JS-level sync (e.g. resuming a paused walk with an existing
                // baseline). Deliberately overwrites the accumulated values so
                // the JS session and the native notification stay in sync.
                currentDistanceKm = intent.getDoubleExtra(EXTRA_DISTANCE_KM, currentDistanceKm);
                currentSteps = intent.getIntExtra(EXTRA_STEPS, currentSteps);
                updateNotification();
                publishUpdate();
            } else if (ACTION_STOP.equals(action)) {
                stopForegroundTracking();
                stopSelf();
            }
        }
        return START_STICKY;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Walking Tracking Service",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Ongoing notification while walk tracking is active");
            channel.setSound(null, null);
            channel.enableVibration(false);
            channel.setShowBadge(false);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification() {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        String title = "LifeHub Walking Tracker 🚶";
        String content = String.format(
                Locale.US,
                "Distance: %.2f km  •  Steps: %d",
                currentDistanceKm,
                currentSteps
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(content)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE);

        return builder.build();
    }

    private void startForegroundTracking() {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Must match the manifest's foregroundServiceType="location"
            startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        isTracking = true;

        registerLocationUpdates();
        registerStepListeners();

        publishUpdate();
        updateNotification();
    }

    private void registerLocationUpdates() {
        if (locationManager == null) return;
        boolean hasPermission = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        if (!hasPermission) return;

        try {
            boolean anyProvider = false;
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER,
                        2000, // 2s interval — responsive walking deltas
                        2,    // 2m min distance
                        this
                );
                anyProvider = true;
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER,
                        2000,
                        2,
                        this
                );
                anyProvider = true;
            }
            if (!anyProvider) {
                // No provider enabled yet — request GPS anyway so we start as
                // soon as the user steps outside / GPS becomes available.
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER,
                        2000,
                        2,
                        this
                );
            }
        } catch (SecurityException ignored) {
            // Permission checked above
        } catch (Exception ignored) {
            // Provider toggles mid-call — handled by onProviderEnabled fallback
        }
        // If GPS becomes enabled mid-walk, onProviderEnabled re-requests the
        // GPS provider; until then the network provider (if enabled) fills in.
    }

    private void registerStepListeners() {
        if (sensorManager != null && stepDetectorSensor != null) {
            sensorManager.registerListener(this, stepDetectorSensor, SensorManager.SENSOR_DELAY_UI);
        }
    }

    private void updateNotification() {
        if (isTracking && notificationManager != null) {
            notificationManager.notify(NOTIFICATION_ID, buildNotification());
        }
    }

    private void publishUpdate() {
        WalkServicePlugin.publish(
                currentDistanceKm,
                currentSteps,
                lastLocation,
                isTracking,
                updateCount,
                System.currentTimeMillis()
        );
    }

    private void stopForegroundTracking() {
        isTracking = false;
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(this);
            } catch (SecurityException ignored) {}
        }
        if (sensorManager != null) {
            sensorManager.unregisterListener(this);
        }
        updateCount = 0;
        stopForeground(true);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onDestroy() {
        stopForegroundTracking();
        super.onDestroy();
    }

    // LocationListener callbacks
    @Override
    public void onLocationChanged(Location location) {
        if (location == null || !isTracking) return;
        if (location.getAccuracy() > 25) return;

        if (lastLocation != null) {
            float distMeters = lastLocation.distanceTo(location);
            if (distMeters >= 1.2f && distMeters <= 25.0f) {
                currentDistanceKm += (distMeters / 1000.0);
            }
        }
        lastLocation = location;
        updateCount++;
        publishUpdate();
        updateNotification();
    }

    @Override
    public void onProviderEnabled(String provider) {
        // If the GPS turned on mid-walk, make sure the GPS provider is active.
        if (isTracking && locationManager != null && LocationManager.GPS_PROVIDER.equals(provider)) {
            try {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED) {
                    locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000, 2, this);
                }
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {}

    @Override
    public void onProviderDisabled(String provider) {}

    // SensorEventListener callbacks
    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() == Sensor.TYPE_STEP_DETECTOR && isTracking) {
            currentSteps++;
            publishUpdate();
            updateNotification();
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}
}