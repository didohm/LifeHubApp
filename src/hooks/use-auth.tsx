import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithCredential,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  User as FirebaseUser,
} from "firebase/auth";
import { auth, isFirebaseConfigured } from "../lib/firebase";
import { User } from "../lib/types";
import { getUserProfile, updateUserProfile, userProfileExists } from "../lib/api";
import {
  cachePhotoUrl,
  clearPhotoCache,
  getCachedPhotoUrl,
  preloadPhoto,
} from "../lib/photo-cache";

const USER_PROFILE_CACHE_KEY = "lifehub_user_profile";

// Hoisted: resolvedOptions() is relatively expensive — computed once per app
// load instead of on every mapFirebaseUser() call (runs on each login/sync).
const DEVICE_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  /** True once the Firestore profile has been read after login (or timed out). */
  profileReady: boolean;
  /**
   * True only when the user has no Firestore profile document at all — i.e.
   * this is a brand-new account logging in for the first time. The Birthday /
   * Date of Birth onboarding screen is shown ONLY for these users.
   */
  isNewUser: boolean;
  isFirebaseConfigured: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  updateUserField: <K extends keyof User>(key: K, value: User[K]) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Read cached user profile from localStorage for instant display on restart. */
function readCachedProfile(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_PROFILE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function cacheProfile(user: User) {
  try {
    localStorage.setItem(USER_PROFILE_CACHE_KEY, JSON.stringify(user));
  } catch {
    /* quota exceeded — ignore */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Start with NO user. The cached profile is only trusted AFTER Firebase
  // confirms the user is actually signed in — a signed-out user with a stale
  // cache must never see the app flash before being sent to Sign In.
  const [user, setUser] = useState<User | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  // True only while the Firebase auth state is unknown. The moment auth
  // resolves (signed in OR out) we stop loading — Firestore/profile data is
  // fetched in the background and never blocks rendering.
  const [loading, setLoading] = useState<boolean>(true);
  // False only for the brief moment between auth resolution and the Firestore
  // profile read finishing. The root gate waits for this before deciding
  // whether onboarding is needed, so existing users with a saved date of
  // birth are never (even briefly) sent to the onboarding screen.
  const [profileReady, setProfileReady] = useState<boolean>(false);
  // True only for brand-new accounts (no Firestore profile document before
  // this login). The Birthday / Date of Birth onboarding is shown ONLY for
  // these users — existing accounts are never prompted, even if their
  // profile has no date of birth saved.
  const [isNewUser, setIsNewUser] = useState<boolean>(false);

  /** Map a Firebase user to a LifeHub User, merging cached profile fields instantly. */
  const mapFirebaseUser = useCallback((fbUser: FirebaseUser, cached: User | null): User => {
    const cachedPhotoUrl = getCachedPhotoUrl();
    const cachedDob = cached?.date_of_birth || null;
    return {
      id: fbUser.uid,
      email: fbUser.email || cached?.email || "",
      full_name: fbUser.displayName || cached?.full_name || fbUser.email?.split("@")[0] || "User",
      avatar_url: fbUser.photoURL || cachedPhotoUrl || cached?.avatar_url || null,
      date_of_birth: cachedDob || undefined,
      height: cached?.height ?? null,
      weight: cached?.weight ?? null,
      theme: cached?.theme || "light",
      language: cached?.language || "en",
      timezone: DEVICE_TIMEZONE,
      email_verified: fbUser.emailVerified,
      accent_color: cached?.accent_color || "primary",
      compact_mode: cached?.compact_mode ?? false,
      animations_enabled: cached?.animations_enabled ?? true,
      accessibility_mode: cached?.accessibility_mode ?? false,
      created_at: cached?.created_at || fbUser.metadata.creationTime || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }, []);

  /**
   * Publish the signed-in user IMMEDIATELY (merged with the cached profile so
   * the avatar, name and DOB show instantly) and cache it. Never blocks.
   */
  const publishUser = useCallback(
    (fbUser: FirebaseUser) => {
      const mapped = mapFirebaseUser(fbUser, readCachedProfile());
      setFirebaseUser(fbUser);
      setUser(mapped);
      setLoading(false);
      cacheProfile(mapped);
      // Cache + preload the real photo so every avatar renders instantly
      // (no placeholder flash) on this and future launches.
      cachePhotoUrl(mapped.avatar_url);
      preloadPhoto(mapped.avatar_url);
    },
    [mapFirebaseUser],
  );

  /**
   * Background Firestore sync: single fast read of the profile document.
   * Creates the document only when it doesn't exist yet. Never awaited by
   * the UI — updates arrive when ready and are cached for next launch.
   */
  const syncProfileToFirestore = useCallback(
    async (fbUser: FirebaseUser) => {
      try {
        // First determine whether a profile document exists at all. A null
        // result means the read failed (transient error) — never treat that
        // as a brand-new account.
        const exists = await userProfileExists(fbUser.uid);
        if (exists === null) {
          // Profile status unknown — safest default: treat as existing so
          // onboarding is never shown to a possibly-existing account.
          setIsNewUser(false);
          return;
        }
        if (exists) {
          // Existing account — already onboarded or profile completed.
          setIsNewUser(false);
          const existing = await getUserProfile(fbUser.uid);
          if (existing) {
            // Cache the Firestore profile photo so the real image (not a
            // placeholder) shows instantly on every screen and every launch.
            cachePhotoUrl(existing.avatar_url);
            preloadPhoto(existing.avatar_url);
            setUser((prev) => {
              const merged = { ...(prev || mapFirebaseUser(fbUser, null)), ...existing };
              cacheProfile(merged);
              return merged;
            });
          }
          return;
        }
        // Brand-new account: no profile document exists yet — create it and
        // flag the user so onboarding (Birthday / DOB) is shown exactly once.
        setIsNewUser(true);
        const mapped = mapFirebaseUser(fbUser, null);
        const created = await updateUserProfile(fbUser.uid, {
          email: mapped.email,
          full_name: mapped.full_name,
          avatar_url: mapped.avatar_url,
          email_verified: mapped.email_verified,
        });
        if (created) {
          setUser((prev) => {
            const merged = { ...(prev || mapped), ...created };
            cacheProfile(merged);
            return merged;
          });
        }
      } catch (err) {
        console.error("Error syncing user profile to Firestore:", err);
      }
    },
    [mapFirebaseUser],
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        publishUser(fbUser);
        // Background Firestore profile read. The gate waits for it (with a
        // safety timeout) before deciding onboarding is needed — so a user
        // who already has a date of birth saved is never asked again.
        setProfileReady(false);
        const sync = syncProfileToFirestore(fbUser);
        const timeout = new Promise<void>((resolve) => setTimeout(resolve, 4000));
        void Promise.race([sync, timeout]).finally(() => setProfileReady(true));
      } else {
        setFirebaseUser(null);
        setUser(null);
        setLoading(false); // auth resolved: signed out → straight to Sign In
        setProfileReady(true);
        setIsNewUser(false);
      }
    });

    return () => unsubscribe();
  }, [publishUser, syncProfileToFirestore]);

  const signInWithGoogle = useCallback(async () => {
    if (Capacitor.isNativePlatform()) {
      // Native flow (Android/iOS): Google Sign-In runs outside the WebView via
      // Google Play services through @capacitor-firebase/authentication. The
      // Firebase JS SDK popup/redirect flows are unusable inside a WebView.
      let result;
      try {
        result = await FirebaseAuthentication.signInWithGoogle();
      } catch (nativeError: any) {
        console.error("[Auth] Native Google Sign-In failed:", nativeError);
        throw new Error(
          nativeError?.message ||
            "Google Sign-In failed. This usually means: (1) SHA-1/SHA-256 fingerprints are not registered in Firebase Console, or (2) google-services.json is outdated.",
        );
      }
      const idToken = result.credential?.idToken;
      if (!idToken) {
        throw new Error(
          "Google Sign-In did not return an ID token. " +
            "Ensure your Firebase project has Google Sign-In enabled and the correct OAuth client ID is configured.",
        );
      }
      const credential = GoogleAuthProvider.credential(idToken);
      const userCredential = await signInWithCredential(auth, credential);
      const fbUser = userCredential.user;
      if (fbUser.photoURL) {
        cachePhotoUrl(fbUser.photoURL);
        preloadPhoto(fbUser.photoURL);
      }
      // Open the app immediately — profile/Firestore sync happens in background.
      publishUser(fbUser);
      void syncProfileToFirestore(fbUser);
    } else {
      // Web flow (browser): the popup flow works fine outside the WebView.
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const userCredential = await signInWithPopup(auth, provider);
      const fbUser = userCredential.user;
      if (fbUser?.photoURL) {
        cachePhotoUrl(fbUser.photoURL);
        preloadPhoto(fbUser.photoURL);
      }
      if (fbUser) {
        publishUser(fbUser);
        void syncProfileToFirestore(fbUser);
      }
    }
  }, [publishUser, syncProfileToFirestore]);

  const logout = useCallback(async () => {
    await firebaseSignOut(auth);
    if (Capacitor.isNativePlatform()) {
      try {
        await FirebaseAuthentication.signOut();
      } catch (err) {
        console.warn("Native sign-out failed:", err);
      }
    }
    clearPhotoCache();
    if (typeof window !== "undefined") {
      localStorage.removeItem(USER_PROFILE_CACHE_KEY);
    }
    setUser(null);
    setFirebaseUser(null);
    setProfileReady(true);
    setIsNewUser(false);
  }, []);

  const updateUserField = useCallback(<K extends keyof User>(key: K, value: User[K]) => {
    setUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, [key]: value };
      cacheProfile(updated);
      return updated;
    });
  }, []);

  const contextValue = useMemo<AuthContextType>(
    () => ({
      user,
      firebaseUser,
      loading,
      profileReady,
      isNewUser,
      isFirebaseConfigured,
      signInWithGoogle,
      logout,
      updateUserField,
    }),
    [
      user,
      firebaseUser,
      loading,
      profileReady,
      isNewUser,
      signInWithGoogle,
      logout,
      updateUserField,
    ],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
