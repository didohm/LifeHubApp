import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.lifehub.app",
  appName: "LifeHub",
  webDir: "dist-capacitor/client",
  plugins: {
    FirebaseAuthentication: {
      // Run Google Sign-In natively (Google Play services, outside the
      // WebView) and return the ID token to the Firebase JS SDK. The JS SDK's
      // popup/redirect flows break inside the Android WebView
      // ("Unable to process request due to missing initial state").
      skipNativeAuth: true,
      providers: ["google.com"],
    },
    LocalNotifications: {
      smallIcon: "ic_stat_lifehub",
      iconColor: "#7C5CFC",
      sound: "beep.wav",
    },
  },
};

export default config;
