package com.lifehub.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class WalkDatabaseHelper extends SQLiteOpenHelper {

    private static final String TAG = "WalkDatabaseHelper";
    private static final String DATABASE_NAME = "lifehub_walk.db";
    private static final int DATABASE_VERSION = 2;

    public static final String TABLE_POINTS = "route_points";
    public static final String COLUMN_ID = "id";
    public static final String COLUMN_SESSION_ID = "session_id";
    public static final String COLUMN_LATITUDE = "latitude";
    public static final String COLUMN_LONGITUDE = "longitude";
    public static final String COLUMN_ALTITUDE = "altitude";
    public static final String COLUMN_ACCURACY = "accuracy";
    public static final String COLUMN_SPEED = "speed";
    public static final String COLUMN_TIMESTAMP = "timestamp";

    public static final String TABLE_META = "walk_session_meta";
    public static final String COLUMN_META_SESSION_ID = "session_id";
    public static final String COLUMN_META_VEHICLE = "is_vehicle_flagged";
    public static final String COLUMN_META_MAX_SPEED = "max_speed";

    // Walk summaries table
    public static final String TABLE_SUMMARIES = "walk_summaries";
    public static final String COLUMN_SUMMARY_ID = "id";
    public static final String COLUMN_SUMMARY_USER_ID = "user_id";
    public static final String COLUMN_SUMMARY_STATUS = "status";
    public static final String COLUMN_SUMMARY_DURATION = "duration";
    public static final String COLUMN_SUMMARY_DISTANCE = "distance";
    public static final String COLUMN_SUMMARY_CALORIES = "calories";
    public static final String COLUMN_SUMMARY_STEPS = "steps";
    public static final String COLUMN_SUMMARY_AVG_PACE = "avg_pace";
    public static final String COLUMN_SUMMARY_ELEVATION_GAIN = "elevation_gain";
    public static final String COLUMN_SUMMARY_ELEVATION_LOSS = "elevation_loss";
    public static final String COLUMN_SUMMARY_DAY = "day";
    public static final String COLUMN_SUMMARY_STARTED_AT = "started_at";
    public static final String COLUMN_SUMMARY_FINISHED_AT = "finished_at";
    public static final String COLUMN_SUMMARY_ENCODED_POLYLINE = "encoded_polyline";
    public static final String COLUMN_SUMMARY_START_LAT = "start_lat";
    public static final String COLUMN_SUMMARY_START_LNG = "start_lng";
    public static final String COLUMN_SUMMARY_END_LAT = "end_lat";
    public static final String COLUMN_SUMMARY_END_LNG = "end_lng";
    public static final String COLUMN_SUMMARY_PHOTO_URLS = "photo_urls";
    public static final String COLUMN_SUMMARY_VEHICLE_FLAGGED = "vehicle_flagged";
    public static final String COLUMN_SUMMARY_CREATED_AT = "created_at";
    public static final String COLUMN_SUMMARY_UPDATED_AT = "updated_at";

    // Walk splits table
    public static final String TABLE_SPLITS = "walk_splits";
    public static final String COLUMN_SPLIT_ID = "id";
    public static final String COLUMN_SPLIT_SESSION_ID = "session_id";
    public static final String COLUMN_SPLIT_NUMBER = "split_number";
    public static final String COLUMN_SPLIT_DISTANCE = "distance";
    public static final String COLUMN_SPLIT_DURATION = "duration";
    public static final String COLUMN_SPLIT_PACE = "pace";
    public static final String COLUMN_SPLIT_ELEVATION_CHANGE = "elevation_change";

    private static WalkDatabaseHelper instance;

    public static synchronized WalkDatabaseHelper getInstance(Context context) {
        if (instance == null) {
            instance = new WalkDatabaseHelper(context.getApplicationContext());
        }
        return instance;
    }

    private WalkDatabaseHelper(Context context) {
        super(context, DATABASE_NAME, null, DATABASE_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        String createPointsTable = "CREATE TABLE " + TABLE_POINTS + " (" +
                COLUMN_ID + " INTEGER PRIMARY KEY AUTOINCREMENT, " +
                COLUMN_SESSION_ID + " TEXT NOT NULL, " +
                COLUMN_LATITUDE + " REAL NOT NULL, " +
                COLUMN_LONGITUDE + " REAL NOT NULL, " +
                COLUMN_ALTITUDE + " REAL NOT NULL DEFAULT 0.0, " +
                COLUMN_ACCURACY + " REAL NOT NULL DEFAULT 0.0, " +
                COLUMN_SPEED + " REAL NOT NULL DEFAULT 0.0, " +
                COLUMN_TIMESTAMP + " INTEGER NOT NULL);";

        String createMetaTable = "CREATE TABLE " + TABLE_META + " (" +
                COLUMN_META_SESSION_ID + " TEXT PRIMARY KEY, " +
                COLUMN_META_VEHICLE + " INTEGER DEFAULT 0, " +
                COLUMN_META_MAX_SPEED + " REAL DEFAULT 0.0);";

        String createSummariesTable = "CREATE TABLE " + TABLE_SUMMARIES + " (" +
                COLUMN_SUMMARY_ID + " TEXT PRIMARY KEY, " +
                COLUMN_SUMMARY_USER_ID + " TEXT NOT NULL, " +
                COLUMN_SUMMARY_STATUS + " TEXT NOT NULL, " +
                COLUMN_SUMMARY_DURATION + " INTEGER NOT NULL, " +
                COLUMN_SUMMARY_DISTANCE + " REAL NOT NULL, " +
                COLUMN_SUMMARY_CALORIES + " REAL NOT NULL, " +
                COLUMN_SUMMARY_STEPS + " INTEGER NOT NULL, " +
                COLUMN_SUMMARY_AVG_PACE + " REAL, " +
                COLUMN_SUMMARY_ELEVATION_GAIN + " REAL, " +
                COLUMN_SUMMARY_ELEVATION_LOSS + " REAL, " +
                COLUMN_SUMMARY_DAY + " TEXT NOT NULL, " +
                COLUMN_SUMMARY_STARTED_AT + " TEXT NOT NULL, " +
                COLUMN_SUMMARY_FINISHED_AT + " TEXT, " +
                COLUMN_SUMMARY_ENCODED_POLYLINE + " TEXT, " +
                COLUMN_SUMMARY_START_LAT + " REAL, " +
                COLUMN_SUMMARY_START_LNG + " REAL, " +
                COLUMN_SUMMARY_END_LAT + " REAL, " +
                COLUMN_SUMMARY_END_LNG + " REAL, " +
                COLUMN_SUMMARY_PHOTO_URLS + " TEXT, " +
                COLUMN_SUMMARY_VEHICLE_FLAGGED + " INTEGER DEFAULT 0, " +
                COLUMN_SUMMARY_CREATED_AT + " TEXT NOT NULL, " +
                COLUMN_SUMMARY_UPDATED_AT + " TEXT NOT NULL);";

        String createSplitsTable = "CREATE TABLE " + TABLE_SPLITS + " (" +
                COLUMN_SPLIT_ID + " INTEGER PRIMARY KEY AUTOINCREMENT, " +
                COLUMN_SPLIT_SESSION_ID + " TEXT NOT NULL, " +
                COLUMN_SPLIT_NUMBER + " INTEGER NOT NULL, " +
                COLUMN_SPLIT_DISTANCE + " REAL NOT NULL, " +
                COLUMN_SPLIT_DURATION + " INTEGER NOT NULL, " +
                COLUMN_SPLIT_PACE + " REAL NOT NULL, " +
                COLUMN_SPLIT_ELEVATION_CHANGE + " REAL, " +
                "FOREIGN KEY(" + COLUMN_SPLIT_SESSION_ID + ") REFERENCES " + 
                TABLE_SUMMARIES + "(" + COLUMN_SUMMARY_ID + ") ON DELETE CASCADE);";

        db.execSQL(createPointsTable);
        db.execSQL(createMetaTable);
        db.execSQL(createSummariesTable);
        db.execSQL(createSplitsTable);

        // Indexes for fast query lookup
        db.execSQL("CREATE INDEX idx_session ON " + TABLE_POINTS + "(" + COLUMN_SESSION_ID + ");");
        db.execSQL("CREATE INDEX idx_user_day ON " + TABLE_SUMMARIES + "(" + COLUMN_SUMMARY_USER_ID + ", " + COLUMN_SUMMARY_DAY + " DESC);");
        db.execSQL("CREATE INDEX idx_user_finished ON " + TABLE_SUMMARIES + "(" + COLUMN_SUMMARY_USER_ID + ", " + COLUMN_SUMMARY_FINISHED_AT + " DESC);");
        db.execSQL("CREATE INDEX idx_splits_session ON " + TABLE_SPLITS + "(" + COLUMN_SPLIT_SESSION_ID + ", " + COLUMN_SPLIT_NUMBER + ");");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) {
            // Add walk summaries and splits tables for Strava-like features
            String createSummariesTable = "CREATE TABLE " + TABLE_SUMMARIES + " (" +
                    COLUMN_SUMMARY_ID + " TEXT PRIMARY KEY, " +
                    COLUMN_SUMMARY_USER_ID + " TEXT NOT NULL, " +
                    COLUMN_SUMMARY_STATUS + " TEXT NOT NULL, " +
                    COLUMN_SUMMARY_DURATION + " INTEGER NOT NULL, " +
                    COLUMN_SUMMARY_DISTANCE + " REAL NOT NULL, " +
                    COLUMN_SUMMARY_CALORIES + " REAL NOT NULL, " +
                    COLUMN_SUMMARY_STEPS + " INTEGER NOT NULL, " +
                    COLUMN_SUMMARY_AVG_PACE + " REAL, " +
                    COLUMN_SUMMARY_ELEVATION_GAIN + " REAL, " +
                    COLUMN_SUMMARY_ELEVATION_LOSS + " REAL, " +
                    COLUMN_SUMMARY_DAY + " TEXT NOT NULL, " +
                    COLUMN_SUMMARY_STARTED_AT + " TEXT NOT NULL, " +
                    COLUMN_SUMMARY_FINISHED_AT + " TEXT, " +
                    COLUMN_SUMMARY_ENCODED_POLYLINE + " TEXT, " +
                    COLUMN_SUMMARY_START_LAT + " REAL, " +
                    COLUMN_SUMMARY_START_LNG + " REAL, " +
                    COLUMN_SUMMARY_END_LAT + " REAL, " +
                    COLUMN_SUMMARY_END_LNG + " REAL, " +
                    COLUMN_SUMMARY_PHOTO_URLS + " TEXT, " +
                    COLUMN_SUMMARY_VEHICLE_FLAGGED + " INTEGER DEFAULT 0, " +
                    COLUMN_SUMMARY_CREATED_AT + " TEXT NOT NULL, " +
                    COLUMN_SUMMARY_UPDATED_AT + " TEXT NOT NULL);";

            String createSplitsTable = "CREATE TABLE " + TABLE_SPLITS + " (" +
                    COLUMN_SPLIT_ID + " INTEGER PRIMARY KEY AUTOINCREMENT, " +
                    COLUMN_SPLIT_SESSION_ID + " TEXT NOT NULL, " +
                    COLUMN_SPLIT_NUMBER + " INTEGER NOT NULL, " +
                    COLUMN_SPLIT_DISTANCE + " REAL NOT NULL, " +
                    COLUMN_SPLIT_DURATION + " INTEGER NOT NULL, " +
                    COLUMN_SPLIT_PACE + " REAL NOT NULL, " +
                    COLUMN_SPLIT_ELEVATION_CHANGE + " REAL, " +
                    "FOREIGN KEY(" + COLUMN_SPLIT_SESSION_ID + ") REFERENCES " + 
                    TABLE_SUMMARIES + "(" + COLUMN_SUMMARY_ID + ") ON DELETE CASCADE);";

            db.execSQL(createSummariesTable);
            db.execSQL(createSplitsTable);

            // Add indexes
            db.execSQL("CREATE INDEX idx_user_day ON " + TABLE_SUMMARIES + "(" + COLUMN_SUMMARY_USER_ID + ", " + COLUMN_SUMMARY_DAY + " DESC);");
            db.execSQL("CREATE INDEX idx_user_finished ON " + TABLE_SUMMARIES + "(" + COLUMN_SUMMARY_USER_ID + ", " + COLUMN_SUMMARY_FINISHED_AT + " DESC);");
            db.execSQL("CREATE INDEX idx_splits_session ON " + TABLE_SPLITS + "(" + COLUMN_SPLIT_SESSION_ID + ", " + COLUMN_SPLIT_NUMBER + ");");
        }
    }

    public synchronized void insertPoint(String sessionId, double lat, double lng, double altitude, float accuracy, float speed, long timestamp) {
        if (sessionId == null || sessionId.isEmpty()) {
            sessionId = "current_session";
        }
        SQLiteDatabase db = this.getWritableDatabase();
        ContentValues values = new ContentValues();
        values.put(COLUMN_SESSION_ID, sessionId);
        values.put(COLUMN_LATITUDE, lat);
        values.put(COLUMN_LONGITUDE, lng);
        values.put(COLUMN_ALTITUDE, altitude);
        values.put(COLUMN_ACCURACY, accuracy);
        values.put(COLUMN_SPEED, speed);
        values.put(COLUMN_TIMESTAMP, timestamp);

        try {
            db.insert(TABLE_POINTS, null, values);
        } catch (Exception e) {
            Log.e(TAG, "Error inserting point into SQLite DB", e);
        }
    }

    public synchronized JSONArray getPointsJsonForSession(String sessionId) {
        JSONArray arr = new JSONArray();
        if (sessionId == null || sessionId.isEmpty()) {
            sessionId = "current_session";
        }
        SQLiteDatabase db = this.getReadableDatabase();
        Cursor cursor = null;
        try {
            cursor = db.query(TABLE_POINTS,
                    new String[]{COLUMN_LATITUDE, COLUMN_LONGITUDE, COLUMN_ALTITUDE, COLUMN_ACCURACY, COLUMN_SPEED, COLUMN_TIMESTAMP},
                    COLUMN_SESSION_ID + "=?",
                    new String[]{sessionId},
                    null, null, COLUMN_TIMESTAMP + " ASC");

            if (cursor != null && cursor.moveToFirst()) {
                do {
                    JSONObject obj = new JSONObject();
                    obj.put("lat", cursor.getDouble(cursor.getColumnIndexOrThrow(COLUMN_LATITUDE)));
                    obj.put("lng", cursor.getDouble(cursor.getColumnIndexOrThrow(COLUMN_LONGITUDE)));
                    obj.put("altitude", cursor.getDouble(cursor.getColumnIndexOrThrow(COLUMN_ALTITUDE)));
                    obj.put("accuracy", cursor.getDouble(cursor.getColumnIndexOrThrow(COLUMN_ACCURACY)));
                    obj.put("speed", cursor.getDouble(cursor.getColumnIndexOrThrow(COLUMN_SPEED)));
                    obj.put("ts", cursor.getLong(cursor.getColumnIndexOrThrow(COLUMN_TIMESTAMP)));
                    arr.put(obj);
                } while (cursor.moveToNext());
            }
        } catch (Exception e) {
            Log.e(TAG, "Error reading points from SQLite DB", e);
        } finally {
            if (cursor != null) cursor.close();
        }
        return arr;
    }

    public synchronized void setVehicleFlagged(String sessionId, boolean flagged, float maxSpeed) {
        if (sessionId == null || sessionId.isEmpty()) sessionId = "current_session";
        SQLiteDatabase db = this.getWritableDatabase();
        ContentValues values = new ContentValues();
        values.put(COLUMN_META_SESSION_ID, sessionId);
        values.put(COLUMN_META_VEHICLE, flagged ? 1 : 0);
        values.put(COLUMN_META_MAX_SPEED, maxSpeed);

        try {
            db.insertWithOnConflict(TABLE_META, null, values, SQLiteDatabase.CONFLICT_REPLACE);
        } catch (Exception e) {
            Log.e(TAG, "Error updating vehicle meta flag", e);
        }
    }

    public synchronized boolean isVehicleFlagged(String sessionId) {
        if (sessionId == null || sessionId.isEmpty()) sessionId = "current_session";
        SQLiteDatabase db = this.getReadableDatabase();
        Cursor cursor = null;
        boolean flagged = false;
        try {
            cursor = db.query(TABLE_META, new String[]{COLUMN_META_VEHICLE},
                    COLUMN_META_SESSION_ID + "=?", new String[]{sessionId}, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                flagged = cursor.getInt(cursor.getColumnIndexOrThrow(COLUMN_META_VEHICLE)) == 1;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error checking vehicle flag", e);
        } finally {
            if (cursor != null) cursor.close();
        }
        return flagged;
    }

    public synchronized void clearPointsForSession(String sessionId) {
        if (sessionId == null || sessionId.isEmpty()) sessionId = "current_session";
        SQLiteDatabase db = this.getWritableDatabase();
        try {
            db.delete(TABLE_POINTS, COLUMN_SESSION_ID + "=?", new String[]{sessionId});
            db.delete(TABLE_META, COLUMN_META_SESSION_ID + "=?", new String[]{sessionId});
        } catch (Exception e) {
            Log.e(TAG, "Error clearing session points from DB", e);
        }
    }

    // ===============================================
    // Walk Summary & Splits Methods
    // ===============================================

    public synchronized void insertWalkSummary(
            String id, String userId, String status, int duration, double distance,
            double calories, int steps, Double avgPace, Double elevationGain, Double elevationLoss,
            String day, String startedAt, String finishedAt, String encodedPolyline,
            Double startLat, Double startLng, Double endLat, Double endLng,
            String photoUrls, boolean vehicleFlagged, String createdAt, String updatedAt) {
        
        SQLiteDatabase db = this.getWritableDatabase();
        ContentValues values = new ContentValues();
        values.put(COLUMN_SUMMARY_ID, id);
        values.put(COLUMN_SUMMARY_USER_ID, userId);
        values.put(COLUMN_SUMMARY_STATUS, status);
        values.put(COLUMN_SUMMARY_DURATION, duration);
        values.put(COLUMN_SUMMARY_DISTANCE, distance);
        values.put(COLUMN_SUMMARY_CALORIES, calories);
        values.put(COLUMN_SUMMARY_STEPS, steps);
        
        if (avgPace != null) values.put(COLUMN_SUMMARY_AVG_PACE, avgPace);
        if (elevationGain != null) values.put(COLUMN_SUMMARY_ELEVATION_GAIN, elevationGain);
        if (elevationLoss != null) values.put(COLUMN_SUMMARY_ELEVATION_LOSS, elevationLoss);
        
        values.put(COLUMN_SUMMARY_DAY, day);
        values.put(COLUMN_SUMMARY_STARTED_AT, startedAt);
        values.put(COLUMN_SUMMARY_FINISHED_AT, finishedAt);
        values.put(COLUMN_SUMMARY_ENCODED_POLYLINE, encodedPolyline);
        
        if (startLat != null) values.put(COLUMN_SUMMARY_START_LAT, startLat);
        if (startLng != null) values.put(COLUMN_SUMMARY_START_LNG, startLng);
        if (endLat != null) values.put(COLUMN_SUMMARY_END_LAT, endLat);
        if (endLng != null) values.put(COLUMN_SUMMARY_END_LNG, endLng);
        
        values.put(COLUMN_SUMMARY_PHOTO_URLS, photoUrls);
        values.put(COLUMN_SUMMARY_VEHICLE_FLAGGED, vehicleFlagged ? 1 : 0);
        values.put(COLUMN_SUMMARY_CREATED_AT, createdAt);
        values.put(COLUMN_SUMMARY_UPDATED_AT, updatedAt);

        try {
            db.insertWithOnConflict(TABLE_SUMMARIES, null, values, SQLiteDatabase.CONFLICT_REPLACE);
        } catch (Exception e) {
            Log.e(TAG, "Error inserting walk summary", e);
        }
    }

    public synchronized void insertWalkSplit(String sessionId, int splitNumber, double distance,
                                             int duration, double pace, Double elevationChange) {
        SQLiteDatabase db = this.getWritableDatabase();
        ContentValues values = new ContentValues();
        values.put(COLUMN_SPLIT_SESSION_ID, sessionId);
        values.put(COLUMN_SPLIT_NUMBER, splitNumber);
        values.put(COLUMN_SPLIT_DISTANCE, distance);
        values.put(COLUMN_SPLIT_DURATION, duration);
        values.put(COLUMN_SPLIT_PACE, pace);
        
        if (elevationChange != null) {
            values.put(COLUMN_SPLIT_ELEVATION_CHANGE, elevationChange);
        }

        try {
            db.insert(TABLE_SPLITS, null, values);
        } catch (Exception e) {
            Log.e(TAG, "Error inserting walk split", e);
        }
    }

    public synchronized JSONArray getWalkSummaries(String userId, int limit) {
        JSONArray arr = new JSONArray();
        SQLiteDatabase db = this.getReadableDatabase();
        Cursor cursor = null;
        try {
            String query = "SELECT * FROM " + TABLE_SUMMARIES + 
                          " WHERE " + COLUMN_SUMMARY_USER_ID + "=?" +
                          " ORDER BY " + COLUMN_SUMMARY_FINISHED_AT + " DESC" +
                          " LIMIT ?";
            cursor = db.rawQuery(query, new String[]{userId, String.valueOf(limit)});

            if (cursor != null && cursor.moveToFirst()) {
                do {
                    JSONObject obj = new JSONObject();
                    obj.put("id", cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_ID)));
                    obj.put("user_id", cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_USER_ID)));
                    obj.put("status", cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_STATUS)));
                    obj.put("duration", cursor.getInt(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_DURATION)));
                    obj.put("distance", cursor.getDouble(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_DISTANCE)));
                    obj.put("calories", cursor.getDouble(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_CALORIES)));
                    obj.put("steps", cursor.getInt(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_STEPS)));
                    
                    int avgPaceIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_AVG_PACE);
                    if (!cursor.isNull(avgPaceIdx)) {
                        obj.put("avg_pace", cursor.getDouble(avgPaceIdx));
                    }
                    
                    int elevGainIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_ELEVATION_GAIN);
                    if (!cursor.isNull(elevGainIdx)) {
                        obj.put("elevation_gain", cursor.getDouble(elevGainIdx));
                    }
                    
                    int elevLossIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_ELEVATION_LOSS);
                    if (!cursor.isNull(elevLossIdx)) {
                        obj.put("elevation_loss", cursor.getDouble(elevLossIdx));
                    }
                    
                    obj.put("day", cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_DAY)));
                    obj.put("started_at", cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_STARTED_AT)));
                    
                    int finishedIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_FINISHED_AT);
                    if (!cursor.isNull(finishedIdx)) {
                        obj.put("finished_at", cursor.getString(finishedIdx));
                    }
                    
                    int polylineIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_ENCODED_POLYLINE);
                    if (!cursor.isNull(polylineIdx)) {
                        obj.put("encoded_polyline", cursor.getString(polylineIdx));
                    }
                    
                    int startLatIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_START_LAT);
                    if (!cursor.isNull(startLatIdx)) {
                        obj.put("start_lat", cursor.getDouble(startLatIdx));
                    }
                    
                    int startLngIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_START_LNG);
                    if (!cursor.isNull(startLngIdx)) {
                        obj.put("start_lng", cursor.getDouble(startLngIdx));
                    }
                    
                    int endLatIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_END_LAT);
                    if (!cursor.isNull(endLatIdx)) {
                        obj.put("end_lat", cursor.getDouble(endLatIdx));
                    }
                    
                    int endLngIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_END_LNG);
                    if (!cursor.isNull(endLngIdx)) {
                        obj.put("end_lng", cursor.getDouble(endLngIdx));
                    }
                    
                    int photoUrlsIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_PHOTO_URLS);
                    if (!cursor.isNull(photoUrlsIdx)) {
                        obj.put("photo_urls", cursor.getString(photoUrlsIdx));
                    }
                    
                    obj.put("vehicle_flagged", cursor.getInt(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_VEHICLE_FLAGGED)) == 1);
                    obj.put("created_at", cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_CREATED_AT)));
                    obj.put("updated_at", cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_UPDATED_AT)));
                    
                    arr.put(obj);
                } while (cursor.moveToNext());
            }
        } catch (Exception e) {
            Log.e(TAG, "Error reading walk summaries", e);
        } finally {
            if (cursor != null) cursor.close();
        }
        return arr;
    }

    public synchronized JSONObject getWalkSummary(String sessionId) {
        SQLiteDatabase db = this.getReadableDatabase();
        Cursor cursor = null;
        try {
            cursor = db.query(TABLE_SUMMARIES, null,
                    COLUMN_SUMMARY_ID + "=?", new String[]{sessionId},
                    null, null, null);
            
            if (cursor != null && cursor.moveToFirst()) {
                JSONObject obj = new JSONObject();
                obj.put("id", cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_ID)));
                obj.put("user_id", cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_USER_ID)));
                obj.put("status", cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_STATUS)));
                obj.put("duration", cursor.getInt(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_DURATION)));
                obj.put("distance", cursor.getDouble(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_DISTANCE)));
                obj.put("calories", cursor.getDouble(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_CALORIES)));
                obj.put("steps", cursor.getInt(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_STEPS)));
                
                int avgPaceIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_AVG_PACE);
                if (!cursor.isNull(avgPaceIdx)) {
                    obj.put("avg_pace", cursor.getDouble(avgPaceIdx));
                }
                
                int elevGainIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_ELEVATION_GAIN);
                if (!cursor.isNull(elevGainIdx)) {
                    obj.put("elevation_gain", cursor.getDouble(elevGainIdx));
                }
                
                int elevLossIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_ELEVATION_LOSS);
                if (!cursor.isNull(elevLossIdx)) {
                    obj.put("elevation_loss", cursor.getDouble(elevLossIdx));
                }
                
                obj.put("day", cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_DAY)));
                obj.put("started_at", cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_STARTED_AT)));
                
                int finishedIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_FINISHED_AT);
                if (!cursor.isNull(finishedIdx)) {
                    obj.put("finished_at", cursor.getString(finishedIdx));
                }
                
                int polylineIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_ENCODED_POLYLINE);
                if (!cursor.isNull(polylineIdx)) {
                    obj.put("encoded_polyline", cursor.getString(polylineIdx));
                }
                
                int startLatIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_START_LAT);
                if (!cursor.isNull(startLatIdx)) {
                    obj.put("start_lat", cursor.getDouble(startLatIdx));
                }
                
                int startLngIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_START_LNG);
                if (!cursor.isNull(startLngIdx)) {
                    obj.put("start_lng", cursor.getDouble(startLngIdx));
                }
                
                int endLatIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_END_LAT);
                if (!cursor.isNull(endLatIdx)) {
                    obj.put("end_lat", cursor.getDouble(endLatIdx));
                }
                
                int endLngIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_END_LNG);
                if (!cursor.isNull(endLngIdx)) {
                    obj.put("end_lng", cursor.getDouble(endLngIdx));
                }
                
                int photoUrlsIdx = cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_PHOTO_URLS);
                if (!cursor.isNull(photoUrlsIdx)) {
                    obj.put("photo_urls", cursor.getString(photoUrlsIdx));
                }
                
                obj.put("vehicle_flagged", cursor.getInt(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_VEHICLE_FLAGGED)) == 1);
                obj.put("created_at", cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_CREATED_AT)));
                obj.put("updated_at", cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_SUMMARY_UPDATED_AT)));
                
                return obj;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error reading walk summary", e);
        } finally {
            if (cursor != null) cursor.close();
        }
        return null;
    }

    public synchronized JSONArray getWalkSplits(String sessionId) {
        JSONArray arr = new JSONArray();
        SQLiteDatabase db = this.getReadableDatabase();
        Cursor cursor = null;
        try {
            cursor = db.query(TABLE_SPLITS, null,
                    COLUMN_SPLIT_SESSION_ID + "=?", new String[]{sessionId},
                    null, null, COLUMN_SPLIT_NUMBER + " ASC");

            if (cursor != null && cursor.moveToFirst()) {
                do {
                    JSONObject obj = new JSONObject();
                    obj.put("id", cursor.getInt(cursor.getColumnIndexOrThrow(COLUMN_SPLIT_ID)));
                    obj.put("session_id", cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_SPLIT_SESSION_ID)));
                    obj.put("split_number", cursor.getInt(cursor.getColumnIndexOrThrow(COLUMN_SPLIT_NUMBER)));
                    obj.put("distance", cursor.getDouble(cursor.getColumnIndexOrThrow(COLUMN_SPLIT_DISTANCE)));
                    obj.put("duration", cursor.getInt(cursor.getColumnIndexOrThrow(COLUMN_SPLIT_DURATION)));
                    obj.put("pace", cursor.getDouble(cursor.getColumnIndexOrThrow(COLUMN_SPLIT_PACE)));
                    
                    int elevChangeIdx = cursor.getColumnIndexOrThrow(COLUMN_SPLIT_ELEVATION_CHANGE);
                    if (!cursor.isNull(elevChangeIdx)) {
                        obj.put("elevation_change", cursor.getDouble(elevChangeIdx));
                    }
                    
                    arr.put(obj);
                } while (cursor.moveToNext());
            }
        } catch (Exception e) {
            Log.e(TAG, "Error reading walk splits", e);
        } finally {
            if (cursor != null) cursor.close();
        }
        return arr;
    }

    public synchronized void deleteWalkSummary(String sessionId) {
        SQLiteDatabase db = this.getWritableDatabase();
        try {
            // Delete splits first (foreign key cascade should handle it, but explicit is safer)
            db.delete(TABLE_SPLITS, COLUMN_SPLIT_SESSION_ID + "=?", new String[]{sessionId});
            db.delete(TABLE_SUMMARIES, COLUMN_SUMMARY_ID + "=?", new String[]{sessionId});
        } catch (Exception e) {
            Log.e(TAG, "Error deleting walk summary", e);
        }
    }

    public synchronized JSONObject getAggregatedStats(String userId) {
        JSONObject stats = new JSONObject();
        SQLiteDatabase db = this.getReadableDatabase();
        Cursor cursor = null;
        try {
            String query = "SELECT " +
                    "COUNT(*) as total_walks, " +
                    "SUM(" + COLUMN_SUMMARY_DISTANCE + ") as total_distance, " +
                    "SUM(" + COLUMN_SUMMARY_DURATION + ") as total_duration, " +
                    "SUM(" + COLUMN_SUMMARY_STEPS + ") as total_steps, " +
                    "AVG(" + COLUMN_SUMMARY_AVG_PACE + ") as avg_pace, " +
                    "MAX(" + COLUMN_SUMMARY_DISTANCE + ") as longest_distance, " +
                    "MIN(" + COLUMN_SUMMARY_AVG_PACE + ") as fastest_pace " +
                    "FROM " + TABLE_SUMMARIES + 
                    " WHERE " + COLUMN_SUMMARY_USER_ID + "=?" +
                    " AND " + COLUMN_SUMMARY_STATUS + "='finished'";
            
            cursor = db.rawQuery(query, new String[]{userId});

            if (cursor != null && cursor.moveToFirst()) {
                stats.put("total_walks", cursor.getInt(0));
                stats.put("total_distance", cursor.getDouble(1));
                stats.put("total_duration", cursor.getInt(2));
                stats.put("total_steps", cursor.getInt(3));
                
                if (!cursor.isNull(4)) {
                    stats.put("avg_pace", cursor.getDouble(4));
                }
                if (!cursor.isNull(5)) {
                    stats.put("longest_distance", cursor.getDouble(5));
                }
                if (!cursor.isNull(6)) {
                    stats.put("fastest_pace", cursor.getDouble(6));
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error computing aggregated stats", e);
        } finally {
            if (cursor != null) cursor.close();
        }
        return stats;
    }
}
