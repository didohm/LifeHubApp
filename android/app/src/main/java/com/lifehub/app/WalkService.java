package com.lifehub.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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
import android.os.PowerManager;
import android.os.SystemClock;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.util.Locale;

/**
 * Foreground Service for active walking tracking in LifeHub.
 *
 * Displays an ongoing, persistent notification in the Android Control Center
 * showing distance (km), steps, elapsed time, and calories. Keeps location and
 * step-sensor updates active in the background when the app is minimized or the
 * screen is locked.
 *
 * This service is the AUTHORITATIVE source of truth for distance / steps /
 * duration / calories while a walk is active. It publishes live "walkUpdate"
 * events back to the React app (via WalkServicePlugin) on every location fix,
 * step, and on a steady 1&nbsp;s ticker — so the JS layer always renders the
 * real, native-computed metrics and never shows stale values while throttled.
 *
 * Lifecycle / reliability notes:
 *  - State is persisted to {@link SharedPreferences} so a process death (OOM,
 *    swipe-close) can be recovered instead of silently dropping the walk.
 *  - A {@link PowerManager#PARTIAL_WAKE_LOCK} keeps the CPU awake enough for
 *    the step detector to fire while the screen is off. Without it the buffered
 *    non-wake-up step sensor can stall, freezing the step/distance counters.
 *  - The foreground-service type is chosen at runtime from the permissions the
 *    user actually granted, avoiding the SecurityException / crash that a fixed
 *    {@code location} type throws on Android 14+ when location is denied.
 */
public class WalkService extends Service implements LocationListener, SensorEventListener {

    public static final String CHANNEL_ID = "lifehub_walk_live";
    public static final int NOTIFICATION_ID = 2001;

    public static final String ACTION_START = "com.lifehub.app.walk.START";
    public static final String ACTION_UPDATE = "com.lifehub.app.walk.UPDATE";
    public static final String ACTION_PAUSE = "com.lifehub.app.walk.PAUSE";
    public static final String ACTION_RESUME = "com.lifehub.app.walk.RESUME";
    public static final String ACTION_STOP = "com.lifehub.app.walk.STOP";

    public static final String EXTRA_DISTANCE_KM = "extra_distance_km";
    public static final String EXTRA_STEPS = "extra_steps";
    public static final String EXTRA_DURATION_SEC = "extra_duration_sec";
    public static final String EXTRA_CALORIES = "extra_calories";
    public static final String EXTRA_PACE = "extra_pace";

    /** Tapped from the foreground notification — tells the app to finish. */
    public static final String ACTION_FINISH = "com.lifehub.app.walk.FINISH";
    /** Tapped from the foreground notification — tells the app to pause. */
    public static final String ACTION_PAUSE_TAP = "com.lifehub.app.walk.PAUSE_TAP";

    private static final String PREFS = "lifehub_walk_state";
    private static final String KEY_TRACKING = "tracking";
    private static final String KEY_DISTANCE = "distance_km";
    private static final String KEY_STEPS = "steps";
    private static final String KEY_DURATION = "duration_sec";
    private static final String KEY_CALORIES = "calories";
    private static final String KEY_PACE = "pace";
    private static final String KEY_STARTED_AT = "started_at";
    private static final String KEY_ACCUMULATED = "accumulated_ms";
    private static final String KEY_LAT = "lat";
    private static final String KEY_LNG = "lng";
    private static final String KEY_ACC = "acc";
    private static final String KEY_UPDATES = "updates";

    // Average human step length in meters. When GPS fixes are unavailable
    // (no permission, poor signal, device indoors) but the step detector is
    // counting, steps are the ONLY motion signal we have — without this
    // fallback distance would sit at 0.00 km the whole walk.
    private static final double STEP_LENGTH_METERS = 0.70;
    // Max step-based distance rate (steps/second). Prevents sensor glitches
    // from inflating the distance (roughly a fast running cadence).
    private static final double MAX_STEPS_PER_SECOND = 4.0;

    private long lastStepDistanceMark = 0L;
    private int stepsAtLastMark = 0;
    // Wall-clock epoch ms of the most recent native location fix, used to bound
    // how old a fix we trust (discard fixes older than 10s).
    private long lastFixWallMs = 0L;

    private final IBinder binder = new LocalBinder();
    private NotificationManager notificationManager;
    private LocationManager locationManager;
    private SensorManager sensorManager;
    private Sensor stepDetectorSensor;
    private PowerManager.WakeLock wakeLock;

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
        if (sensorManager != null) {
            stepDetectorSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR);
        }
        createNotificationChannel();
        restoreState();
        startTicker();
    }

    /* ── State persistence ────────────────────────────────────────────────── */

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private void persistState() {
        prefs()
            .edit()
            .putBoolean(KEY_TRACKING, isTracking)
            .putFloat(KEY_DISTANCE, (float) currentDistanceKm)
            .putInt(KEY_STEPS, currentSteps)
            .putLong(KEY_DURATION, durationSec)
            .putFloat(KEY_CALORIES, (float) currentCalories)
            .putFloat(KEY_PACE, (float) currentPace)
            .putLong(KEY_STARTED_AT, startedAtMs)
            .putLong(KEY_ACCUMULATED, accumulatedMs)
            .putFloat(KEY_LAT, lastLocation != null ? (float) lastLocation.getLatitude() : 0f)
            .putFloat(KEY_LNG, lastLocation != null ? (float) lastLocation.getLongitude() : 0f)
            .putFloat(KEY_ACC, lastLocation != null && lastLocation.hasAccuracy() ? lastLocation.getAccuracy() : 0f)
            .putInt(KEY_UPDATES, updateCount)
            .apply();
    }

    private void restoreState() {
        SharedPreferences p = prefs();
        isTracking = p.getBoolean(KEY_TRACKING, false);
        currentDistanceKm = p.getFloat(KEY_DISTANCE, 0f);
        currentSteps = p.getInt(KEY_STEPS, 0);
        durationSec = p.getLong(KEY_DURATION, 0);
        currentCalories = p.getFloat(KEY_CALORIES, 0f);
        currentPace = p.getFloat(KEY_PACE, 0f);
        startedAtMs = p.getLong(KEY_STARTED_AT, 0);
        accumulatedMs = p.getLong(KEY_ACCUMULATED, 0);
        updateCount = p.getInt(KEY_UPDATES, 0);
        float lat = p.getFloat(KEY_LAT, 0f);
        float lng = p.getFloat(KEY_LNG, 0f);
        float acc = p.getFloat(KEY_ACC, 0f);
        if (lat != 0f || lng != 0f) {
            lastLocation = new Location("restored");
            lastLocation.setLatitude(lat);
            lastLocation.setLongitude(lng);
            if (acc > 0f) lastLocation.setAccuracy(acc);
        }
    }

    /* ── Foreground lifecycle ─────────────────────────────────────────────── */

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getAction() != null) {
            String action = intent.getAction();
            switch (action) {
                case ACTION_START: {
                    double km = intent.getDoubleExtra(EXTRA_DISTANCE_KM, 0.0);
                    int steps = intent.getIntExtra(EXTRA_STEPS, 0);
                    long dur = intent.getLongExtra(EXTRA_DURATION_SEC, 0);
                    double cal = intent.getDoubleExtra(EXTRA_CALORIES, 0.0);
                    double pace = intent.getDoubleExtra(EXTRA_PACE, 0.0);
                    startForegroundTracking(km, steps, dur, cal, pace);
                    break;
                }
                case ACTION_UPDATE: {
                    // Monotonic merge: the native counters are authoritative,
                    // and any stale JS snapshot must never move them backwards
                    // (negative → absent → leave the value untouched).
                    double km = intent.getDoubleExtra(EXTRA_DISTANCE_KM, -1.0);
                    int steps = intent.getIntExtra(EXTRA_STEPS, -1);
                    long dur = intent.getLongExtra(EXTRA_DURATION_SEC, -1L);
                    double cal = intent.getDoubleExtra(EXTRA_CALORIES, -1.0);
                    double pace = intent.getDoubleExtra(EXTRA_PACE, -1.0);
                    if (km >= 0.0) currentDistanceKm = Math.max(currentDistanceKm, km);
                    if (steps >= 0) currentSteps = Math.max(currentSteps, steps);
                    if (dur >= 0L) durationSec = Math.max(durationSec, dur);
                    if (cal >= 0.0) currentCalories = Math.max(currentCalories, cal);
                    if (pace >= 0.0) currentPace = Math.max(currentPace, pace);
                    updateNotification();
                    publishUpdate();
                    persistState();
                    break;
                }
                case ACTION_PAUSE: {
                    paused = true;
                    updateNotification();
                    publishUpdate();
                    persistState();
                    break;
                }
                case ACTION_RESUME: {
                    // Monotonic merge — same protection as ACTION_UPDATE.
                    double km = intent.getDoubleExtra(EXTRA_DISTANCE_KM, -1.0);
                    int steps = intent.getIntExtra(EXTRA_STEPS, -1);
                    long dur = intent.getLongExtra(EXTRA_DURATION_SEC, -1L);
                    double cal = intent.getDoubleExtra(EXTRA_CALORIES, -1.0);
                    double pace = intent.getDoubleExtra(EXTRA_PACE, -1.0);
                    if (km >= 0.0) currentDistanceKm = Math.max(currentDistanceKm, km);
                    if (steps >= 0) currentSteps = Math.max(currentSteps, steps);
                    if (dur >= 0L) durationSec = Math.max(durationSec, dur);
                    if (cal >= 0.0) currentCalories = Math.max(currentCalories, cal);
                    if (pace >= 0.0) currentPace = Math.max(currentPace, pace);
                    paused = false;
                    // Re-base the wall clock so the resumed duration continues
                    // from the (merged) baseline instead of counting the pause.
                    startedAtMs = SystemClock.elapsedRealtime() - durationSec * 1000L;
                    accumulatedMs = durationSec * 1000L;
                    updateNotification();
                    publishUpdate();
                    persistState();
                    break;
                }
                case ACTION_STOP: {
                    stopForegroundTracking();
                    stopSelf();
                    return START_NOT_STICKY;
                }
                case ACTION_FINISH:
                    // Tell the React app (listening on walkUpdate) to finish the
                    // session; it owns the actual session lifecycle.
                    publishUpdate("finish");
                    break;
                case ACTION_PAUSE_TAP:
                    publishUpdate("pause");
                    break;
                default:
                    break;
            }
        } else if (isTracking) {
            // Re-created after a process death with no intent: re-enter the
            // foreground so the persisted walk keeps going instead of silently
            // disappearing. stopWithTask="false" keeps us alive across swipes.
            enterForeground();
            // The process was re-created, so the wake lock, location updates
            // and step listeners are ALL gone — without them the restored walk
            // shows a notification but never produces fixes/steps again
            // (distance stuck at 0.00). Re-register everything and reset the
            // GPS/step fallback marks so distance keeps advancing.
            acquireWakeLock();
            registerLocationUpdates();
            registerStepListeners();
            lastFixWallMs = 0L;
            lastStepDistanceMark = 0L;
            stepsAtLastMark = currentSteps;
            publishUpdate(); // UI learns the restored native state immediately
        }
        return START_STICKY;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Walking Tracking",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Live walking session metrics");
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
        // Surface the correct screen when the user taps the body of the notice.
        launchIntent.putExtra("lifehub_screen", "/walk");
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT
                        | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        // "Pause" and "Finish" action buttons drive the React app through the
        // walkUpdate event (the app owns the actual session lifecycle).
        Intent pauseIntent = new Intent(this, WalkService.class);
        pauseIntent.setAction(ACTION_PAUSE_TAP);
        PendingIntent pausePi = PendingIntent.getService(
                this,
                1,
                pauseIntent,
                PendingIntent.FLAG_UPDATE_CURRENT
                        | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        Intent finishIntent = new Intent(this, WalkService.class);
        finishIntent.setAction(ACTION_FINISH);
        PendingIntent finishPi = PendingIntent.getService(
                this,
                2,
                finishIntent,
                PendingIntent.FLAG_UPDATE_CURRENT
                        | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        String title = paused ? "LifeHub Walking — Paused ⏸" : "LifeHub Walking Tracker 🚶";
        String content = formatContent();

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(content)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(content))
                .setSmallIcon(R.drawable.ic_stat_lifehub)
                .setColor(0xFF7C5CFC)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE);

        builder.addAction(0, paused ? "Resume" : "Pause", pausePi);
        builder.addAction(0, "Finish", finishPi);

        return builder.build();
    }

    private String formatContent() {
        final String dist = String.format(Locale.US, "%.2f km", currentDistanceKm);
        final String steps = String.format(Locale.US, "%d steps", currentSteps);
        final String dur = formatDuration(durationSec);
        final String cal = String.format(Locale.US, "%.0f kcal", currentCalories);
        return String.format(Locale.US, "%s · %s · %s · %s", dist, steps, dur, cal);
    }

    private static String formatDuration(long totalSec) {
        long s = totalSec % 60;
        long m = (totalSec / 60) % 60;
        long h = totalSec / 3600;
        if (h > 0) return String.format(Locale.US, "%dh %02dm %02ds", h, m, s);
        return String.format(Locale.US, "%dm %02ds", m, s);
    }

    private void enterForeground() {
        Notification notification = buildNotification();
        int fgsType = computeFgsType();
        if (fgsType == 0) {
            // No valid foreground-service type for the granted permissions: we
            // cannot legally start a foreground service, so we degrade to a
            // normal (non-ongoing) notification so tracking still surfaces.
            notificationManager.notify(NOTIFICATION_ID, notification);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, fgsType);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    /**
     * Picks a valid foreground-service type from the permissions actually held:
     *  - `location` when ACCESS_FINE/COARSE_LOCATION is granted (the common case)
     *  - `health`   when ACTIVITY_RECOGNITION is granted (step-only tracking)
     *  - 0          when neither is granted (caller should not start FGS)
     * A fixed `location` type throws SecurityException on Android 14+ without
     * the location permission, which previously crashed the app on start.
     */
    private int computeFgsType() {
        boolean hasLocation =
                ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED
                        || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED;
        if (hasLocation) return android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
        boolean hasActivity =
                ContextCompat.checkSelfPermission(this, Manifest.permission.ACTIVITY_RECOGNITION)
                        == PackageManager.PERMISSION_GRANTED;
        if (hasActivity && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH;
        }
        return 0;
    }

    private void startForegroundTracking(
            double distanceKm,
            int steps,
            long durationSec,
            double calories,
            double pace
    ) {
        isTracking = true;
        paused = false;
        currentDistanceKm = Math.max(0, distanceKm);
        currentSteps = Math.max(0, steps);
        this.durationSec = Math.max(0, durationSec);
        currentCalories = Math.max(0, calories);
        currentPace = Math.max(0, pace);
        startedAtMs = SystemClock.elapsedRealtime() - this.durationSec * 1000L;
        accumulatedMs = this.durationSec * 1000L;
        lastLocation = null; // first fix after (re)start only sets the baseline
        stepsAtLastMark = currentSteps;
        lastStepDistanceMark = 0L;
        updateCount = 0;

        acquireWakeLock();
        enterForeground();
        registerLocationUpdates();
        registerStepListeners();

        updateNotification();
        publishUpdate();
        persistState();
    }

    private void acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LifeHub::WalkTracking");
                wakeLock.setReferenceCounted(false);
                if (!wakeLock.isHeld()) wakeLock.acquire(6 * 60 * 60 * 1000L); // up to 6h
            }
        } catch (Exception ignored) {
            wakeLock = null;
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception ignored) {
            }
        }
        wakeLock = null;
    }

    private void registerLocationUpdates() {
        if (locationManager == null) return;
        boolean hasPermission =
                ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
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
                        3000,
                        5,
                        this
                );
                anyProvider = true;
            }
            if (!anyProvider) {
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
            // Provider toggles mid-call
        }
    }

    private void registerStepListeners() {
        if (sensorManager != null && stepDetectorSensor != null) {
            sensorManager.registerListener(this, stepDetectorSensor, SensorManager.SENSOR_DELAY_UI);
        }
    }

    private void updateNotification() {
        if (notificationManager == null) return;
        Notification notification = buildNotification();
        if (isTracking || paused) {
            // Always refresh the same foreground notification object instead of
            // recreating the service lifecycle. This keeps the live walk metrics
            // visible while backgrounded without re-entering startForeground on
            // every tick, which can cause stale or duplicated notification state.
            notificationManager.notify(NOTIFICATION_ID, notification);
            return;
        }
        notificationManager.notify(NOTIFICATION_ID, notification);
    }

    private void publishUpdate() {
        publishUpdate(null);
    }

    private void publishUpdate(String action) {
        WalkServicePlugin.publish(
                currentDistanceKm,
                currentSteps,
                lastLocation,
                isTracking && !paused,
                durationSec,
                currentCalories,
                currentPace,
                updateCount,
                System.currentTimeMillis(),
                action
        );
    }

    private void stopForegroundTracking() {
        isTracking = false;
        paused = false;
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(this);
            } catch (SecurityException ignored) {
            }
        }
        if (sensorManager != null) {
            sensorManager.unregisterListener(this);
        }
        releaseWakeLock();
        if (notificationManager != null) {
            notificationManager.cancel(NOTIFICATION_ID);
        }
        // Reset persisted state so a crash-restart does not resume a dead walk.
        prefs().edit().clear().apply();
        stopForeground(true);
        updateCount = 0;
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

    /* ── Authoritative state ──────────────────────────────────────────────── */

    public static volatile double currentDistanceKm = 0.0;
    public static volatile int currentSteps = 0;
    public static volatile long durationSec = 0;
    public static volatile double currentCalories = 0.0;
    public static volatile double currentPace = 0.0;
    public static volatile boolean isTracking = false;
    public static volatile boolean paused = false;
    public static volatile Location lastLocation = null;
    public static volatile int updateCount = 0;

    // Wall-clock bookkeeping so elapsed time keeps advancing while the app is
    // backgrounded or the screen is locked (a JS setInterval freezes).
    private long startedAtMs = 0L;
    private long accumulatedMs = 0L;

    /** Recomputes elapsed time and pushes a notification + event every second. */
    private final android.os.Handler ticker =
            new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (isTracking && !paused) {
                durationSec = (SystemClock.elapsedRealtime() - startedAtMs) / 1000L;
                recomputeDerived();
                updateNotification();
                publishUpdate();
            }
            ticker.postDelayed(this, 1000);
        }
    };

    private void startTicker() {
        ticker.removeCallbacks(tick);
        ticker.postDelayed(tick, 1000);
    }

    private void recomputeDerived() {
        double km = currentDistanceKm;
        currentPace = (km > 0.001 && durationSec > 0) ? (durationSec / 60.0) / km : 0.0;
        // Calories: distance (km * weight * 0.57) + steps (~0.04 kcal/step).
        // Weight is not known natively, so use a 70kg reference and let the app
        // overwrite with the user's real weight when it publishes UPDATEs.
        if (currentCalories <= 0.0) {
            currentCalories = km * 70 * 0.57 + currentSteps * 0.04;
        }
    }

    // LocationListener callbacks
    @Override
    public void onLocationChanged(Location location) {
        if (location == null || !isTracking || paused) return;
        long nowWall = System.currentTimeMillis();
        if (Math.abs(nowWall - location.getTime()) > 10_000) return; // stale fix
        if (location.getAccuracy() > 30) return;

        if (lastLocation != null) {
            float distMeters = lastLocation.distanceTo(location);
            // 0.5m delta: casual walking emits ~0.6m fixes at a 2s interval,
            // which the old 1.2m gate dropped entirely. Cap stays at 25m.
            if (distMeters >= 0.5f && distMeters <= 25.0f) {
                currentDistanceKm += (distMeters / 1000.0);
                // GPS is authoritative: reset the step-based fallback so it
                // only fills the gap when no GPS fix arrives.
                stepsAtLastMark = currentSteps;
                lastStepDistanceMark = nowWall;
            }
        }
        lastLocation = location;
        lastFixWallMs = nowWall;
        updateCount++;
        recomputeDerived();
        updateNotification();
        publishUpdate();
        persistState();
    }

    @Override
    public void onProviderEnabled(String provider) {
        if (isTracking && !paused && locationManager != null
                && LocationManager.GPS_PROVIDER.equals(provider)) {
            try {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED) {
                    locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000, 2, this);
                }
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {
    }

    @Override
    public void onProviderDisabled(String provider) {
    }

    // SensorEventListener callbacks
    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() == Sensor.TYPE_STEP_DETECTOR && isTracking && !paused) {
            currentSteps++;
            applyStepBasedDistanceFallback();
            recomputeDerived();
            updateNotification();
            publishUpdate();
            persistState();
        }
    }

    /**
     * When no GPS fix has arrived, steps are the only motion signal. Convert
     * accumulated steps into a distance estimate so the walk doesn't sit at
     * 0.00 km. Capped by a max walking cadence to avoid sensor noise, and
     * reset whenever a real GPS fix contributes distance.
     */
    private void applyStepBasedDistanceFallback() {
        long now = System.currentTimeMillis();
        // Don't lean on the step fallback once GPS has been supplying fixes
        // (≈2 fix intervals at a 2s cadence; a single good fix used to silence
        // step-derived distance for 8s even when fixes are sparse).
        if (lastLocation != null && now - lastFixWallMs < 4000) return;

        int uncounted = currentSteps - stepsAtLastMark;
        if (uncounted <= 0) return;

        if (lastStepDistanceMark == 0L) {
            double d = Math.min(uncounted, MAX_STEPS_PER_SECOND) * STEP_LENGTH_METERS;
            currentDistanceKm += d / 1000.0;
            stepsAtLastMark = currentSteps;
            lastStepDistanceMark = now;
            return;
        }

        long elapsedMs = now - lastStepDistanceMark;
        if (elapsedMs <= 0) return;

        double maxSteps = (elapsedMs / 1000.0) * MAX_STEPS_PER_SECOND;
        double credited = Math.min(uncounted, Math.max(1.0, maxSteps));
        currentDistanceKm += (credited * STEP_LENGTH_METERS) / 1000.0;
        stepsAtLastMark = currentSteps;
        lastStepDistanceMark = now;
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
    }
}
