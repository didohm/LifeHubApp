import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  getFirestore,
  setLogLevel,
  clearIndexedDbPersistence,
  type Firestore,
} from "firebase/firestore";

// Suppress non-fatal BloomFilter error logs (known issue in Firestore 11.x).
// The BloomFilter error occurs when the persistent cache's Bloom filter data
// is corrupted or in an unexpected state. Firestore continues to work, but
// logs the error. Setting log level to 'silent' suppresses these noisy logs.
setLogLevel("silent");

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
};

// Check if settings are still default templates or empty
export const isFirebaseConfigured =
  !!firebaseConfig.apiKey &&
  firebaseConfig.apiKey !== "YOUR_FIREBASE_API_KEY" &&
  !firebaseConfig.apiKey.startsWith("AIzaSyDemo");

// Initialize Firebase App singleton only if keys are present (or fallback to dummy to prevent crash on require)
const app = !getApps().length
  ? initializeApp(
      isFirebaseConfigured
        ? firebaseConfig
        : { ...firebaseConfig, apiKey: "AIzaSyDummyKeyPlaceholderToPreventCrash" },
    )
  : getApp();

// Initialize Firebase Authentication
export const auth = getAuth(app);

// Initialize Cloud Firestore with persistence enabled for improved performance and offline support.
// Use try-catch to handle HMR / double-import: if already initialized with different options,
// fall back to getFirestore() which returns the existing instance.
let db: Firestore;
if (isFirebaseConfigured) {
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ cacheSizeBytes: 50 * 1024 * 1024 }), // 50MB cache
    });
  } catch {
    // Already initialized (e.g. HMR reload) — return the existing instance
    db = getFirestore(app);
  }
} else {
  db = getFirestore(app);
}

// One-time cache clear to fix BloomFilter error (known issue in Firestore 11.x).
// This runs once after the fix is deployed, then sets a flag to prevent future clears.
// If clearing fails (e.g., active listeners), the flag is set anyway to prevent
// repeated attempts — the log level suppression above handles any remaining errors.
if (isFirebaseConfigured && typeof localStorage !== "undefined") {
  const cacheKey = "firestore_bloomfilter_fix_v1";
  if (localStorage.getItem(cacheKey) !== "true") {
    clearIndexedDbPersistence(db)
      .then(() => localStorage.setItem(cacheKey, "true"))
      .catch(() => {
        localStorage.setItem(cacheKey, "true");
      });
  }
}

export { db };

export default app;
