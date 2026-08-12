package com.lifehub.app;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import android.util.Log;

/**
 * Monitors network connectivity changes during walk tracking.
 *
 * Detects when network is lost/restored and notifies WalkService to switch
 * between FusedLocationProviderClient (requires network for cell tower/WiFi
 * location) and pure GPS LocationManager for uninterrupted tracking.
 *
 * Uses modern NetworkCallback API on Android 7+ with legacy broadcast fallback.
 */
public class ConnectivityMonitor {

    private static final String TAG = "LifeHubConnectivity";

    private final Context context;
    private final ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
    private BroadcastReceiver legacyReceiver;
    private boolean isRegistered = false;

    public interface ConnectivityListener {
        void onNetworkAvailable();
        void onNetworkLost();
    }

    private ConnectivityListener listener;

    public ConnectivityMonitor(Context context) {
        this.context = context;
        this.connectivityManager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
    }

    public void setListener(ConnectivityListener listener) {
        this.listener = listener;
    }

    /**
     * Starts monitoring network state changes.
     */
    public void startMonitoring() {
        if (isRegistered) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            startModernMonitoring();
        } else {
            startLegacyMonitoring();
        }

        isRegistered = true;
        Log.d(TAG, "Network monitoring started");
    }

    /**
     * Stops monitoring network state changes and releases resources.
     */
    public void stopMonitoring() {
        if (!isRegistered) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (Exception e) {
                Log.w(TAG, "Failed to unregister network callback", e);
            }
            networkCallback = null;
        } else if (legacyReceiver != null) {
            try {
                context.unregisterReceiver(legacyReceiver);
            } catch (Exception e) {
                Log.w(TAG, "Failed to unregister legacy connectivity receiver", e);
            }
            legacyReceiver = null;
        }

        isRegistered = false;
        Log.d(TAG, "Network monitoring stopped");
    }

    private void startModernMonitoring() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return;

        NetworkRequest request = new NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build();

        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                Log.d(TAG, "Network available: " + network);
                if (listener != null) {
                    listener.onNetworkAvailable();
                }
            }

            @Override
            public void onLost(Network network) {
                Log.d(TAG, "Network lost: " + network);
                if (listener != null) {
                    listener.onNetworkLost();
                }
            }
        };

        connectivityManager.registerNetworkCallback(request, networkCallback);
    }

    private void startLegacyMonitoring() {
        legacyReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (ConnectivityManager.CONNECTIVITY_ACTION.equals(intent.getAction())) {
                    boolean hasNetwork = isNetworkAvailable();
                    Log.d(TAG, "Connectivity changed, hasNetwork=" + hasNetwork);
                    if (listener != null) {
                        if (hasNetwork) {
                            listener.onNetworkAvailable();
                        } else {
                            listener.onNetworkLost();
                        }
                    }
                }
            }
        };

        android.content.IntentFilter filter = new android.content.IntentFilter();
        filter.addAction(ConnectivityManager.CONNECTIVITY_ACTION);
        context.registerReceiver(legacyReceiver, filter);
    }

    /**
     * Checks current network availability (for legacy path).
     */
    private boolean isNetworkAvailable() {
        if (connectivityManager == null) return false;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Network network = connectivityManager.getActiveNetwork();
            if (network == null) return false;
            NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(network);
            return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } else {
            android.net.NetworkInfo networkInfo = connectivityManager.getActiveNetworkInfo();
            return networkInfo != null && networkInfo.isConnected();
        }
    }
}
