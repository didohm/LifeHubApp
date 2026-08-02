import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  User as FirebaseUser,
} from "firebase/auth";
import { auth, isFirebaseConfigured } from "../lib/firebase";
import { User } from "../lib/types";
import { updateUserProfile } from "../lib/api";
interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  isFirebaseConfigured: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  updateUserField: <K extends keyof User>(key: K, value: User[K]) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState<boolean>(typeof window !== "undefined");

  const mapFirebaseUser = (fbUser: FirebaseUser): User => {
    return {
      id: fbUser.uid,
      email: fbUser.email || "",
      full_name: fbUser.displayName || fbUser.email?.split("@")[0] || "User",
      avatar_url: fbUser.photoURL || null,
      theme: "light",
      language: "en",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      email_verified: fbUser.emailVerified,
      accent_color: "primary",
      compact_mode: false,
      animations_enabled: true,
      accessibility_mode: false,
      created_at: fbUser.metadata.creationTime || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  };

  /**
   * Loads a signed-in Firebase user together with their Firestore profile.
   * The user is only published (and loading only ends) after the stored
   * profile — including date_of_birth — is available, so the onboarding gate
   * never flashes: it evaluates once against the real profile.
   */
  const loadUserProfile = useCallback(async (fbUser: FirebaseUser) => {
    setFirebaseUser(fbUser);
    setLoading(true);
    const mappedUser = mapFirebaseUser(fbUser);
    try {
      // Ensure the profile doc exists in Firestore, then merge it
      const profile = await updateUserProfile(fbUser.uid, {
        email: mappedUser.email,
        full_name: mappedUser.full_name,
        avatar_url: mappedUser.avatar_url,
        email_verified: mappedUser.email_verified,
      });
      setUser({ ...mappedUser, ...(profile || {}) });
    } catch (err) {
      console.error("Error syncing user profile to Firestore:", err);
      setUser(mappedUser);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        loadUserProfile(fbUser);
      } else {
        setFirebaseUser(null);
        setUser(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [loadUserProfile]);

  const signInWithGoogle = useCallback(async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const userCredential = await signInWithPopup(auth, provider);
    if (userCredential.user) {
      await loadUserProfile(userCredential.user);
    }
  }, [loadUserProfile]);

  const logout = useCallback(async () => {
    await firebaseSignOut(auth);
    setUser(null);
    setFirebaseUser(null);
  }, []);

  const updateUserField = useCallback(<K extends keyof User>(key: K, value: User[K]) => {
    setUser((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        firebaseUser,
        loading,
        isFirebaseConfigured,
        signInWithGoogle,
        logout,
        updateUserField,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
