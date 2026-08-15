package com.lifehub.app;

import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Saves generated LifeHub images (activity cards) into the device Gallery.
 *
 * - Android 10+ (API 29+): MediaStore insert with a RELATIVE_PATH of
 *   Pictures/LifeHub — scoped storage needs NO permission.
 * - Android 9 and below (API ≤ 28): the legacy WRITE_EXTERNAL_STORAGE
 *   permission is requested at runtime only on those versions, then the PNG
 *   is written to Pictures/LifeHub and handed to the MediaScanner.
 */
@CapacitorPlugin(
    name = "GallerySaver",
    permissions = {
        @Permission(
            alias = "storage",
            strings = { android.Manifest.permission.WRITE_EXTERNAL_STORAGE }
        )
    }
)
public class GallerySaverPlugin extends Plugin {

    @PluginMethod
    public void saveImageToGallery(PluginCall call) {
        String base64 = call.getString("base64");
        String fileName = call.getString("fileName");
        if (base64 == null || base64.isEmpty() || fileName == null || fileName.isEmpty()) {
            call.reject("base64 and fileName are required");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveScoped(base64, fileName, call);
        } else if (getPermissionState("storage") == PermissionState.GRANTED) {
            saveLegacy(base64, fileName, call);
        } else {
            requestPermissionForAlias("storage", call, "storagePermissionResult");
        }
    }

    @PermissionCallback
    private void storagePermissionResult(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) {
            saveLegacy(call.getString("base64"), call.getString("fileName"), call);
        } else {
            call.reject("Storage permission denied — cannot save to Gallery.");
        }
    }

    /** API 29+ — MediaStore insert with RELATIVE_PATH, no permission needed. */
    private void saveScoped(String base64, String fileName, PluginCall call) {
        OutputStream out = null;
        Uri uri = null;
        try {
            byte[] png = Base64.decode(base64, Base64.DEFAULT);

            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, sanitizeFileName(fileName));
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            values.put(
                    MediaStore.Images.Media.RELATIVE_PATH,
                    Environment.DIRECTORY_PICTURES + "/LifeHub"
            );
            values.put(MediaStore.Images.Media.IS_PENDING, 1);

            uri = getContext().getContentResolver()
                    .insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                call.reject("Failed to create MediaStore entry");
                return;
            }

            out = getContext().getContentResolver().openOutputStream(uri);
            if (out == null) {
                call.reject("Failed to open output stream");
                return;
            }
            out.write(png);
            out.flush();

            values.clear();
            values.put(MediaStore.Images.Media.IS_PENDING, 0);
            getContext().getContentResolver().update(uri, values, null, null);

            JSObject ret = new JSObject();
            ret.put("saved", true);
            ret.put("path", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e("GallerySaver", "Failed to save image to Gallery", e);
            // Don't leave a half-written pending entry behind.
            if (uri != null) {
                try {
                    getContext().getContentResolver().delete(uri, null, null);
                } catch (Exception ignored) {
                }
            }
            String detail = e.getMessage();
            call.reject(
                    "Failed to save image to Gallery"
                            + (detail != null && !detail.isEmpty() ? ": " + detail : ""),
                    e
            );
        } finally {
            if (out != null) {
                try {
                    out.close();
                } catch (Exception ignored) {
                }
            }
        }
    }

    /** API ≤ 28 — public Pictures/LifeHub directory + MediaScanner. */
    private void saveLegacy(String base64, String fileName, PluginCall call) {
        try {
            byte[] png = Base64.decode(base64, Base64.DEFAULT);

            File pictures = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES);
            File dir = new File(pictures, "LifeHub");
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("Failed to create Pictures/LifeHub directory");
                return;
            }

            File file = new File(dir, sanitizeFileName(fileName));
            FileOutputStream fos = new FileOutputStream(file);
            try {
                fos.write(png);
                fos.flush();
            } finally {
                fos.close();
            }

            MediaScannerConnection.scanFile(
                    getContext(),
                    new String[] { file.getAbsolutePath() },
                    new String[] { "image/png" },
                    null
            );

            JSObject ret = new JSObject();
            ret.put("saved", true);
            ret.put("path", file.getAbsolutePath());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e("GallerySaver", "Failed to save image to Gallery (legacy)", e);
            String detail = e.getMessage();
            call.reject(
                    "Failed to save image to Gallery"
                            + (detail != null && !detail.isEmpty() ? ": " + detail : ""),
                    e
            );
        }
    }

    private String sanitizeFileName(String fileName) {
        String cleaned = fileName.replaceAll("[^a-zA-Z0-9._-]", "_");
        if (cleaned.length() > 64) {
            cleaned = cleaned.substring(cleaned.length() - 64);
        }
        if (!cleaned.toLowerCase().endsWith(".png")) {
            cleaned = cleaned + ".png";
        }
        return cleaned;
    }
}