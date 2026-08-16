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
 *  - location      (walking / GPS tracking — includes background location,
 *                   required for FOREGROUND_SERVICE_TYPE_LOCATION on Android 14+)
 *  - activity      (step counter / physical activity)
 *  - health        (body sensors — required for FOREGROUND_SERVICE_TYPE_HEALTH
 *                   on Android 14+, used to combine with the location FGS type)
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
        // Play Store policy: background location must be requested as a SEPARATE
        // step, after foreground location is granted, with a rationale dialog.
        @Permission(
            alias = "background",
            strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }
        ),
        @Permission(alias = "activity", strings = { Manifest.permission.ACTIVITY_RECOGNITION }),
        @Permission(alias = "health", strings = { Manifest.permission.BODY_SENSORS }),
        @Permission(
            alias = "media",
            strings = {
                Manifest.permission.READ_MEDIA_IMAGES,
                Manifest.permission.READ_MEDIA_VIDEO,
                Manifest.permission.READ_MEDIA_AUDIO,
                Manifest.permission.READ_EXTERNAL_STORAGE
            }
        ),
        @Permission(alias = "audio", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class NativePermissionsPlugin extends Plugin {

    private static final String CALL_DATA_ALIAS_KEY = "lifehub_permission_alias";

    /** Auto-granted permissions on older Android versions */
    private boolean isAutoGranted(String alias) {
        if ("background".equals(alias) && Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return true;
        }
        if ("notifications".equals(alias) && Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return true;
        }
        return false;
    }

    @PluginMethod
    public void check(PluginCall call) {
        String alias = call.getString("alias");
        if (isAutoGranted(alias)) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
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
        if (isAutoGranted(alias)) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            ret.put("permanentlyDenied", false);
            call.resolve(ret);
            return;
        }
        // Store the alias on the call itself (not a shared instance field) so
        // two concurrent requests can never overwrite each other's callback
        // resolution with the wrong permission state.
        call.getData().put(CALL_DATA_ALIAS_KEY, alias);

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
        String alias = call.getData().optString(CALL_DATA_ALIAS_KEY, null);
        PermissionState state = alias != null
                ? getPermissionState(alias)
                : PermissionState.DENIED;

        boolean granted = state == PermissionState.GRANTED;
        // A permission is only "permanently denied" when the user chose "Don't
        // ask again" (or the OS auto-denied): i.e. no permission in the alias
        // is granted AND the system no longer shows a rationale for any of
        // them. A mere temporary denial still shows a rationale, so the JS
        // layer can ask again when the feature is next used.
        boolean permanentlyDenied = !granted && alias != null && !shouldShowRationale(alias);

        JSObject ret = new JSObject();
        ret.put("granted", granted);
        ret.put("permanentlyDenied", permanentlyDenied);
        call.resolve(ret);
    }

    /** True when the OS would still show a rationale for at least one permission of the alias. */
    private boolean shouldShowRationale(String alias) {
        android.app.Activity activity = getActivity();
        if (activity == null) return false;
        String[] permissions = getPermissionStrings(alias);
        for (String permission : permissions) {
            try {
                if (androidx.core.app.ActivityCompat.shouldShowRequestPermissionRationale(
                        activity, permission)) {
                    return true;
                }
            } catch (Exception e) {
                // Unknown permission on this API level — ignore.
            }
        }
        return false;
    }

    /** Returns the runtime permission strings declared for an alias. */
    private String[] getPermissionStrings(String alias) {
        for (com.getcapacitor.annotation.Permission p :
                getClass().getAnnotation(CapacitorPlugin.class).permissions()) {
            if (alias.equals(p.alias())) {
                return p.strings();
            }
        }
        return new String[0];
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
