package com.lifehub.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.capacitorjs.plugins.localnotifications.LocalNotificationManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONObject;

/**
 * Native runtime permission bridge for LifeHub.
 *
 * Requests Android OS permissions outside the WebView for:
 *  - location      (walking / GPS tracking)
 *  - activity      (step counter / physical activity)
 *  - media         (documents, images — READ_MEDIA_* on 13+, legacy storage below)
 *  - audio         (voice / audio features)
 *
 * Permission answers are stored by the JS PermissionManager so the app never
 * re-asks for the same permission on every launch.
 *
 * Also exposes the launch notification payload: when the app is cold-started
 * by tapping an OS notification, the related screen is opened automatically.
 */
@CapacitorPlugin(
    name = "NativePermissions",
    permissions = {
        @Permission(
            alias = "location",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }
        ),
        @Permission(alias = "activity", strings = { Manifest.permission.ACTIVITY_RECOGNITION }),
        @Permission(
            alias = "media",
            strings = {
                Manifest.permission.READ_MEDIA_IMAGES,
                Manifest.permission.READ_MEDIA_VIDEO,
                Manifest.permission.READ_MEDIA_AUDIO,
                Manifest.permission.READ_EXTERNAL_STORAGE
            }
        ),
        @Permission(alias = "audio", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class NativePermissionsPlugin extends Plugin {

    private String pendingAlias = null;

    @PluginMethod
    public void check(PluginCall call) {
        String alias = call.getString("alias");
        boolean granted = getPermissionState(alias) == PermissionState.GRANTED;
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void request(PluginCall call) {
        String alias = call.getString("alias");
        if (alias == null) {
            call.reject("alias is required");
            return;
        }
        pendingAlias = alias;

        if (getPermissionState(alias) == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            ret.put("permanentlyDenied", false);
            call.resolve(ret);
            return;
        }

        requestPermissionForAlias(alias, call, "permissionResult");
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        PermissionState state = pendingAlias != null
                ? getPermissionState(pendingAlias)
                : PermissionState.DENIED;

        boolean granted = state == PermissionState.GRANTED;
        // permanentlyDenied is true when the user explicitly denied and checked "Don't ask again"
        // PermissionState.DENIED indicates either temporary denial or permanent denial
        // We can only detect permanent denial by attempting to request again (not done here)
        boolean permanentlyDenied = !granted && state == PermissionState.DENIED;
        
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        ret.put("permanentlyDenied", permanentlyDenied);
        pendingAlias = null;
        call.resolve(ret);
    }

    /**
     * Returns the payload of the OS notification that launched the app
     * (cold start from notification tap), or null when the app was opened
     * normally. The JS layer navigates to the related screen from this.
     */
    @PluginMethod
    public void getLaunchNotification(PluginCall call) {
        JSObject ret = new JSObject();
            ret.put("extra", JSObject.NULL);
        try {
            Intent intent = getActivity() != null ? getActivity().getIntent() : null;
            if (intent != null) {
                String json = intent.getStringExtra(LocalNotificationManager.NOTIFICATION_OBJ_INTENT_KEY);
                if (json != null) {
                    JSONObject obj = new JSONObject(json);
                    JSONObject extra = obj.optJSONObject("extra");
                    if (extra != null) {
                        ret.put("extra", new JSObject(extra.toString()));
                    }
                }
            }
        } catch (Exception e) {
            android.util.Log.w("NativePermissionsPlugin", "Failed to parse launch notification", e);
        }
        call.resolve(ret);
    }
}
