package com.lifehub.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Binder;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import android.app.AlarmManager;
import android.os.Handler;
import android.os.Looper;
import android.app.ActivityManager;

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
    public static final String EXTRA_WEIGHT_KG = "extra_weight_kg";
    public static final String EXTRA_SESSION_ID = "extra_session_id";
    /** Start the service frozen (paused) — used when a walk is recovered after process death. */
    public static final String EXTRA_PAUSED = "extra_paused";

    /** Tapped from the foreground notification — tells the app to finish. */
    public static final String ACTION_FINISH = "com.lifehub.app.walk.FINISH";
    /** Tapped from the foreground notification — tells the app to pause. */
    public static final String ACTION_PAUSE_TAP = "com.lifehub.app.walk.PAUSE_TAP";
    /** Tapped from the foreground notification — tells the app to resume. */
    public static final String ACTION_RESUME_TAP = "com.lifehub.app.walk.RESUME_TAP";
    /** Internal action for AlarmManager ticker updates (Doze-exempt). */
    public static final String ACTION_TICKER_UPDATE = "com.lifehub.app.walk.TICKER_UPDATE";
    /** Internal action for wake lock maintenance. */
    public static final String ACTION_WAKELOCK_MAINTAIN = "com.lifehub.app.walk.WAKELOCK_MAINTAIN";
    /** Explicit request (from the app, after showing its own rationale) to open the OS battery-optimization exemption dialog. */
    public static final String ACTION_BATTERY_EXEMPTION_REQUEST = "com.lifehub.app.walk.BATTERY_EXEMPTION_REQUEST";

    private static final String PREFS = "lifehub_walk_state";
    private static final String KEY_TRACKING = "tracking";
    private static final String KEY_PAUSED = "paused";
    private static final String KEY_DISTANCE = "distance_km";
    private static final String KEY_STEPS = "steps";
    private static final String KEY_DURATION = "duration_sec";
    private static final String KEY_CALORIES = "calories";
    private static final String KEY_PACE = "pace";
    private static final String KEY_STARTED_AT = "started_at";
    private static final String KEY_LAT = "lat";
    private static final String KEY_LNG = "lng";
    private static final String KEY_ACC = "acc";
    private static final String KEY_UPDATES = "updates";
    private static final String KEY_STEP_INITIAL = "step_initial";
    private static final String KEY_STEP_TOTAL = "step_total";
    private static final String KEY_WEIGHT = "weight_kg";
    private static final String KEY_GPS_KM = "gps_km";
    private static final String KEY_SESSION_ID = "session_id";
    private static final String KEY_VEHICLE_FLAGGED = "vehicle_flagged";
    private static final String KEY_SENSORS_REGISTERED = "sensors_registered";
    private static final String KEY_LOCATION_REGISTERED = "location_registered";
    private static final String KEY_LAST_HEARTBEAT = "last_heartbeat";
    private static final String KEY_WAKELOCK_ACQUIRED_AT = "wakelock_acquired_at";
    private static final String KEY_SENSOR_REGISTRATION_FAILURES = "sensor_failures";
    private static final String KEY_LOCATION_PROVIDER_TYPE = "location_provider_type";

    // Average adult step length in meters (standard average stride). Height is
    // collected at onboarding, but a fixed constant is deliberately used on
    // BOTH sides (native and JS fallback use the same 0.762) so distance never
    // differs between engines or between sessions. Distance is derived from
    // the CURRENT step total (steps × stride) on every recompute, so it can
    // never stall at 0.00 km while the step counter is counting, and can never
    // drift out of sync with the step counter by being accumulated separately.
    private static final double STRIDE_METERS = 0.762;
    // MET value for moderate walking pace (kcal per kg per hour). Drives the
    // calorie formula: MET × weight × duration_hours.
    private static final double MET_WALKING = 3.5;
    private static final String TAG = "LifeHubWalk";

    // SystemClock.elapsedRealtime() of the last accepted fix — feeds the GPS
    // speed gate that rejects jittery (implausibly fast) fix-to-fix jumps.
    private long lastFixElapsedRealtime = 0L;
    // Wall-clock epoch ms of the last ACCEPTED GPS fix. Falls back to the
    // step-derived distance when GPS goes stale (indoor / tunnel / signal loss).
    private long lastGpsFixWallMs = 0L;
    // Wall-clock epoch ms of the last STEP event (detector or counter). While
    // fresh, the step counter is the cadence ground truth for distance
    // arbitration; when stale (screen-off stalls, no sensor), GPS takes over.
    private long lastStepEventWallMs = 0L;
    // CRITICAL: Timestamp of last processed location to prevent GPS/Fused double-counting
    // Both providers can report the same fix with identical timestamp - only process once
    private long lastProcessedLocationTimeMs = 0L;

    private final IBinder binder = new LocalBinder();
    private NotificationManager notificationManager;
    private LocationManager locationManager;
    /**
     * Modern fused location provider (Google Play Services). Preferred over
     * LocationManager when Play Services is available: it fuses GPS + network
     * + sensor hints with far better battery efficiency while keeping
     * high-accuracy walking fixes. Falls back to LocationManager otherwise.
     */
    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback fusedLocationCallback;
    private SensorManager sensorManager;
    private Sensor stepDetectorSensor;
    private Sensor stepCounterSensor;
    private int initialStepCounterValue = -1;
    // Last hardware TYPE_STEP_COUNTER accumulator value received. Persisted so
    // a process death (OOM, swipe-away) can resume the walk against the SAME
    // hardware baseline — otherwise the counter is re-based on the stale
    // persisted step count and every step taken while dead is discarded, which
    // permanently freezes the step counter.
    private long lastCounterTotal = -1L;
    private PowerManager.WakeLock wakeLock;
    private NotificationCompat.Builder notificationBuilder;
    private boolean isInForeground = false;
    private boolean lastNotifiedPauseState = false;
    private WalkDatabaseHelper dbHelper;
    private int stepsAtLastVehicleCheck = 0;
    private long lastVehicleCheckWallMs = 0L;

    // AlarmManager-based ticker for Doze immunity
    private AlarmManager alarmManager;
    private PendingIntent tickerPendingIntent;
    private PendingIntent wakeLockMaintenancePendingIntent;
    private boolean useAlarmTicker = true;

    // Sensor registration state tracking
    private boolean sensorsRegistered = false;
    private int sensorRegistrationAttempts = 0;
    private static final int MAX_SENSOR_RETRIES = 3;
    private Handler sensorRetryHandler;
    private boolean isSensorRecoveryInProgress = false;
    private Runnable pendingSensorValidation = null;

    // Location provider health monitoring
    private long lastGpsHealthCheckMs = 0L;
    private static final long GPS_HEALTH_CHECK_INTERVAL_MS = 60_000L;
    private static final long GPS_STALE_THRESHOLD_MS = 60_000L;
    private boolean isFusedLocationRequestActive = false;
    private boolean isLocationManagerRequestActive = false;
    private String activeLocationProvider = "none";
    private boolean isLocationRecoveryInProgress = false;

    // Wake lock maintenance
    private long wakeLockAcquiredAtMs = 0L;
    private static final long WAKELOCK_TIMEOUT_MS = 60 * 60 * 1000L;
    private static final long WAKELOCK_REACQUIRE_BEFORE_MS = 5 * 60 * 1000L;

    // SQLite live-session snapshot (steps/distance/duration/calories) — written
    // every 5s while tracking so a hard process kill never loses more than 5s
    // of progress even if SharedPreferences is lost.
    private long lastSnapshotMs = 0L;
    private static final long SNAPSHOT_INTERVAL_MS = 5_000L;

    // Connectivity monitoring
    private ConnectivityMonitor connectivityMonitor;

    // Battery optimization enforcement
    private boolean batteryOptimizationWarningShown = false;
    
    // Play Services health check
    private long lastPlayServicesCheckMs = 0L;
    private static final long PLAY_SERVICES_CHECK_INTERVAL_MS = 120_000L; // 2 minutes
    
    // Service restart tracking for reliability guard
    private static int serviceRestartCount = 0;
    private static long lastRestartTimeMs = 0L;
    private static final int MAX_RESTARTS_PER_MINUTE = 5;
    
    // Diagnostic logging and health monitoring (P4)
    private WalkDiagnostics diagnostics;
    private long lastHealthReportMs = 0L;
    private static final long HEALTH_REPORT_INTERVAL_MS = 10_000L; // 10 seconds

    /**
     * True once the app deliberately requested ACTION_STOP (finish/cancel). A
     * system-initiated teardown of a LIVE walk (OEM task killer, battery
     * manager stopping the service) must NOT wipe the persisted snapshot —
     * that is the whole crash-recovery design. See onDestroy().
     */
    private boolean explicitStopRequested = false;
    /** Set by onDestroy() when a live walk is being torn down by the system. */
    private boolean preserveStateOnTeardown = false;

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
        dbHelper = WalkDatabaseHelper.getInstance(this);
        // Fused location provider when Google Play Services is present. The
        // request callback delegates to the SAME onLocationChanged() pipeline
        // (filtering, distance, route points) as the LocationManager fallback,
        // so there is exactly one canonical GPS ingestion path.
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        fusedLocationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult locationResult) {
                if (locationResult == null || !isTracking || paused) return;
                for (Location location : locationResult.getLocations()) {
                    onLocationChanged(location);
                }
            }
        };
        if (sensorManager != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                // Request wake-up sensors so events wake up the AP when screen is locked
                stepDetectorSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR, true);
                if (stepDetectorSensor == null) {
                    stepDetectorSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR);
                }
                stepCounterSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER, true);
                if (stepCounterSensor == null) {
                    stepCounterSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
                }
            } else {
                stepDetectorSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR);
                stepCounterSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
            }
        }
        createNotificationChannel();
        restoreState();

        // Initialize AlarmManager and retry handler BEFORE startTicker() so the
        // Doze-exempt alarm ticker is the one chosen (never the fallback Handler
        // ticker, which would keep running alongside the alarm ticker later).
        alarmManager = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        sensorRetryHandler = new Handler(Looper.getMainLooper());
        startTicker();
        
        // Initialize diagnostic logging (P4.1)
        diagnostics = new WalkDiagnostics(this);
        diagnostics.info(WalkDiagnostics.CAT_LIFECYCLE, "WalkService created");
        
        // Initialize connectivity monitor for network-aware provider switching
        connectivityMonitor = new ConnectivityMonitor(this);
        connectivityMonitor.setListener(new ConnectivityMonitor.ConnectivityListener() {
            @Override
            public void onNetworkAvailable() {
                Log.d(TAG, "Network restored, switching to fused location if appropriate");
                if (diagnostics != null) {
                    diagnostics.info(WalkDiagnostics.CAT_NETWORK, "Network available, considering provider switch");
                }
                if (isTracking && !paused && "gps".equals(activeLocationProvider)) {
                    switchToFusedLocationProvider();
                }
            }

            @Override
            public void onNetworkLost() {
                Log.d(TAG, "Network lost, switching to GPS-only mode");
                if (diagnostics != null) {
                    diagnostics.warn(WalkDiagnostics.CAT_NETWORK, "Network lost, switching to GPS-only");
                }
                if (isTracking && !paused && "fused".equals(activeLocationProvider)) {
                    switchToGpsLocationProvider();
                }
            }
        });
    }

    /* ── State persistence ────────────────────────────────────────────────── */

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private void persistState() {
        prefs()
            .edit()
            .putBoolean(KEY_TRACKING, isTracking)
            .putBoolean(KEY_PAUSED, paused)
            .putFloat(KEY_DISTANCE, (float) currentDistanceKm)
            .putInt(KEY_STEPS, currentSteps)
            .putLong(KEY_DURATION, durationSec)
            .putFloat(KEY_CALORIES, (float) currentCalories)
            .putFloat(KEY_PACE, (float) currentPace)
            .putLong(KEY_STARTED_AT, startedAtMs)
            .putFloat(KEY_LAT, lastLocation != null ? (float) lastLocation.getLatitude() : 0f)
            .putFloat(KEY_LNG, lastLocation != null ? (float) lastLocation.getLongitude() : 0f)
            .putFloat(KEY_ACC, lastLocation != null && lastLocation.hasAccuracy() ? lastLocation.getAccuracy() : 0f)
            .putInt(KEY_UPDATES, updateCount)
            .putInt(KEY_STEP_INITIAL, initialStepCounterValue)
            .putLong(KEY_STEP_TOTAL, lastCounterTotal)
            .putFloat(KEY_WEIGHT, (float) userWeightKg)
            .putFloat(KEY_GPS_KM, (float) gpsDistanceKm)
            .putString(KEY_SESSION_ID, activeSessionId)
            .putBoolean(KEY_VEHICLE_FLAGGED, isVehicleFlagged)
            .putBoolean(KEY_SENSORS_REGISTERED, sensorsRegistered)
            .putBoolean(KEY_LOCATION_REGISTERED, isFusedLocationRequestActive || !activeLocationProvider.equals("none"))
            .putLong(KEY_LAST_HEARTBEAT, System.currentTimeMillis())
            .putLong(KEY_WAKELOCK_ACQUIRED_AT, wakeLockAcquiredAtMs)
            .putInt(KEY_SENSOR_REGISTRATION_FAILURES, sensorRegistrationAttempts)
            .putString(KEY_LOCATION_PROVIDER_TYPE, activeLocationProvider)
            .apply();
    }

    private void restoreState() {
        SharedPreferences p = prefs();
        isTracking = p.getBoolean(KEY_TRACKING, false);
        paused = p.getBoolean(KEY_PAUSED, false);
        currentDistanceKm = p.getFloat(KEY_DISTANCE, 0f);
        currentSteps = p.getInt(KEY_STEPS, 0);
        durationSec = p.getLong(KEY_DURATION, 0);
        currentCalories = p.getFloat(KEY_CALORIES, 0f);
        currentPace = p.getFloat(KEY_PACE, 0f);
        startedAtMs = p.getLong(KEY_STARTED_AT, 0);
        updateCount = p.getInt(KEY_UPDATES, 0);
        initialStepCounterValue = p.getInt(KEY_STEP_INITIAL, -1);
        lastCounterTotal = p.getLong(KEY_STEP_TOTAL, -1L);
        gpsDistanceKm = p.getFloat(KEY_GPS_KM, 0f);
        activeSessionId = p.getString(KEY_SESSION_ID, "current_session");
        isVehicleFlagged = p.getBoolean(KEY_VEHICLE_FLAGGED, false);
        float weight = p.getFloat(KEY_WEIGHT, 0f);
        if (weight > 0f) userWeightKg = weight;
        
        // Restore background execution state. KEY_LOCATION_REGISTERED is
        // persisted as "fused OR LocationManager active" — split it back into
        // the two provider flags from the persisted provider type instead of
        // blindly restoring it as the fused-only flag (that mislabeled a
        // GPS-only walk as fused after a process death).
        sensorsRegistered = p.getBoolean(KEY_SENSORS_REGISTERED, false);
        long lastHeartbeat = p.getLong(KEY_LAST_HEARTBEAT, 0L);
        wakeLockAcquiredAtMs = p.getLong(KEY_WAKELOCK_ACQUIRED_AT, 0L);
        sensorRegistrationAttempts = p.getInt(KEY_SENSOR_REGISTRATION_FAILURES, 0);
        activeLocationProvider = p.getString(KEY_LOCATION_PROVIDER_TYPE, "none");
        boolean locationRegistered = p.getBoolean(KEY_LOCATION_REGISTERED, false);
        isFusedLocationRequestActive = locationRegistered && "fused".equals(activeLocationProvider);
        isLocationManagerRequestActive = locationRegistered
                && !"fused".equals(activeLocationProvider)
                && !"none".equals(activeLocationProvider);
        
        // Detect long-term process death (heartbeat stale > 5 minutes)
        long heartbeatAgeMs = System.currentTimeMillis() - lastHeartbeat;
        if (isTracking && lastHeartbeat > 0L && heartbeatAgeMs > 5 * 60 * 1000L) {
            Log.w(TAG, "Service restarted after long process death (" + (heartbeatAgeMs / 1000L) + "s), potential data loss");
            publishUpdate("heartbeat_stale");
        }

        long nowElapsed = SystemClock.elapsedRealtime();
        if (startedAtMs > nowElapsed || startedAtMs <= 0) {
            startedAtMs = nowElapsed - durationSec * 1000L;
        }

        float lat = p.getFloat(KEY_LAT, 0f);
        float lng = p.getFloat(KEY_LNG, 0f);
        float acc = p.getFloat(KEY_ACC, 0f);
        if (lat != 0f || lng != 0f) {
            lastLocation = new Location("restored");
            lastLocation.setLatitude(lat);
            lastLocation.setLongitude(lng);
            if (acc > 0f) lastLocation.setAccuracy(acc);
        }

        // Merge the SQLite live-session snapshot (written every 5s by the
        // ticker). Both prefs and SQLite survive process death; the fresher
        // writer wins so a walk recovered after a hard kill keeps the exact
        // totals tracked while the process was dead.
        if (isTracking && dbHelper != null) {
            try {
                org.json.JSONObject snap = dbHelper.getSessionSnapshot(activeSessionId);
                if (snap != null && snap.optLong("updated_at", 0L) > lastHeartbeat) {
                    currentSteps = Math.max(currentSteps, snap.optInt("steps", 0));
                    currentDistanceKm = Math.max(currentDistanceKm, (float) snap.optDouble("distance_km", 0.0));
                    durationSec = Math.max(durationSec, snap.optLong("duration_sec", 0L));
                    currentCalories = Math.max(currentCalories, (float) snap.optDouble("calories", 0.0));
                    Log.d(TAG, "Merged SQLite snapshot (fresher than prefs): steps=" + currentSteps
                            + " km=" + currentDistanceKm + " dur=" + durationSec);
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to merge SQLite snapshot in restore", e);
            }
        }
    }

    /* ── Foreground lifecycle ─────────────────────────────────────────────── */

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // P3.3: Service restart reliability guard - detect crash loops
        long now = System.currentTimeMillis();
        if (now - lastRestartTimeMs < 60_000L) {
            serviceRestartCount++;
            if (serviceRestartCount > MAX_RESTARTS_PER_MINUTE) {
                Log.e(TAG, "Service restarting too frequently (" + serviceRestartCount + " times in 1 minute), stopping to prevent crash loop");
                publishUpdate("service_crash_loop_detected");
                stopForegroundTracking();
                stopSelf();
                return START_NOT_STICKY;
            }
        } else {
            serviceRestartCount = 1;
        }
        lastRestartTimeMs = now;
        
        if (intent != null && intent.getAction() != null) {
            String action = intent.getAction();
            switch (action) {
                case ACTION_START: {
                    String sessId = intent.getStringExtra(EXTRA_SESSION_ID);
                    if (sessId != null && !sessId.isEmpty()) {
                        activeSessionId = sessId;
                    }
                    boolean startPaused = intent.getBooleanExtra(EXTRA_PAUSED, false);
                    double km = intent.getDoubleExtra(EXTRA_DISTANCE_KM, 0.0);
                    int steps = intent.getIntExtra(EXTRA_STEPS, 0);
                    long dur = intent.getLongExtra(EXTRA_DURATION_SEC, 0);
                    double cal = intent.getDoubleExtra(EXTRA_CALORIES, 0.0);
                    double pace = intent.getDoubleExtra(EXTRA_PACE, 0.0);
                    double weight = intent.getDoubleExtra(EXTRA_WEIGHT_KG, 0.0);
                    if (weight > 0.0) userWeightKg = weight;
                    startForegroundTracking(km, steps, dur, cal, pace, startPaused);
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
                    double weight = intent.getDoubleExtra(EXTRA_WEIGHT_KG, 0.0);
                    if (weight > 0.0) userWeightKg = weight;
                    if (km >= 0.0) currentDistanceKm = Math.max(currentDistanceKm, km);
                    if (steps >= 0) currentSteps = Math.max(currentSteps, steps);
                    if (dur >= 0L) {
                        // A larger JS-pushed duration (e.g. the app's paused
                        // baseline) must also re-base the wall clock — mirroring
                        // ACTION_RESUME — or the ticker's next recompute
                        // (duration = elapsedRealtime − startedAtMs) clobbers
                        // the merged value back to the old baseline.
                        if (dur > durationSec) {
                            durationSec = dur;
                            startedAtMs = SystemClock.elapsedRealtime() - dur * 1000L;
                        }
                    }
                    if (cal >= 0.0) currentCalories = Math.max(currentCalories, cal);
                    if (pace >= 0.0) currentPace = Math.max(currentPace, pace);
                    resumeTrackingEnginesIfNeeded();
                    updateNotification();
                    publishUpdate();
                    persistState();
                    break;
                }
                case ACTION_PAUSE: {
                    paused = true;
                    // Freeze the tickers: the Doze-exempt AlarmManager ticker
                    // must NOT keep firing 1 Hz exact alarms while paused (each
                    // one wakes the device in Doze to do nothing but re-schedule
                    // — a walk paused for an hour burned ~3,600 wakeups). The
                    // Handler fallback ticker is suspended too; ACTION_RESUME
                    // restarts whichever ticker is active.
                    stopAllTickers();
                    resumeTrackingEnginesIfNeeded();
                    updateNotification();
                    publishUpdate();
                    persistState();
                    persistSessionSnapshot();
                    break;
                }
                case ACTION_RESUME: {
                    // Monotonic merge — same protection as ACTION_UPDATE.
                    double km = intent.getDoubleExtra(EXTRA_DISTANCE_KM, -1.0);
                    int steps = intent.getIntExtra(EXTRA_STEPS, -1);
                    long dur = intent.getLongExtra(EXTRA_DURATION_SEC, -1L);
                    double cal = intent.getDoubleExtra(EXTRA_CALORIES, -1.0);
                    double pace = intent.getDoubleExtra(EXTRA_PACE, -1.0);
                    double weight = intent.getDoubleExtra(EXTRA_WEIGHT_KG, 0.0);
                    if (weight > 0.0) userWeightKg = weight;
                    if (km >= 0.0) currentDistanceKm = Math.max(currentDistanceKm, km);
                    if (steps >= 0) currentSteps = Math.max(currentSteps, steps);
                    if (dur >= 0L) durationSec = Math.max(durationSec, dur);
                    if (cal >= 0.0) currentCalories = Math.max(currentCalories, cal);
                    if (pace >= 0.0) currentPace = Math.max(currentPace, pace);
                    paused = false;
                    // Re-base the wall clock so the resumed duration continues
                    // from the (merged) baseline instead of counting the pause.
                    startedAtMs = SystemClock.elapsedRealtime() - durationSec * 1000L;
                    // Restart the ticker that ACTION_PAUSE stopped — the frozen
                    // notification/clock must resume ticking again.
                    startTicker();
                    resumeTrackingEnginesIfNeeded();
                    updateNotification();
                    publishUpdate();
                    persistState();
                    persistSessionSnapshot();
                    break;
                }
                case ACTION_STOP: {
                    explicitStopRequested = true;
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
                case ACTION_RESUME_TAP:
                    publishUpdate("resume");
                    break;
                case ACTION_TICKER_UPDATE:
                    // Doze-exempt ticker update from AlarmManager. Only
                    // re-schedule while actually tracking (not paused) — an
                    // in-flight alarm arriving just after a pause must let the
                    // chain die out instead of re-arming the 1 Hz loop.
                    if (isTracking && !paused) {
                        handleTickerUpdate();
                        scheduleNextTicker();
                    }
                    break;
                case ACTION_WAKELOCK_MAINTAIN:
                    // Proactive wake lock re-acquisition before expiry
                    Log.d(TAG, "Wake lock maintenance triggered");
                    ensureWakeLockHeld();
                    break;
                case ACTION_BATTERY_EXEMPTION_REQUEST:
                    // The app showed its own rationale and the user accepted —
                    // only now open the OS "Allow background activity?" dialog.
                    requestBatteryOptimizationExemptionFromSystem();
                    break;
                default:
                    break;
            }
        } else if (isTracking) {
            // Re-created after a process death with no intent: re-enter the
            // foreground so the persisted walk keeps going instead of silently
            // disappearing. stopWithTask="false" keeps us alive across swipes.
            
            // P3.3: Validate service state before resuming
            if (!validateServiceState()) {
                Log.e(TAG, "Service state corrupted after restart, cannot resume");
                publishUpdate("service_state_corrupted");
                stopForegroundTracking();
                stopSelf();
                return START_NOT_STICKY;
            }
            
            resumeTrackingEnginesIfNeeded();
        }
        return START_STICKY;
    }

    /**
     * The walk clock is wall-clock based, so a service instance that was
     * (re)created by startService()/startForegroundService() — e.g. the app
     * sends ACTION_RESUME after the original process died (OOM, swipe-away
     * while the task was killed) — would keep ticking the duration while its
     * GPS fixes and step sensors stay UNREGISTERED: distance/steps would
     * freeze at 0.00 km no matter how far the user walks. This re-registers
     * the entire tracking stack (wake lock, screen-on recovery, location
     * updates, step listeners) and re-enters the foreground when the instance
     * is not already live. On a healthy instance it is a cheap no-op.
     */
    private void resumeTrackingEnginesIfNeeded() {
        // Already live: wake lock held + foreground notification shown means
        // the sensors were registered at start — do not double-register.
        if (isInForeground && wakeLock != null && wakeLock.isHeld()) return;

        enterForeground();
        acquireWakeLock();
        registerScreenOnReceiver();
        registerLocationUpdates();
        registerStepListeners();
        
        // Start AlarmManager ticker if not already running (never while
        // paused — a restored walk stays frozen until the user resumes).
        if (useAlarmTicker && tickerPendingIntent == null && !paused) {
            startAlarmTicker();
        }
        
        // Start network monitoring if not already active
        if (connectivityMonitor != null) {
            connectivityMonitor.startMonitoring();
        }
        
        // Reset the step/gps marks so the restored walk earns new distance
        // from the first fresh fix/step instead of re-crediting the persisted
        // totals. The step-counter baseline was persisted, so the hardware
        // accumulator resumes seamlessly.
        publishUpdate();
    }
    
    /**
     * P3.3: Validates service state integrity after restart.
     * Detects corrupted state (tracking=true but no resources registered).
     * Returns true if state is valid, false if corrupted.
     */
    private boolean validateServiceState() {
        if (!isTracking) return true;
        
        // Check for corrupted state: tracking but no duration
        if (durationSec == 0 && startedAtMs == 0) {
            Log.e(TAG, "Corrupted state: tracking=true but no duration/startTime");
            return false;
        }
        
        // Check if resources are in a sane state
        boolean hasValidState = true;
        
        if (alarmManager == null) {
            Log.w(TAG, "AlarmManager is null during restart");
            hasValidState = false;
        }
        
        if (sensorManager == null) {
            Log.w(TAG, "SensorManager is null during restart");
            hasValidState = false;
        }
        
        if (locationManager == null && fusedLocationClient == null) {
            Log.w(TAG, "No location providers available during restart");
            hasValidState = false;
        }
        
        if (!hasValidState) {
            Log.e(TAG, "Service resources unavailable, cannot resume tracking");
        }
        
        return hasValidState;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Walking Tracking",
                    NotificationManager.IMPORTANCE_DEFAULT // Upgraded from LOW for OEM compatibility
            );
            channel.setDescription("Live walking session metrics during active walks");
            channel.setSound(null, null);
            channel.enableVibration(false);
            channel.setShowBadge(false);
            // Ensure channel is not suppressed by aggressive OEM battery managers
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                channel.setAllowBubbles(false);
            }
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    /**
     * Creates the NotificationCompat.Builder with all static configuration
     * (PendingIntents, icons, color, actions, etc.). Called once when entering
     * foreground and when the pause state changes (to update action button labels).
     * Dynamic content (title, text) are updated via updateNotificationContent().
     */
    private void createNotificationBuilder() {
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

        notificationBuilder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_lifehub)
                .setColor(0xFF7C5CFC)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT) // Upgraded from LOW for visibility
                .setCategory(NotificationCompat.CATEGORY_WORKOUT); // More specific than SERVICE

        // "Pause/Resume" and "Finish" action buttons drive the React app through the
        // walkUpdate event (the app owns the actual session lifecycle).
        Intent pauseIntent = new Intent(this, WalkService.class);
        pauseIntent.setAction(paused ? ACTION_RESUME_TAP : ACTION_PAUSE_TAP);
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

        // Clear existing actions before adding to prevent duplicates
        notificationBuilder.clearActions();
        notificationBuilder.addAction(0, paused ? "Resume" : "Pause", pausePi);
        notificationBuilder.addAction(0, "Finish", finishPi);

        // Set initial content (title and text)
        updateNotificationContent();
    }

    /**
     * Updates only the dynamic content (title, text) on the cached notification
     * builder. This avoids recreating the entire notification structure and prevents
     * flickering when called every second from the ticker.
     *
     * The content carries the LIVE metrics (distance, duration, steps, kcal)
     * updated by NATIVE code on every tick — the WebView is never involved, so
     * it stays accurate even while the app is backgrounded or the screen is
     * locked (JS throttling has no effect on native-side updates).
     *
     * Actions are NOT updated here — they're set once in createNotificationBuilder()
     * and only recreated when the pause state actually changes.
     */
    private void updateNotificationContent() {
        if (notificationBuilder == null) return;

        String title = paused ? "Walk paused" : "Walk in progress";
        String content = formatNotificationMetrics();

        notificationBuilder
                .setContentTitle(title)
                .setContentText(content);
    }

    private String formatNotificationDuration(long totalSeconds) {
        long hours = totalSeconds / 3600;
        long minutes = (totalSeconds % 3600) / 60;
        long seconds = totalSeconds % 60;
        return String.format(java.util.Locale.US, "%02d:%02d:%02d", hours, minutes, seconds);
    }

    /** "2.43 km · 00:14:32 · 3,421 steps · 146 kcal" — compact one-line live summary. */
    private String formatNotificationMetrics() {
        StringBuilder sb = new StringBuilder();
        sb.append(String.format(java.util.Locale.US, "%.2f km", currentDistanceKm));
        sb.append(" · ").append(formatNotificationDuration(durationSec));
        sb.append(" · ").append(String.format(java.util.Locale.US, "%,d", currentSteps)).append(" steps");
        sb.append(" · ").append(String.format(java.util.Locale.US, "%.0f", currentCalories)).append(" kcal");
        return sb.toString();
    }

    private void enterForeground() {
        // P3.2: Android 13+ requires POST_NOTIFICATIONS permission to show notifications
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) 
                    != PackageManager.PERMISSION_GRANTED) {
                Log.w(TAG, "POST_NOTIFICATIONS permission not granted on Android 13+, notifying JS app");
                publishUpdate("notification_permission_required");
                // Continue anyway - service will run but notification may not show
            }
        }
        
        // CRITICAL: Compute FGS type FIRST before creating notification
        int fgsType = computeFgsType();
        if (fgsType == 0) {
            // CRITICAL: No valid FGS type means we CANNOT run as a foreground service.
            // This is a FATAL configuration error - location tracking REQUIRES a valid FGS.
            // Do NOT silently degrade to a regular notification and pretend tracking works.
            Log.e(TAG, "FATAL: No valid foreground service type - cannot start location tracking service");
            Log.e(TAG, "Required: ACCESS_FINE_LOCATION or ACCESS_COARSE_LOCATION");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                Log.e(TAG, "Required on Android 14+: ACCESS_BACKGROUND_LOCATION");
            }
            publishUpdate("foreground_service_cannot_start");
            
            // Stop the service - it cannot function without proper FGS
            stopForegroundTracking();
            stopSelf();
            return;
        }
        
        // Create the notification builder only once when entering foreground
        if (notificationBuilder == null) {
            createNotificationBuilder();
            lastNotifiedPauseState = paused;
        } else {
            // If pause state changed, recreate the builder with updated actions
            if (lastNotifiedPauseState != paused) {
                createNotificationBuilder();
                lastNotifiedPauseState = paused;
            } else {
                // If builder exists and pause state unchanged, just update content
                updateNotificationContent();
            }
        }
        
        Notification notification = notificationBuilder.build();
        
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, fgsType);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            isInForeground = true;
            Log.d(TAG, "Successfully entered foreground with FGS type: " + fgsType);
        } catch (SecurityException e) {
            // CRITICAL: SecurityException means wrong FGS type for granted permissions
            // This should never happen if computeFgsType() is correct, but catch it explicitly
            Log.e(TAG, "FATAL: SecurityException starting foreground service - permission/type mismatch", e);
            publishUpdate("foreground_service_security_error");
            
            // Stop the service - cannot recover from permission mismatch
            stopForegroundTracking();
            stopSelf();
        } catch (Exception e) {
            // P3.1: Android 12+ can throw ForegroundServiceStartNotAllowedException
            Log.e(TAG, "FATAL: Failed to start foreground service", e);
            publishUpdate("foreground_service_start_failed");
            
            // Do NOT fall back to regular notification - stop the service
            // A location tracking service that cannot be foreground WILL be killed by the OS
            stopForegroundTracking();
            stopSelf();
        }
    }

    /**
     * P3.4: Enhanced foreground service type selection.
     * Picks a valid foreground-service type from the permissions actually held:
     *  - `location` when ACCESS_FINE/COARSE_LOCATION is granted
     *  - Combined `location | health` when both location and activity recognition granted
     *  - 0 when required permissions are missing (caller MUST NOT start FGS)
     * 
     * CRITICAL: Android 14+ (API 34+) requires ACCESS_BACKGROUND_LOCATION for 
     * FOREGROUND_SERVICE_TYPE_LOCATION. Without it, startForeground() throws 
     * SecurityException and the service dies immediately.
     * 
     * This service performs GPS-based location tracking, so LOCATION is the 
     * PRIMARY required FGS type. HEALTH (step counter) is supplementary but 
     * cannot substitute for location tracking.
     */
    private int computeFgsType() {
        boolean hasFineLocation = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED;
        boolean hasCoarseLocation = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED;
        boolean hasLocation = hasFineLocation || hasCoarseLocation;
        boolean hasActivity = ContextCompat.checkSelfPermission(this, Manifest.permission.ACTIVITY_RECOGNITION)
                        == PackageManager.PERMISSION_GRANTED;
        // FOREGROUND_SERVICE_TYPE_HEALTH requires the BODY_SENSORS runtime
        // permission on Android 14+ (a dangerous permission since API 29) —
        // without it startForeground() throws SecurityException. Only combine
        // the HEALTH bit when the permission is actually held; otherwise fall
        // back to the LOCATION-only type.
        boolean hasBodySensors = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                || ContextCompat.checkSelfPermission(this, Manifest.permission.BODY_SENSORS)
                        == PackageManager.PERMISSION_GRANTED;

        // Android 14+ requires background location permission for FOREGROUND_SERVICE_TYPE_LOCATION
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) { // API 34
            boolean hasBackgroundLocation = ContextCompat.checkSelfPermission(this, 
                    Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
            
            if (!hasLocation) {
                // No location permission at all - cannot do GPS tracking
                Log.e(TAG, "No location permission on Android 14+ - cannot start FGS for location tracking");
                publishUpdate("location_permission_required");
                return 0;
            }
            
            if (!hasBackgroundLocation) {
                // Have location but not background location - CANNOT use LOCATION type on Android 14+
                Log.e(TAG, "Background location permission required on Android 14+ for FGS location type");
                publishUpdate("background_location_required");
                return 0;
            }
            
            // Have both location and background location - use LOCATION type
            // Combine with HEALTH if activity recognition AND body sensors are granted
            int fgsType = android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
            if (hasActivity && hasBodySensors) {
                fgsType |= android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH;
                Log.d(TAG, "Using FOREGROUND_SERVICE_TYPE_LOCATION | HEALTH (Android 14+)");
            } else {
                Log.d(TAG, "Using FOREGROUND_SERVICE_TYPE_LOCATION (Android 14+)");
            }
            return fgsType;
        } else {
            // Android 10-13: location permission sufficient (no background location requirement)
            if (!hasLocation) {
                Log.e(TAG, "No location permission - cannot start FGS for location tracking");
                publishUpdate("location_permission_required");
                return 0;
            }
            
            // Have location permission - use LOCATION type
            // Combine with HEALTH if activity recognition + body sensors also granted
            int fgsType = android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
            if (hasActivity && hasBodySensors && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                fgsType |= android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH;
                Log.d(TAG, "Using FOREGROUND_SERVICE_TYPE_LOCATION | HEALTH");
            } else {
                Log.d(TAG, "Using FOREGROUND_SERVICE_TYPE_LOCATION");
            }
            return fgsType;
        }
    }

    private void startForegroundTracking(
            double distanceKm,
            int steps,
            long durationSec,
            double calories,
            double pace,
            boolean startPaused
    ) {
        // Merge with any state persisted by a previous process instance (walk
        // recovered after process death / app force-close): the persisted
        // counters were written on every tick/fix, so they are the freshest
        // snapshot available — never overwrite them with the app's older
        // Firestore baseline. For a genuine new walk the prefs were cleared on
        // stop, so the merge degrades to the intent values.
        SharedPreferences p = prefs();
        currentDistanceKm = Math.max(p.getFloat(KEY_DISTANCE, 0f), (float) Math.max(0, distanceKm));
        currentSteps = Math.max(p.getInt(KEY_STEPS, 0), Math.max(0, steps));
        this.durationSec = Math.max(p.getLong(KEY_DURATION, 0L), Math.max(0L, durationSec));
        currentCalories = Math.max(p.getFloat(KEY_CALORIES, 0f), (float) Math.max(0, calories));
        currentPace = Math.max(p.getFloat(KEY_PACE, 0f), (float) Math.max(0, pace));
        gpsDistanceKm = Math.max(p.getFloat(KEY_GPS_KM, 0f), (float) gpsDistanceKm);
        isTracking = true;
        // A recovered walk is re-armed frozen (paused): the clock stays stopped
        // at the recovered metrics until the user taps Resume in the app or on
        // the notification. A fresh walk starts with paused=false as before.
        paused = startPaused;
        startedAtMs = SystemClock.elapsedRealtime() - this.durationSec * 1000L;
        lastLocation = null; // first fix after (re)start only sets the baseline
        updateCount = 0;
        isVehicleFlagged = false;
        lastVehicleCheckWallMs = 0L;
        stepsAtLastVehicleCheck = 0;
        lastGpsFixWallMs = 0L;
        // Fresh walk: drop the previous session's step-counter baseline so the
        // hardware accumulator is re-based on this walk's start point.
        initialStepCounterValue = -1;
        lastCounterTotal = -1L;

        acquireWakeLock();
        registerScreenOnReceiver();
        enterForeground(); // This already displays the notification
        registerLocationUpdates();
        registerStepListeners();
        
        // Start the ticker for Doze-exempt updates. startTicker() is
        // paused-aware: a walk re-armed frozen (recovered after process death)
        // must not run the 1 Hz alarm ticker until the user resumes it.
        startTicker();
        
        // Start network connectivity monitoring
        if (connectivityMonitor != null) {
            connectivityMonitor.startMonitoring();
        }
        
        // Doze/battery-saver would otherwise suspend the service's location and
        // step streams minutes into a walk (steps freeze, distance stalls).
        // Reports the exemption state to the app — the OS dialog itself is only
        // opened after the app shows its rationale and the user accepts.
        notifyBatteryOptimizationStatus();

        publishUpdate();
        persistState();
    }

    /**
     * Checks if app is exempt from battery optimization.
     * Returns true if exempt, false otherwise.
     */
    public static boolean isBatteryOptimizationExempt(Context context) {
        try {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                return pm.isIgnoringBatteryOptimizations(context.getPackageName());
            }
            return true; // Pre-M devices don't have this restriction
        } catch (Exception e) {
            Log.w(TAG, "Failed to check battery optimization status", e);
            return false;
        }
    }

    /**
     * Called at walk start: never opens a dialog on its own. Reports the
     * exemption state to the app (battery_not_exempt) so the app can show its
     * own rationale dialog first, then explicitly request the OS prompt via
     * ACTION_BATTERY_EXEMPTION_REQUEST. Foreground services are normally
     * prioritized, but aggressive OEM battery managers / Doze can still
     * suspend the (non-wake-up) step sensor stream and stall GPS — which
     * freezes steps/distance mid-walk.
     */
    private void notifyBatteryOptimizationStatus() {
        if (!isBatteryOptimizationExempt(this) && !batteryOptimizationWarningShown) {
            batteryOptimizationWarningShown = true;
            publishUpdate("battery_not_exempt");
            Log.d(TAG, "App not exempt from battery optimization — app notified (dialog deferred to explicit request)");
        }
    }

    /**
     * Opens the system "Allow background activity?" dialog. Only called after
     * the app has shown its own rationale and the user accepted
     * (ACTION_BATTERY_EXEMPTION_REQUEST). No-op when already exempt.
     */
    private void requestBatteryOptimizationExemptionFromSystem() {
        try {
            if (isBatteryOptimizationExempt(this)) {
                Log.d(TAG, "Battery optimization already disabled");
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent intent = new Intent(
                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:" + getPackageName())
                );
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
                Log.d(TAG, "Battery optimization exemption dialog requested");
            }
        } catch (Exception e) {
            Log.w(TAG, "Battery optimization exemption dialog unavailable or already handled", e);
        }
    }

    private void acquireWakeLock() {
        try {
            // Release any existing wake lock first to prevent leaks
            releaseWakeLock();
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LifeHub::WalkTracking");
                wakeLock.setReferenceCounted(false);
                // 1 hour timeout with proactive re-acquisition
                if (!wakeLock.isHeld()) {
                    wakeLock.acquire(WAKELOCK_TIMEOUT_MS);
                    wakeLockAcquiredAtMs = System.currentTimeMillis();
                    scheduleWakeLockMaintenance();
                    Log.d(TAG, "Wake lock acquired with 1h timeout");
                    if (diagnostics != null) {
                        diagnostics.info(WalkDiagnostics.CAT_WAKELOCK, "Wake lock acquired (timeout: 1h)");
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to acquire wake lock", e);
            if (diagnostics != null) {
                diagnostics.error(WalkDiagnostics.CAT_WAKELOCK, "Failed to acquire wake lock: " + e.getMessage());
            }
            wakeLock = null;
        }
    }

    /**
     * Schedules proactive wake lock re-acquisition 5 minutes before expiry.
     * Prevents sensor stream stalls on walks longer than 1 hour.
     */
    private void scheduleWakeLockMaintenance() {
        if (alarmManager == null) return;
        
        try {
            Intent intent = new Intent(this, WalkService.class);
            intent.setAction(ACTION_WAKELOCK_MAINTAIN);
            
            wakeLockMaintenancePendingIntent = PendingIntent.getService(
                this,
                2002,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );
            
            long maintainAtMs = System.currentTimeMillis() + WAKELOCK_TIMEOUT_MS - WAKELOCK_REACQUIRE_BEFORE_MS;
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, maintainAtMs, wakeLockMaintenancePendingIntent);
            } else {
                alarmManager.setExact(AlarmManager.RTC_WAKEUP, maintainAtMs, wakeLockMaintenancePendingIntent);
            }
            
            Log.d(TAG, "Wake lock maintenance scheduled for 55min from now");
        } catch (Exception e) {
            Log.e(TAG, "Failed to schedule wake lock maintenance", e);
        }
    }
    
    /**
     * Validates wake lock is held before sensor operations and re-acquires if released.
     */
    private void ensureWakeLockHeld() {
        if (wakeLock == null || !wakeLock.isHeld()) {
            Log.w(TAG, "Wake lock not held, re-acquiring");
            acquireWakeLock();
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception e) {
                Log.e(TAG, "Failed to release wake lock", e);
            }
        }
        wakeLock = null;
        
        // Cancel wake lock maintenance alarm
        if (alarmManager != null && wakeLockMaintenancePendingIntent != null) {
            try {
                alarmManager.cancel(wakeLockMaintenancePendingIntent);
            } catch (Exception e) {
                Log.w(TAG, "Failed to cancel wake lock maintenance alarm", e);
            }
        }
    }
    
    /* ── AlarmManager Ticker (Doze-Exempt) ────────────────────────────────── */
    
    /**
     * True when this app may schedule exact alarms on Android 12+ (the
     * SCHEDULE_EXACT_ALARM / USE_EXACT_ALARM grant). Older versions always
     * allow them. The Doze-exempt AlarmManager ticker depends on exact
     * alarms; when the grant is missing the ticker must fall back to the
     * (wake-lock-backed) Handler ticker instead of freezing the metrics.
     */
    private boolean canScheduleExactAlarms() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return alarmManager != null && alarmManager.canScheduleExactAlarms();
        }
        return true;
    }

    /**
     * Starts Doze-exempt ticker using AlarmManager for guaranteed metric updates
     * even when device is in deep Doze mode. Falls back to Handler ticker if
     * alarm scheduling fails or the exact-alarm grant is missing.
     */
    private void startAlarmTicker() {
        if (alarmManager == null) {
            Log.w(TAG, "AlarmManager unavailable, using Handler ticker fallback");
            useAlarmTicker = false;
            startHandlerTicker();
            return;
        }

        if (!canScheduleExactAlarms()) {
            Log.w(TAG, "Exact alarm permission not granted, using Handler ticker fallback");
            useAlarmTicker = false;
            startHandlerTicker();
            return;
        }

        // Already scheduled — never double-register (alarm ticker + Handler
        // ticker running at once would recompute/publish twice per second).
        if (tickerPendingIntent != null) {
            ticker.removeCallbacks(tick);
            return;
        }

        try {
            Intent intent = new Intent(this, WalkTickerReceiver.class);
            intent.setAction(WalkTickerReceiver.ACTION_TICKER);
            
            tickerPendingIntent = PendingIntent.getBroadcast(
                this,
                2001,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );
            
            // The alarm ticker is the single source of 1s ticks from now on —
            // stop the fallback Handler ticker so they never run in parallel.
            ticker.removeCallbacks(tick);
            scheduleNextTicker();
            useAlarmTicker = true;
            Log.d(TAG, "AlarmManager ticker started (Doze-exempt)");
        } catch (Exception e) {
            Log.e(TAG, "Failed to start AlarmManager ticker, falling back to Handler", e);
            useAlarmTicker = false;
            startHandlerTicker();
        }
    }
    
    /**
     * Schedules next ticker alarm 1 second from now. Uses setExactAndAllowWhileIdle
     * for Doze immunity on Android 6+.
     */
    private void scheduleNextTicker() {
        if (!useAlarmTicker || alarmManager == null || tickerPendingIntent == null) return;
        
        try {
            long nextTriggerMs = System.currentTimeMillis() + 1000L;
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextTriggerMs, tickerPendingIntent);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                alarmManager.setExact(AlarmManager.RTC_WAKEUP, nextTriggerMs, tickerPendingIntent);
            } else {
                alarmManager.set(AlarmManager.RTC_WAKEUP, nextTriggerMs, tickerPendingIntent);
            }
        } catch (Exception e) {
            // Exact alarms can be revoked mid-walk (OEM battery managers / user
            // toggling "Alarms & reminders"): silently dying here would freeze
            // the notification and metrics in deep Doze. Fall back to the
            // wake-lock-backed Handler ticker instead.
            Log.e(TAG, "Failed to schedule next ticker alarm, falling back to Handler ticker", e);
            useAlarmTicker = false;
            startHandlerTicker();
        }
    }

    /**
     * Handler-based 1s ticker fallback for when exact alarms are unavailable
     * or revoked mid-walk. Not Doze-exempt by itself, but the service holds a
     * PARTIAL_WAKE_LOCK for the whole walk, which keeps the main looper (and
     * this runnable) executing with the screen off.
     */
    private void startHandlerTicker() {
        ticker.removeCallbacks(tick);
        ticker.postDelayed(tick, 1000);
    }
    
    /**
     * Cancels AlarmManager ticker when tracking stops. Nulls the pending
     * intent so a later startAlarmTicker() (e.g. pause → resume) schedules a
     * fresh alarm instead of early-returning on the stale reference.
     */
    private void stopAlarmTicker() {
        if (alarmManager != null && tickerPendingIntent != null) {
            try {
                alarmManager.cancel(tickerPendingIntent);
                Log.d(TAG, "AlarmManager ticker stopped");
            } catch (Exception e) {
                Log.w(TAG, "Failed to cancel ticker alarm", e);
            }
        }
        tickerPendingIntent = null;
    }

    /** Stops BOTH tickers (AlarmManager + Handler fallback). Used on pause. */
    private void stopAllTickers() {
        stopAlarmTicker();
        ticker.removeCallbacks(tick);
    }
    
    /**
     * Handles ticker update (called from AlarmManager or Handler).
     * Recomputes metrics, updates notification, and publishes to JS.
     */
    private void handleTickerUpdate() {
        if (!isTracking || paused) return;
        
        ensureWakeLockHeld();
        durationSec = (SystemClock.elapsedRealtime() - startedAtMs) / 1000L;
        recomputeDerived();
        updateNotification();
        publishUpdate();
        persistState();
        persistSessionSnapshotIfDue();
        
        // Perform periodic health checks
        monitorLocationHealth();
        monitorSensorHealth();
        
        // P4.2: Publish health status every 10 seconds
        publishHealthStatusIfNeeded();
    }

    /** Writes the live session snapshot to SQLite at most every 5 seconds. */
    private void persistSessionSnapshotIfDue() {
        long now = System.currentTimeMillis();
        if (now - lastSnapshotMs < SNAPSHOT_INTERVAL_MS) return;
        lastSnapshotMs = now;
        persistSessionSnapshot();
    }

    /** Writes the live session snapshot (steps/distance/duration/calories) to SQLite. */
    private void persistSessionSnapshot() {
        if (dbHelper == null || activeSessionId == null || activeSessionId.isEmpty()) return;
        try {
            dbHelper.upsertSessionSnapshot(
                    activeSessionId,
                    currentSteps,
                    currentDistanceKm,
                    durationSec,
                    currentCalories
            );
        } catch (Exception e) {
            Log.w(TAG, "Failed to persist session snapshot to SQLite", e);
        }
    }
    
    /**
     * P4.2: Publishes detailed health status to JS app for monitoring.
     * Called every 10 seconds from ticker. Allows JS to show warnings
     * like "GPS signal lost" or "Step sensor not responding".
     */
    private void publishHealthStatusIfNeeded() {
        long now = System.currentTimeMillis();
        if (now - lastHealthReportMs < HEALTH_REPORT_INTERVAL_MS) return;
        lastHealthReportMs = now;
        
        try {
            // Collect health metrics
            boolean wakeLockHeld = wakeLock != null && wakeLock.isHeld();
            boolean sensorsActive = sensorsRegistered && (stepDetectorSensor != null || stepCounterSensor != null);
            String locationProvider = activeLocationProvider;
            long gpsStaleSec = lastGpsFixWallMs > 0L ? (now - lastGpsFixWallMs) / 1000L : -1L;
            long stepStaleSec = lastStepEventWallMs > 0L ? (now - lastStepEventWallMs) / 1000L : -1L;
            // A registered sensor that never produced a single event is a
            // stalled stream too — report it once the walk is well underway
            // (the first minutes of every walk have no step events yet).
            boolean stepStreamDead = sensorsActive && lastStepEventWallMs == 0L && durationSec > 120L;
            boolean batteryExempt = isBatteryOptimizationExempt(this);
            int fgsType = computeFgsType();
            
            // Determine overall health status
            String healthStatus = "healthy";
            String healthMessage = null;
            
            if (!wakeLockHeld) {
                healthStatus = "warning";
                healthMessage = "Wake lock not held - sensors may stop";
            } else if (!sensorsActive && isTracking) {
                healthStatus = "error";
                healthMessage = "Step sensors not registered";
            } else if (gpsStaleSec > 120L) {
                healthStatus = "warning";
                healthMessage = "GPS signal lost (no fix for " + gpsStaleSec + "s)";
            } else if (stepStaleSec > 60L || stepStreamDead) {
                healthStatus = "warning";
                healthMessage = stepStreamDead
                        ? "Step sensor never responded (no events since start)"
                        : "Step sensor not responding (" + stepStaleSec + "s)";
            } else if (!batteryExempt) {
                healthStatus = "warning";
                healthMessage = "Battery optimization not disabled";
            } else if (fgsType == 0) {
                healthStatus = "error";
                healthMessage = "No valid foreground service type";
            }
            
            // Build health status object
            org.json.JSONObject healthObj = new org.json.JSONObject();
            healthObj.put("status", healthStatus);
            healthObj.put("message", healthMessage != null ? healthMessage : "All systems operational");
            healthObj.put("wakeLockHeld", wakeLockHeld);
            healthObj.put("sensorsRegistered", sensorsActive);
            healthObj.put("locationProvider", locationProvider);
            healthObj.put("gpsStaleSeconds", gpsStaleSec);
            healthObj.put("stepStaleSeconds", stepStaleSec);
            healthObj.put("batteryOptimizationExempt", batteryExempt);
            healthObj.put("foregroundServiceType",
                    (fgsType & android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION) != 0
                            ? ((fgsType & android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH) != 0
                                    ? "location|health" : "location")
                            : fgsType != 0 ? "health" : "none");
            healthObj.put("timestamp", now);
            
            // Publish via WalkServicePlugin
            WalkServicePlugin.publishHealth(healthObj.toString());
            
            // Log to diagnostics
            if (diagnostics != null && !healthStatus.equals("healthy")) {
                diagnostics.warn(WalkDiagnostics.CAT_LIFECYCLE, "Health: " + healthStatus + " - " + healthMessage);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to publish health status", e);
        }
    }

    /** True when Google Play Services (fused location provider) is available. */
    private boolean isFusedLocationAvailable() {
        try {
            return GoogleApiAvailability.getInstance()
                    .isGooglePlayServicesAvailable(this) == ConnectionResult.SUCCESS;
        } catch (Exception e) {
            return false;
        }
    }

    private void registerLocationUpdates() {
        // CRITICAL: Prevent duplicate registration during recovery
        if (isLocationRecoveryInProgress) {
            Log.d(TAG, "Location recovery already in progress, skipping duplicate registration");
            return;
        }
        
        // Check for either FINE or COARSE location permission
        boolean hasFineLocation =
                ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED;
        boolean hasCoarseLocation =
                ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED;

        if (!hasFineLocation && !hasCoarseLocation) {
            Log.w(TAG, "No location permission, cannot register location updates");
            return;
        }

        // Preferred path: FusedLocationProviderClient (battery-efficient,
        // sensor-fused GPS). Falls back to LocationManager when Play Services
        // is missing or the request fails (device, test, or provider quirk).
        if (fusedLocationClient != null && isFusedLocationAvailable()) {
            try {
                // CRITICAL: Remove any existing requests first to clean up dead callbacks
                // from previous service instances (process death). Without this, duplicate
                // requests pile up and drain battery.
                if (isFusedLocationRequestActive) {
                    try {
                        fusedLocationClient.removeLocationUpdates(fusedLocationCallback);
                        isFusedLocationRequestActive = false;
                        Log.d(TAG, "Removed previous fused location request");
                    } catch (Exception e) {
                        Log.w(TAG, "Failed to remove previous fused request (may not exist)", e);
                    }
                }
                
                LocationRequest request = new LocationRequest.Builder(
                        Priority.PRIORITY_HIGH_ACCURACY,
                        2000L // 2s interval — responsive walking deltas
                )
                        .setMinUpdateIntervalMillis(1000L)
                        .setMaxUpdateDelayMillis(5000L)
                        .setMinUpdateDistanceMeters(0f) // all fixes — native filters
                        .build();
                fusedLocationClient.requestLocationUpdates(request, fusedLocationCallback, null);
                isFusedLocationRequestActive = true;
                isLocationManagerRequestActive = false;
                activeLocationProvider = "fused";
                persistState();
                Log.d(TAG, "FusedLocationProviderClient registered successfully");
                
                // Schedule health check to detect if Play Services crashes
                schedulePlayServicesHealthCheck();
                return;
            } catch (SecurityException e) {
                Log.w(TAG, "SecurityException requesting fused location updates", e);
                isFusedLocationRequestActive = false;
            } catch (Exception e) {
                Log.w(TAG, "Failed to register fused location updates, falling back to LocationManager", e);
                isFusedLocationRequestActive = false;
            }
        }

        if (locationManager == null) return;

        // CRITICAL: Remove existing LocationManager listeners to prevent duplicates
        if (isLocationManagerRequestActive) {
            try {
                locationManager.removeUpdates(this);
                isLocationManagerRequestActive = false;
                Log.d(TAG, "Removed previous LocationManager listeners");
            } catch (Exception e) {
                Log.w(TAG, "Failed to remove previous LocationManager listeners", e);
            }
        }

        try {
            boolean anyProvider = false;

            // GPS provider requires FINE location permission
            if (hasFineLocation && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER,
                        2000, // 2s interval — responsive walking deltas
                        0,    // No minDistance — get all updates for accurate tracking
                        this
                );
                anyProvider = true;
                activeLocationProvider = "gps";
            }

            // Network provider works with either FINE or COARSE
            if ((hasFineLocation || hasCoarseLocation) &&
                locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER,
                        3000,
                        0,
                        this
                );
                anyProvider = true;
                if (!"gps".equals(activeLocationProvider)) {
                    activeLocationProvider = "network";
                }
            }

            // Fallback: if no provider enabled, try GPS anyway (with FINE permission)
            if (!anyProvider && hasFineLocation) {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER,
                        2000,
                        0,
                        this
                );
                activeLocationProvider = "gps";
                anyProvider = true;
            }
            
            if (anyProvider) {
                isLocationManagerRequestActive = true;
                isFusedLocationRequestActive = false;
                persistState();
                Log.d(TAG, "LocationManager registered with provider: " + activeLocationProvider);
            } else {
                Log.w(TAG, "No location providers available or enabled");
                activeLocationProvider = "none";
            }
        } catch (SecurityException e) {
            Log.w(TAG, "SecurityException requesting GPS location updates", e);
            isLocationManagerRequestActive = false;
        } catch (Exception e) {
            Log.w(TAG, "Failed to register location updates", e);
            isLocationManagerRequestActive = false;
        }
    }

    /** 
     * Stops BOTH location sources (fused + legacy) — safe to call from any path.
     * CRITICAL: Properly tracks state to prevent duplicate listeners on re-registration.
     */
    private void removeLocationUpdates() {
        if (fusedLocationClient != null && fusedLocationCallback != null && isFusedLocationRequestActive) {
            try {
                fusedLocationClient.removeLocationUpdates(fusedLocationCallback);
                isFusedLocationRequestActive = false;
                Log.d(TAG, "Removed fused location updates");
            } catch (Exception e) {
                Log.w(TAG, "Failed to remove fused location updates", e);
                isFusedLocationRequestActive = false;
            }
        }
        if (locationManager != null && isLocationManagerRequestActive) {
            try {
                locationManager.removeUpdates(this);
                isLocationManagerRequestActive = false;
                Log.d(TAG, "Removed LocationManager updates");
            } catch (SecurityException e) {
                Log.w(TAG, "SecurityException removing location updates", e);
                isLocationManagerRequestActive = false;
            } catch (Exception e) {
                Log.w(TAG, "Failed to remove LocationManager updates", e);
                isLocationManagerRequestActive = false;
            }
        }
        activeLocationProvider = "none";
        isLocationRecoveryInProgress = false;
        persistState();
    }
    
    /* ── Location Provider Health Monitoring ──────────────────────────────── */
    
    /**
     * Monitors GPS health and switches providers when necessary.
     * Called periodically from ticker. Detects stale GPS and triggers recovery.
     * CRITICAL: Prevents duplicate recovery attempts using isLocationRecoveryInProgress flag.
     */
    private void monitorLocationHealth() {
        if (!isTracking || paused) return;
        
        // CRITICAL: Do not start new recovery if one is already in progress
        if (isLocationRecoveryInProgress) {
            Log.d(TAG, "Location recovery already in progress, skipping health check");
            return;
        }
        
        long now = System.currentTimeMillis();
        
        // Only check every 60 seconds to avoid excessive overhead
        if (now - lastGpsHealthCheckMs < GPS_HEALTH_CHECK_INTERVAL_MS) return;
        lastGpsHealthCheckMs = now;
        
        long timeSinceLastFix = now - lastGpsFixWallMs;
        
        // If no GPS fix for 60+ seconds and we're tracking, GPS is stale
        if (timeSinceLastFix > GPS_STALE_THRESHOLD_MS && lastGpsFixWallMs > 0L) {
            Log.w(TAG, "GPS stale (no fix for " + (timeSinceLastFix / 1000L) + "s), attempting recovery");
            
            // Mark recovery in progress to prevent duplicate attempts
            isLocationRecoveryInProgress = true;
            
            // Recovery sequence: remove and re-register location updates
            removeLocationUpdates();
            
            // Wait 2 seconds for cleanup, then re-register
            sensorRetryHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (isTracking && !paused) {
                        registerLocationUpdates();
                        publishUpdate("gps_recovery_attempted");
                    }
                    // Clear recovery flag after completion (whether successful or not)
                    isLocationRecoveryInProgress = false;
                }
            }, 2000L);
        }
        
        // Check Play Services health if using fused provider
        if ("fused".equals(activeLocationProvider)) {
            checkPlayServicesHealth();
        }
    }
    
    /**
     * Schedules periodic Play Services health check to detect crashes.
     * Called after successful fused location registration.
     */
    private void schedulePlayServicesHealthCheck() {
        if (sensorRetryHandler != null) {
            sensorRetryHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (isTracking && !paused && "fused".equals(activeLocationProvider)) {
                        checkPlayServicesHealth();
                        // Reschedule for next check
                        schedulePlayServicesHealthCheck();
                    }
                }
            }, PLAY_SERVICES_CHECK_INTERVAL_MS);
        }
    }
    
    /**
     * Checks if Google Play Services is still available and healthy.
     * If crashed or unavailable, switches to GPS LocationManager.
     */
    private void checkPlayServicesHealth() {
        long now = System.currentTimeMillis();
        
        // Don't check too frequently
        if (now - lastPlayServicesCheckMs < PLAY_SERVICES_CHECK_INTERVAL_MS) return;
        lastPlayServicesCheckMs = now;
        
        if (!isFusedLocationAvailable()) {
            Log.w(TAG, "Play Services no longer available, switching to GPS LocationManager");
            switchToGpsLocationProvider();
            publishUpdate("play_services_unavailable");
        } else {
            // Check if fused provider is stuck (no callbacks despite being active)
            long timeSinceLastFix = now - lastGpsFixWallMs;
            if (isFusedLocationRequestActive && timeSinceLastFix > GPS_STALE_THRESHOLD_MS && lastGpsFixWallMs > 0L) {
                Log.w(TAG, "Fused provider stuck (no fix for " + (timeSinceLastFix / 1000L) + "s), switching to GPS");
                switchToGpsLocationProvider();
            }
        }
    }
    
    /**
     * Switches to FusedLocationProviderClient for better battery efficiency
     * when network is available. Called when network connectivity is restored.
     */
    private void switchToFusedLocationProvider() {
        if (!isFusedLocationAvailable()) {
            Log.d(TAG, "Cannot switch to fused provider, Play Services unavailable");
            return;
        }
        
        Log.d(TAG, "Switching to FusedLocationProviderClient");
        removeLocationUpdates();
        
        // Wait for cleanup before registering new provider
        sensorRetryHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (isTracking && !paused) {
                    registerLocationUpdates();
                    activeLocationProvider = "fused";
                    persistState();
                }
            }
        }, 1000L);
    }
    
    /**
     * Switches to pure GPS LocationManager for reliability when network is lost
     * or FusedLocationProviderClient is failing.
     */
    private void switchToGpsLocationProvider() {
        Log.d(TAG, "Switching to GPS-only LocationManager");
        removeLocationUpdates();
        
        // Wait for cleanup before registering new provider
        sensorRetryHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (isTracking && !paused && locationManager != null) {
                    try {
                        boolean hasFineLocation = ContextCompat.checkSelfPermission(
                            WalkService.this, 
                            Manifest.permission.ACCESS_FINE_LOCATION
                        ) == PackageManager.PERMISSION_GRANTED;
                        
                        if (hasFineLocation && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                            locationManager.requestLocationUpdates(
                                LocationManager.GPS_PROVIDER,
                                2000,
                                0,
                                WalkService.this
                            );
                            activeLocationProvider = "gps";
                            persistState();
                            Log.d(TAG, "GPS provider registered successfully");
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Failed to register GPS provider", e);
                    }
                }
            }
        }, 1000L);
    }

    private void registerStepListeners() {
        registerStepListenersWithRetry(0);
    }
    
    /**
     * Registers step sensors with validation and retry logic.
     * Ensures sensors actually work after registration by waiting for first event.
     * CRITICAL: Prevents duplicate registration attempts and cleans up pending validations.
     */
    private void registerStepListenersWithRetry(final int attemptNumber) {
        if (sensorManager == null) {
            Log.e(TAG, "SensorManager is null, cannot register step listeners");
            sensorsRegistered = false;
            publishUpdate("sensors_unavailable");
            return;
        }
        
        // CRITICAL: Prevent duplicate registration if already in progress
        if (isSensorRecoveryInProgress && attemptNumber > 0) {
            Log.d(TAG, "Sensor recovery already in progress, skipping duplicate attempt");
            return;
        }
        
        // Mark recovery in progress for retry attempts
        if (attemptNumber > 0) {
            isSensorRecoveryInProgress = true;
        }
        
        // Cancel any pending sensor validation from previous attempt
        if (pendingSensorValidation != null) {
            sensorRetryHandler.removeCallbacks(pendingSensorValidation);
            pendingSensorValidation = null;
        }
        
        // Unregister first to prevent double-registration
        try {
            sensorManager.unregisterListener(this);
            sensorsRegistered = false;
        } catch (Exception e) {
            Log.w(TAG, "Failed to unregister sensors before re-registration", e);
        }
        
        boolean anyRegistered = false;
        
        if (stepDetectorSensor != null) {
            boolean registered = sensorManager.registerListener(this, stepDetectorSensor, SensorManager.SENSOR_DELAY_FASTEST);
            if (registered) {
                Log.d(TAG, "Step detector registered (attempt " + (attemptNumber + 1) + ")");
                anyRegistered = true;
            }
        }
        
        if (stepCounterSensor != null) {
            boolean registered = sensorManager.registerListener(this, stepCounterSensor, SensorManager.SENSOR_DELAY_FASTEST);
            if (registered) {
                Log.d(TAG, "Step counter registered (attempt " + (attemptNumber + 1) + ")");
                anyRegistered = true;
            }
        }
        
        if (!anyRegistered) {
            Log.e(TAG, "No step sensors available or registration failed");
            sensorsRegistered = false;
            isSensorRecoveryInProgress = false;
            publishUpdate("sensors_unavailable");
            return;
        }
        
        sensorsRegistered = true;
        sensorRegistrationAttempts = attemptNumber + 1;
        isSensorRecoveryInProgress = false;
        
        persistState();
    }
    
    /**
     * Monitors step sensor health and recovers from HAL failures.
     * Called periodically from ticker. Detects stalled sensor streams.
     * CRITICAL: Prevents duplicate recovery attempts using isSensorRecoveryInProgress flag.
     */
    private void monitorSensorHealth() {
        if (!isTracking || paused || !sensorsRegistered) return;
        
        // CRITICAL: Do not start new recovery if one is already in progress
        if (isSensorRecoveryInProgress) {
            Log.d(TAG, "Sensor recovery already in progress, skipping health check");
            return;
        }
        
        long now = System.currentTimeMillis();
        // A sensor that NEVER delivered a single event (HAL quirk, missing
        // permission on a retry) must be treated as maximally stale — the old
        // `lastStepEventWallMs > 0L` guard skipped recovery for exactly those
        // walks and left them counting steps at 0 while GPS showed movement.
        long timeSinceLastStep = lastStepEventWallMs > 0L ? now - lastStepEventWallMs : Long.MAX_VALUE;

        // If GPS shows movement (speed > 0.5 m/s) but no step events for 30+ seconds,
        // sensor stream likely stalled
        if (timeSinceLastStep > 30_000L && lastLocation != null) {
            float speed = lastLocation.hasSpeed() ? lastLocation.getSpeed() : 0f;
            
            if (speed > 0.5f) {
                Log.w(TAG, "Sensor stream stalled (no steps for " + (timeSinceLastStep / 1000L) + "s but GPS shows movement), attempting recovery");
                
                // Mark recovery in progress and force re-registration
                isSensorRecoveryInProgress = true;
                sensorsRegistered = false;
                registerStepListenersWithRetry(0);
                publishUpdate("sensor_recovery_attempted");
            }
        }
    }

    /* ── Screen-on stream recovery ────────────────────────────────────────── */

    /**
     * TYPE_STEP_COUNTER / TYPE_STEP_DETECTOR are NON-wake-up sensors. On many
     * devices the HAL suspends their event stream while the screen is off; the
     * walk clock (wall-clock based) keeps advancing but steps freeze. When the
     * screen wakes, re-registering the listeners (and re-holding the wake
     * lock) restarts the stream instantly, and the STEP_COUNTER accumulator
     * baseline lets the service catch up the exact steps taken meanwhile.
     */
    private final BroadcastReceiver screenOnReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!isTracking || paused) return;
            acquireWakeLock();
            registerLocationUpdates();
            registerStepListeners();
            publishUpdate();
            persistState();
        }
    };

    private void registerScreenOnReceiver() {
        try {
            IntentFilter filter = new IntentFilter();
            filter.addAction(Intent.ACTION_SCREEN_ON);
            filter.addAction(Intent.ACTION_USER_PRESENT);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(screenOnReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(screenOnReceiver, filter);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to register screen-on receiver (may already be registered)", e);
        }
    }

    private void unregisterScreenOnReceiver() {
        try {
            unregisterReceiver(screenOnReceiver);
        } catch (Exception e) {
            Log.d(TAG, "Screen-on receiver not registered or already unregistered", e);
        }
    }

    private void updateNotification() {
        if (notificationManager == null) return;
        
        // If not yet in foreground, enter foreground first (creates builder)
        if (!isInForeground) {
            enterForeground();
            return;
        }
        
        // If pause state changed, we need to recreate the builder to update the
        // action button label (Pause ↔ Resume). Otherwise just update the content.
        if (lastNotifiedPauseState != paused) {
            createNotificationBuilder();
            lastNotifiedPauseState = paused;
        } else {
            // Only update title/text, don't touch actions (prevents flicker)
            updateNotificationContent();
        }
        
        // Notify with the updated notification - this does NOT recreate the
        // service or call startForeground() again, just updates the existing
        // notification with the same ID, preventing flicker.
        if (isTracking || paused) {
            notificationManager.notify(NOTIFICATION_ID, notificationBuilder.build());
        }
    }

    private void publishUpdate() {
        publishUpdate(null);
    }

    private void publishUpdate(String action) {
        WalkServicePlugin.publish(
                currentDistanceKm,
                currentSteps,
                lastLocation,
                isTracking,
                paused,
                durationSec,
                currentCalories,
                currentPace,
                updateCount,
                System.currentTimeMillis(),
                action,
                activeSessionId,
                isVehicleFlagged
        );
    }

    private void stopForegroundTracking() {
        isTracking = false;
        paused = false;
        isInForeground = false;
        notificationBuilder = null;
        initialStepCounterValue = -1;
        lastCounterTotal = -1L;
        gpsDistanceKm = 0.0;
        isVehicleFlagged = false;
        sensorsRegistered = false;
        isFusedLocationRequestActive = false;
        isLocationManagerRequestActive = false;
        activeLocationProvider = "none";
        batteryOptimizationWarningShown = false;
        isLocationRecoveryInProgress = false;
        isSensorRecoveryInProgress = false;
        
        // Stop AlarmManager ticker
        stopAlarmTicker();
        
        // Stop connectivity monitoring
        if (connectivityMonitor != null) {
            connectivityMonitor.stopMonitoring();
        }
        
        // CRITICAL: Clear ALL pending callbacks from retry handler to prevent
        // stale callbacks from firing after tracking stops
        if (sensorRetryHandler != null) {
            sensorRetryHandler.removeCallbacksAndMessages(null);
        }
        
        // Cancel pending sensor validation
        if (pendingSensorValidation != null) {
            sensorRetryHandler.removeCallbacks(pendingSensorValidation);
            pendingSensorValidation = null;
        }
        
        // Stop Handler ticker
        if (ticker != null) {
            ticker.removeCallbacks(tick);
        }
        
        unregisterScreenOnReceiver();
        removeLocationUpdates();
        if (sensorManager != null) {
            try {
                sensorManager.unregisterListener(this);
            } catch (Exception e) {
                Log.w(TAG, "Failed to unregister sensors during stop", e);
            }
        }
        releaseWakeLock();
        if (notificationManager != null) {
            notificationManager.cancel(NOTIFICATION_ID);
        }
        // Reset persisted state so a crash-restart does not resume a dead
        // walk. Skipped when the teardown is system-initiated with a live walk
        // (see onDestroy) — wiping there would destroy the exact snapshot the
        // recovery design relies on and silently lose the whole walk.
        if (!preserveStateOnTeardown) {
            prefs().edit().clear().apply();
            // Free the SQLite route storage for the finished session (the app
            // has already copied the points into the session record).
            if (dbHelper != null && activeSessionId != null) {
                dbHelper.clearPointsForSession(activeSessionId);
            }
        }
        activeSessionId = "current_session";
        // Reset the live counters so a getStatus() after stop never reports a
        // finished walk's leftovers as a fresh session's values.
        currentDistanceKm = 0.0;
        currentSteps = 0;
        durationSec = 0L;
        currentCalories = 0.0;
        currentPace = 0.0;
        startedAtMs = 0L;
        lastLocation = null;
        lastGpsFixWallMs = 0L;
        lastFixElapsedRealtime = 0L;
        lastStepEventWallMs = 0L;
        try {
            stopForeground(true);
        } catch (Exception e) {
            // ACTION_STOP may be delivered while the service was never in the
            // foreground (e.g. JS shutdown after a failed start) — safe no-op.
            Log.w(TAG, "stopForeground failed during stop tracking", e);
        }
        updateCount = 0;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // stopWithTask="false" keeps the service alive across a normal swipe,
        // but some OEMs kill the whole task (and the service) regardless.
        // Re-enter the foreground immediately so the walk survives — and
        // START_STICKY restarts the service if the process was still killed.
        if (isTracking) {
            Log.w(TAG, "Task removed while tracking — keeping the walk alive");
            try {
                resumeTrackingEnginesIfNeeded();
            } catch (Exception e) {
                Log.e(TAG, "Failed to keep walk alive after task removal", e);
            }
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        // Distinguish a deliberate stop (ACTION_STOP) from a system-initiated
        // teardown of a live walk (OEM task killer / battery manager stopping
        // the service, swipe-away on devices that ignore stopWithTask="false").
        // A live walk destroyed here must keep its SharedPreferences + SQLite
        // route points so START_STICKY recovery (or the app's restore flow)
        // resumes it from the freshest snapshot instead of silently losing
        // the whole walk to 0.00 km.
        if (isTracking && !explicitStopRequested) {
            Log.w(TAG, "onDestroy with a live walk — preserving persisted state for recovery");
            preserveStateOnTeardown = true;
            persistState();
        }
        stopForegroundTracking();
        // Remove the ticker callback to prevent leaks
        if (ticker != null) {
            ticker.removeCallbacks(tick);
        }
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
    /**
     * GPS-accumulated distance (km). Only ACCEPTED, plausible fix-to-fix
     * deltas are added here; the final reported distance is the larger of
     * this and the step-derived distance (steps × STRIDE_METERS), so distance
     * is monotonic, never stalls while steps flow, and never double-counts
     * (both estimate the same ground).
     */
    public static volatile double gpsDistanceKm = 0.0;
    /** User's body weight (kg) for calorie math, pushed from the app. */
    public static volatile double userWeightKg = 0.0;
    /**
     * Firestore session id the SQLite route points are stored under. Set from
     * the app at walk start so the route can be fetched and persisted into the
     * session record at finish — even after a process death / app swipe.
     */
    public static volatile String activeSessionId = "current_session";
    /**
     * Validation-only flag: set when the GPS implies vehicle-speed motion
     * (> 15 km/h) without matching step activity. NEVER auto-pauses — it only
     * surfaces in the UI and is saved with the finished session.
     */
    public static volatile boolean isVehicleFlagged = false;

    // Wall-clock bookkeeping so elapsed time keeps advancing while the app is
    // backgrounded or the screen is locked (a JS setInterval freezes). Duration
    // derives from startedAtMs alone: the ticker freezes it while paused, and
    // resume re-bases startedAtMs to continue exactly from the frozen value.
    private long startedAtMs = 0L;

    /** 
     * Handler-based ticker (fallback when AlarmManager unavailable).
     * Note: This ticker is NOT Doze-exempt and may be deferred in deep Doze.
     * AlarmManager ticker (startAlarmTicker) is preferred for reliability.
     */
    private final android.os.Handler ticker =
            new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (isTracking && !paused) {
                handleTickerUpdate();
            }
            ticker.postDelayed(this, 1000);
        }
    };

    private void startTicker() {
        // A paused walk is frozen: no ticker at all (the alarm variant would
        // burn a 1 Hz Doze-exempt wakeup per second doing nothing). The walk
        // clock restarts via ACTION_RESUME.
        if (paused) return;
        // Start AlarmManager ticker for Doze immunity if available
        if (useAlarmTicker && alarmManager != null) {
            startAlarmTicker();
        } else {
            // Fallback to Handler ticker (not Doze-exempt)
            Log.w(TAG, "Using Handler ticker (not Doze-exempt)");
            ticker.removeCallbacks(tick);
            ticker.postDelayed(tick, 1000);
        }
    }

    private void recomputeDerived() {
        // Distance (km) recomputed from the CURRENT step total on every
        // tick/fix/step: steps × stride / 1000. It is never accumulated
        // separately, so it can never drift out of sync with the step counter
        // or sit at 0.00 km while steps are counting. GPS-accumulated distance
        // only ever raises the estimate (larger of the two sources), and the
        // whole value is monotonic (never decreases mid-session).
        double stepKm = (currentSteps * STRIDE_METERS) / 1000.0;
        currentDistanceKm = Math.max(currentDistanceKm, Math.max(stepKm, gpsDistanceKm));

        double km = currentDistanceKm;
        currentPace = (km > 0.001 && durationSec > 0) ? (durationSec / 60.0) / km : 0.0;
        // Calories (kcal): MET-based formula — MET_WALKING × weight ×
        // duration_hours. Recomputed from CURRENT duration on every tick, so
        // it can never stay at 0 while a walk is running. When the user's
        // weight was never provided, calories stay 0 — no default is invented.
        currentCalories = userWeightKg > 0.0
                ? MET_WALKING * userWeightKg * (durationSec / 3600.0)
                : 0.0;

        Log.d(TAG, "recompute: steps=" + currentSteps
                + " stepKm=" + String.format(java.util.Locale.US, "%.4f", stepKm)
                + " gpsKm=" + String.format(java.util.Locale.US, "%.4f", gpsDistanceKm)
                + " distanceKm=" + String.format(java.util.Locale.US, "%.4f", currentDistanceKm)
                + " durationSec=" + durationSec
                + " calories=" + String.format(java.util.Locale.US, "%.1f", currentCalories));
    }

    // LocationListener callbacks
    @Override
    public void onLocationChanged(Location location) {
        if (location == null || !isTracking || paused) return;
        long nowWall = System.currentTimeMillis();
        if (Math.abs(nowWall - location.getTime()) > 10_000) return; // stale fix
        // Accuracy threshold: reject only severely degraded fixes (> 30m). Real
        // devices routinely report 16-30m accuracy indoors/urban canyon — a
        // stricter 15m gate rejected almost every fix and froze walks at 0.00 km.
        if (location.getAccuracy() > 30.0f) return;
        
        // CRITICAL: Prevent GPS/Fused double-counting - both providers can report the same fix
        // If timestamp matches last processed location (within 100ms), it's a duplicate
        if (Math.abs(location.getTime() - lastProcessedLocationTimeMs) < 100) {
            Log.d(TAG, "Duplicate location with same timestamp, skipping (prevents GPS/Fused double-count)");
            return;
        }
        lastProcessedLocationTimeMs = location.getTime();

        if (lastLocation != null) {
            float distMeters = lastLocation.distanceTo(location);
            long nowElapsed = SystemClock.elapsedRealtime();
            long dtMs = lastFixElapsedRealtime > 0L ? nowElapsed - lastFixElapsedRealtime : 0L;
            float speedMs = location.hasSpeed() ? location.getSpeed() : (dtMs > 0L ? (distMeters * 1000f) / (float) dtMs : 0f);

            // Minimum displacement gate: ignore points < 1m from previous point to eliminate stationary GPS jitter
            // (was 3m — too aggressive for slow walking and short indoor steps; the
            // JS fallback uses 1.0m, so keep both engines aligned).
            boolean distancePlausible = distMeters >= 1.0f && distMeters <= 50.0f;
            // Max speed gate: human walking/running max ~25.2 km/h (7.0 m/s). Rejects GPS teleport/jump spikes.
            boolean speedPlausible = speedMs <= 7.0f;

            // Motion evidence gate: a GPS delta only counts as real movement
            // when the step sensors confirm an active walking cadence (a step
            // event within the last 15s) OR the fix implies walking speed.
            // `speedMs` already falls back to a displacement/time estimate when
            // the provider omits speed (common with the fused provider), so a
            // real walk still counts on devices whose step-sensor stream never
            // registers (no sensor / denied / HAL quirk) — previously such
            // walks stayed frozen at 0.00 km. Stationary GPS wobble stays
            // rejected by the 3m minimum displacement + <=7 m/s caps below.
            boolean stepsFresh = nowWall - lastStepEventWallMs < 15_000L;
            boolean providerSpeedMoving = location.hasSpeed() && location.getSpeed() >= 0.5f;
            boolean computedSpeedMoving = speedMs >= 0.5f;
            boolean motionPlausible = stepsFresh || providerSpeedMoving || computedSpeedMoving;

            // Vehicle detection flag: sustained speed > 15 km/h (4.16 m/s) with minimal step activity
            // Only flag if: speed exceeds threshold AND less than 5 steps in 20 seconds
            // This reduces false positives from brief GPS jumps or standing still at traffic lights
            if (speedMs > 4.16f) {
                if (nowWall - lastVehicleCheckWallMs > 20000L) {
                    int stepsSinceLastCheck = currentSteps - stepsAtLastVehicleCheck;
                    // Require sustained low step activity (< 5 steps in 20s = < 15 steps/min)
                    // Normal walking is ~100-120 steps/min, so this clearly indicates vehicle use
                    if (stepsSinceLastCheck < 5) {
                        isVehicleFlagged = true;
                        if (dbHelper != null) {
                            dbHelper.setVehicleFlagged(activeSessionId, true, speedMs);
                        }
                        Log.w(TAG, "Vehicle motion detected: speed=" + speedMs + " m/s, steps=" + stepsSinceLastCheck + " in 20s");
                    }
                    lastVehicleCheckWallMs = nowWall;
                    stepsAtLastVehicleCheck = currentSteps;
                }
            }

            boolean accepted = distancePlausible && speedPlausible && motionPlausible;
            if (accepted) {
                gpsDistanceKm += (distMeters / 1000.0);
                // updateCount only grows on ACCEPTED fixes (plus the baseline
                // first fix) — rejected stationary-jitter fixes must not look
                // like motion, or JS would never auto-pause a stopped walk.
                updateCount++;
                lastGpsFixWallMs = nowWall;

                // Step floor: ensure step count never stalls behind GPS walking
                // displacement during screen lock. Skipped while vehicle motion
                // is flagged — a car ride would otherwise invent thousands of
                // "steps" from the GPS distance (e.g. 10 km ≈ 13,000 fake steps).
                if (!isVehicleFlagged) {
                    int impliedSteps = (int) Math.round((gpsDistanceKm * 1000.0) / STRIDE_METERS);
                    if (impliedSteps > currentSteps) {
                        currentSteps = impliedSteps;
                    }
                }

                // Save accepted point to SQLite DB for persistent route rendering
                if (dbHelper != null) {
                    dbHelper.insertPoint(
                            activeSessionId,
                            location.getLatitude(),
                            location.getLongitude(),
                            location.hasAltitude() ? location.getAltitude() : 0.0,
                            location.getAccuracy(),
                            speedMs,
                            location.getTime()
                    );
                }
            }
            lastFixElapsedRealtime = nowElapsed;

            Log.d(TAG, "fix: lat=" + location.getLatitude()
                    + " lng=" + location.getLongitude()
                    + " acc=" + location.getAccuracy()
                    + " distMeters=" + distMeters
                    + " speedMs=" + speedMs
                    + " accepted=" + accepted
                    + " gpsKm=" + String.format(java.util.Locale.US, "%.4f", gpsDistanceKm));
        } else {
            // First fix after start: save starting point and establish baseline
            lastLocation = location;
            lastFixElapsedRealtime = SystemClock.elapsedRealtime();
            lastGpsFixWallMs = nowWall;
            updateCount++;

            if (dbHelper != null) {
                dbHelper.insertPoint(
                        activeSessionId,
                        location.getLatitude(),
                        location.getLongitude(),
                        location.hasAltitude() ? location.getAltitude() : 0.0,
                        location.getAccuracy(),
                        location.hasSpeed() ? location.getSpeed() : 0f,
                        location.getTime()
                );
            }

            recomputeDerived();
            updateNotification();
            publishUpdate();
            persistState();
            return;
        }
        
        lastLocation = location;
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
                // Check for either FINE or COARSE location permission
                boolean hasFineLocation = ContextCompat.checkSelfPermission(this, 
                        Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                        
                if (hasFineLocation) {
                    locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000, 0, this);
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to re-register location updates on provider enabled", e);
            }
        }
    }

    @Override
    @Deprecated
    public void onStatusChanged(String provider, int status, Bundle extras) {
        // Deprecated since API 29, no action needed - onProviderEnabled/Disabled handle provider changes
    }

    @Override
    public void onProviderDisabled(String provider) {
        // CRITICAL: When user explicitly disables location provider (GPS/network),
        // stop attempting to register location updates for that provider.
        // The service will resume automatically when provider is re-enabled via onProviderEnabled().
        Log.w(TAG, "Location provider disabled: " + provider);
        
        if (LocationManager.GPS_PROVIDER.equals(provider)) {
            if ("gps".equals(activeLocationProvider)) {
                Log.w(TAG, "GPS provider disabled while active, location tracking paused");
                publishUpdate("gps_disabled");
                // Do NOT endlessly retry registration - wait for onProviderEnabled
                activeLocationProvider = "none";
                persistState();
            }
        } else if (LocationManager.NETWORK_PROVIDER.equals(provider)) {
            if ("network".equals(activeLocationProvider)) {
                Log.w(TAG, "Network provider disabled while active, attempting GPS fallback");
                // Try GPS as fallback if available
                if (isTracking && !paused && locationManager != null) {
                    boolean hasFineLocation = ContextCompat.checkSelfPermission(this, 
                            Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                    if (hasFineLocation && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                        try {
                            locationManager.requestLocationUpdates(
                                LocationManager.GPS_PROVIDER,
                                2000,
                                0,
                                this
                            );
                            activeLocationProvider = "gps";
                            persistState();
                            Log.d(TAG, "Switched to GPS provider");
                        } catch (Exception e) {
                            Log.e(TAG, "Failed to switch to GPS provider", e);
                            activeLocationProvider = "none";
                            publishUpdate("location_unavailable");
                        }
                    } else {
                        activeLocationProvider = "none";
                        publishUpdate("location_unavailable");
                    }
                }
            }
        }
    }

    // SensorEventListener callbacks
    @Override
    public void onSensorChanged(SensorEvent event) {
        if (!isTracking || paused) return;

        if (event.sensor.getType() == Sensor.TYPE_STEP_DETECTOR) {
            // TYPE_STEP_DETECTOR: one event per physical step detected.
            lastStepEventWallMs = System.currentTimeMillis();
            currentSteps++;
            Log.d(TAG, "step: detector total=" + currentSteps);
            recomputeDerived();
            updateNotification();
            publishUpdate();
            persistState();
        } else if (event.sensor.getType() == Sensor.TYPE_STEP_COUNTER) {
            // TYPE_STEP_COUNTER: hardware accumulator since boot (or since the
            // last reboot). The walk's count is total − baseline. `lastCounterTotal`
            // is the last hardware value WE saw (persisted across process death);
            // the difference total − lastCounterTotal is exactly the steps taken
            // while the stream was dead (screen-off stall, killed process) and
            // must be credited on the FIRST event after resume.
            long total = (long) event.values[0];
            lastStepEventWallMs = System.currentTimeMillis();
            Log.d(TAG, "step: counter raw=" + total
                    + " baseline=" + initialStepCounterValue
                    + " lastTotal=" + lastCounterTotal
                    + " currentSteps=" + currentSteps);

            boolean changed = false;
            boolean rebased = false;

            // CRITICAL: First event of this walk, or device rebooted (counter restarts near
            // zero) — establish/re-establish the baseline from the walk's CURRENT
            // step count so the walk is never double-counted on resume and never
            // loses earned steps on reboot.
            if (initialStepCounterValue < 0 || total < initialStepCounterValue) {
                // Fresh baseline: set it such that (total - baseline) = currentSteps
                initialStepCounterValue = (int) (total - currentSteps);
                lastCounterTotal = total;
                rebased = true;
                Log.d(TAG, "step: counter REBASED baseline=" + initialStepCounterValue + " at total=" + total + " (preserving currentSteps=" + currentSteps + ")");
            } else {
                int calculatedSteps = (int) (total - initialStepCounterValue);
                if (calculatedSteps > currentSteps) {
                    currentSteps = calculatedSteps;
                    lastCounterTotal = total;
                    changed = true;
                    Log.d(TAG, "step: counter sync to " + currentSteps);
                }
            }

            if (changed) {
                Log.d(TAG, "step: counter newTotal=" + currentSteps);
                recomputeDerived();
                updateNotification();
                publishUpdate();
                persistState();
            } else if (rebased) {
                // Persist the fresh baseline immediately so a process death
                // right after start can still resume against the same counter.
                persistState();
            }
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
    }
}
