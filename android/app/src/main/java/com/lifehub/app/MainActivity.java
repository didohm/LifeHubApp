package com.lifehub.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.capacitorjs.plugins.localnotifications.LocalNotificationsPlugin;

/**
 * Main Activity for LifeHub Android app.
 * Registers the plugin set used by the app.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        registerPlugin(LocalNotificationsPlugin.class);
        registerPlugin(StepCounterPlugin.class);
        registerPlugin(NativePermissionsPlugin.class);
        registerPlugin(WalkServicePlugin.class);
        registerPlugin(GallerySaverPlugin.class);
    }
}
