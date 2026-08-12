package com.lifehub.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * Doze-exempt ticker for WalkService metric updates.
 *
 * Receives AlarmManager intents scheduled with setExactAndAllowWhileIdle(),
 * ensuring the walk clock and notification continue updating even when the
 * device is in deep Doze mode (screen off for extended periods).
 *
 * The receiver wakes the WalkService to recompute metrics (distance, duration,
 * calories, pace) and update the persistent notification, then the service
 * immediately schedules the next alarm (1 second later) for continuous updates.
 */
public class WalkTickerReceiver extends BroadcastReceiver {

    private static final String TAG = "LifeHubWalkTicker";
    public static final String ACTION_TICKER = "com.lifehub.app.walk.TICKER";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_TICKER.equals(intent.getAction())) return;

        // Only process ticker if service is actually tracking
        if (!WalkService.isTracking) {
            Log.d(TAG, "Ticker fired but service not tracking, ignoring");
            return;
        }

        Log.d(TAG, "Ticker alarm fired, updating metrics");

        try {
            Intent serviceIntent = new Intent(context, WalkService.class);
            serviceIntent.setAction(WalkService.ACTION_TICKER_UPDATE);
            
            // Use startService (not startForegroundService) since the service
            // is already running in foreground - this just delivers the intent
            context.startService(serviceIntent);
        } catch (Exception e) {
            Log.e(TAG, "Failed to deliver ticker update to service", e);
        }
    }
}
