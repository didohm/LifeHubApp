package com.lifehub.app;

import android.content.SharedPreferences;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Diagnostic logging system for WalkService debugging.
 * 
 * Maintains a circular buffer of the last 100 log entries in SharedPreferences,
 * accessible from JS via WalkServicePlugin.getDiagnosticLogs(). Each log entry
 * includes timestamp, category, level, and message for post-mortem analysis
 * of background execution issues on user devices.
 */
public class WalkDiagnostics {
    
    private static final String TAG = "LifeHubDiagnostics";
    private static final String PREFS_NAME = "lifehub_walk_diagnostics";
    private static final String KEY_LOGS = "diagnostic_logs";
    private static final int MAX_LOG_ENTRIES = 100;
    
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
    
    public WalkDiagnostics(android.content.Context context) {
        this.prefs = context.getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE);
        this.dateFormat = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US);
    }
    
    /**
     * Logs a diagnostic event with timestamp, category, level, and message.
     */
    public void log(String category, String level, String message) {
        try {
            JSONArray logs = getLogs();
            
            JSONObject entry = new JSONObject();
            entry.put("timestamp", dateFormat.format(new Date()));
            entry.put("category", category);
            entry.put("level", level);
            entry.put("message", message);
            
            // Add to end of array
            logs.put(entry);
            
            // Keep only last MAX_LOG_ENTRIES
            if (logs.length() > MAX_LOG_ENTRIES) {
                JSONArray trimmed = new JSONArray();
                for (int i = logs.length() - MAX_LOG_ENTRIES; i < logs.length(); i++) {
                    trimmed.put(logs.get(i));
                }
                logs = trimmed;
            }
            
            // Save back to SharedPreferences
            prefs.edit().putString(KEY_LOGS, logs.toString()).apply();
            
            // Also log to logcat
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
     * Retrieves all diagnostic logs as JSONArray.
     */
    public JSONArray getLogs() {
        try {
            String logsJson = prefs.getString(KEY_LOGS, "[]");
            return new JSONArray(logsJson);
        } catch (Exception e) {
            Log.e(TAG, "Failed to read diagnostic logs", e);
            return new JSONArray();
        }
    }
    
    /**
     * Clears all diagnostic logs.
     */
    public void clearLogs() {
        prefs.edit().remove(KEY_LOGS).apply();
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
