package com.lifehub.app;

import android.content.SharedPreferences;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Diagnostic logging system for WalkService debugging.
 * 
 * Maintains a circular buffer of the last 100 log entries with in-memory buffering
 * and periodic flushing to SharedPreferences for performance. Accessible from JS via
 * WalkServicePlugin.getDiagnosticLogs(). Each log entry includes timestamp, category,
 * level, and message for post-mortem analysis of background execution issues.
 */
public class WalkDiagnostics {
    
    private static final String TAG = "LifeHubDiagnostics";
    private static final String PREFS_NAME = "lifehub_walk_diagnostics";
    private static final String KEY_LOGS = "diagnostic_logs";
    private static final int MAX_LOG_ENTRIES = 100;
    private static final int FLUSH_THRESHOLD = 10; // Flush after 10 logs
    private static final long FLUSH_INTERVAL_MS = 30_000L; // Or flush every 30s
    
    // Log categories for filtering
    public static final String CAT_WAKELOCK = "WakeLock";
    public static final String CAT_SENSORS = "Sensors";
    public static final String CAT_GPS = "GPS";
    public static final String CAT_TICKER = "Ticker";
    public static final String CAT_NETWORK = "Network";
    public static final String CAT_BATTERY = "Battery";
    public static final String CAT_LIFECYCLE = "Lifecycle";
    public static final String CAT_PERMISSIONS = "Permissions";
    
    // Log levels
    public static final String LEVEL_DEBUG = "DEBUG";
    public static final String LEVEL_INFO = "INFO";
    public static final String LEVEL_WARN = "WARN";
    public static final String LEVEL_ERROR = "ERROR";
    
    private final SharedPreferences prefs;
    private final SimpleDateFormat dateFormat;
    private final List<JSONObject> memoryBuffer;
    private long lastFlushTimeMs = 0L;
    private boolean isDirty = false;
    
    public WalkDiagnostics(android.content.Context context) {
        this.prefs = context.getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE);
        this.dateFormat = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US);
        this.memoryBuffer = new ArrayList<>();
        this.lastFlushTimeMs = System.currentTimeMillis();
        
        // Load existing logs from SharedPreferences into memory buffer on init
        loadFromPreferences();
    }
    
    /**
     * Load existing logs from SharedPreferences into memory buffer on initialization.
     */
    private synchronized void loadFromPreferences() {
        try {
            String logsJson = prefs.getString(KEY_LOGS, "[]");
            JSONArray array = new JSONArray(logsJson);
            memoryBuffer.clear();
            for (int i = 0; i < array.length(); i++) {
                memoryBuffer.add(array.getJSONObject(i));
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to load logs from SharedPreferences", e);
            memoryBuffer.clear();
        }
    }
    
    /**
     * Logs a diagnostic event with timestamp, category, level, and message.
     * Uses in-memory buffer with periodic flushing to avoid excessive disk I/O.
     * Automatically flushes when buffer reaches threshold or time interval passes.
     */
    public synchronized void log(String category, String level, String message) {
        try {
            JSONObject entry = new JSONObject();
            entry.put("timestamp", dateFormat.format(new Date()));
            entry.put("category", category);
            entry.put("level", level);
            entry.put("message", message);
            
            // Add to in-memory buffer
            memoryBuffer.add(entry);
            isDirty = true;
            
            // Trim buffer if it exceeds max size
            while (memoryBuffer.size() > MAX_LOG_ENTRIES) {
                memoryBuffer.remove(0);
            }
            
            // Auto-flush if threshold reached or time interval passed
            long now = System.currentTimeMillis();
            boolean shouldFlush = memoryBuffer.size() >= FLUSH_THRESHOLD 
                    || (now - lastFlushTimeMs) >= FLUSH_INTERVAL_MS;
            
            if (shouldFlush) {
                flushToPreferences();
            }
            
            // Also log to logcat for immediate visibility
            switch (level) {
                case LEVEL_ERROR:
                    Log.e(TAG, "[" + category + "] " + message);
                    break;
                case LEVEL_WARN:
                    Log.w(TAG, "[" + category + "] " + message);
                    break;
                case LEVEL_INFO:
                    Log.i(TAG, "[" + category + "] " + message);
                    break;
                default:
                    Log.d(TAG, "[" + category + "] " + message);
                    break;
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to write diagnostic log", e);
        }
    }
    
    /**
     * Flush in-memory buffer to SharedPreferences.
     * Called automatically based on threshold/interval, or manually when needed.
     */
    private synchronized void flushToPreferences() {
        if (!isDirty) return;
        
        try {
            JSONArray logs = new JSONArray();
            for (JSONObject entry : memoryBuffer) {
                logs.put(entry);
            }
            prefs.edit().putString(KEY_LOGS, logs.toString()).apply();
            lastFlushTimeMs = System.currentTimeMillis();
            isDirty = false;
        } catch (Exception e) {
            Log.e(TAG, "Failed to flush logs to SharedPreferences", e);
        }
    }
    
    /**
     * Explicitly flush logs to disk. Call this before service destruction or
     * when you need to ensure logs are persisted immediately.
     */
    public void flush() {
        flushToPreferences();
    }
    
    /**
     * Convenience methods for different log levels.
     */
    public void debug(String category, String message) {
        log(category, LEVEL_DEBUG, message);
    }
    
    public void info(String category, String message) {
        log(category, LEVEL_INFO, message);
    }
    
    public void warn(String category, String message) {
        log(category, LEVEL_WARN, message);
    }
    
    public void error(String category, String message) {
        log(category, LEVEL_ERROR, message);
    }
    
    /**
     * Retrieves all diagnostic logs as JSONArray from in-memory buffer.
     */
    public synchronized JSONArray getLogs() {
        try {
            JSONArray logs = new JSONArray();
            for (JSONObject entry : memoryBuffer) {
                logs.put(entry);
            }
            return logs;
        } catch (Exception e) {
            Log.e(TAG, "Failed to read diagnostic logs", e);
            return new JSONArray();
        }
    }
    
    /**
     * Clears all diagnostic logs from memory and SharedPreferences.
     */
    public synchronized void clearLogs() {
        memoryBuffer.clear();
        prefs.edit().remove(KEY_LOGS).apply();
        isDirty = false;
        Log.d(TAG, "Diagnostic logs cleared");
    }
    
    /**
     * Gets logs filtered by category.
     */
    public JSONArray getLogsByCategory(String category) {
        try {
            JSONArray allLogs = getLogs();
            JSONArray filtered = new JSONArray();
            
            for (int i = 0; i < allLogs.length(); i++) {
                JSONObject entry = allLogs.getJSONObject(i);
                if (category.equals(entry.optString("category"))) {
                    filtered.put(entry);
                }
            }
            
            return filtered;
        } catch (Exception e) {
            Log.e(TAG, "Failed to filter logs by category", e);
            return new JSONArray();
        }
    }
    
    /**
     * Gets logs filtered by level.
     */
    public JSONArray getLogsByLevel(String level) {
        try {
            JSONArray allLogs = getLogs();
            JSONArray filtered = new JSONArray();
            
            for (int i = 0; i < allLogs.length(); i++) {
                JSONObject entry = allLogs.getJSONObject(i);
                if (level.equals(entry.optString("level"))) {
                    filtered.put(entry);
                }
            }
            
            return filtered;
        } catch (Exception e) {
            Log.e(TAG, "Failed to filter logs by level", e);
            return new JSONArray();
        }
    }
}
