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
    private static final int DATABASE_VERSION = 1;

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

        db.execSQL(createPointsTable);
        db.execSQL(createMetaTable);

        // Index for fast session query lookup
        db.execSQL("CREATE INDEX idx_session ON " + TABLE_POINTS + "(" + COLUMN_SESSION_ID + ");");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        db.execSQL("DROP TABLE IF EXISTS " + TABLE_POINTS);
        db.execSQL("DROP TABLE IF EXISTS " + TABLE_META);
        onCreate(db);
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
}
