import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "../hooks/use-auth";
import { Screen } from "@/components/lifehub/Screen";
import hero3d from "@/assets/hero-3d.png";
import { Loader2, Star, CalendarDays } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { motion, useReducedMotion } from "framer-motion";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const { user, isFirebaseConfigured, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (user) {
      navigate({ to: "/" });
    }
  }, [user, navigate]);

  if (!isFirebaseConfigured) {
    return (
      <Screen>
        <div className="flex min-h-[80vh] flex-col justify-center px-4 py-8">
          <div className="card-soft bg-white p-6 shadow-xl text-center border border-black/5">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#E8E2FF] text-[#7C5CFC] mb-4">
              🔧
            </div>
            <h2 className="text-xl font-extrabold text-[#12131A]">Setup Required</h2>
            <p className="mt-2 text-xs text-[#6B7280] leading-relaxed">
              Authentication is not yet configured. Please set up Firebase environment credentials.
            </p>
          </div>
        </div>
      </Screen>
    );
  }

  if (user) return null;

  const handleGoogleSignIn = async () => {
    setError("");
    setSubmitting(true);
    try {
      await signInWithGoogle();
      navigate({ to: "/" });
    } catch (err: any) {
      if (err.code === "auth/popup-closed-by-user") {
        setError("Sign-in popup was closed. Please try again.");
      } else if (err.code === "auth/popup-blocked") {
        setError("Pop-up was blocked by your browser. Please allow pop-ups for this site.");
      } else {
        setError(err.message || "Google sign-in failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const floatArt = reduceMotion ? undefined : { y: [0, -10, 0] };
  const floatChip = reduceMotion ? undefined : { y: [0, -6, 0] };

  return (
    <Screen className="bg-gradient-to-b from-[#FBFBFE] via-[#F7F7FA] to-[#F3F4F8]">
      <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col px-2 pt-2 text-center">
        {/* Hero cluster: logo + tagline */}
        <div className="flex flex-col items-center">
          <img
            src="/illustration/lifehub.png"
            alt="LifeHub"
            className="h-32 w-auto object-contain"
          />
          <p className="mt-1 text-[15px] font-semibold text-[#4A5568] leading-[1.45] tracking-tight">
            Plan your day.
            <br />
            Elevate your life.
          </p>
        </div>

        {/* 3D artwork — flex-1 keeps it dynamically centered between hero and CTA */}
        <div className="relative my-4 flex flex-1 items-center justify-center">
          {/* Soft ambient glow, wide spread so it melts into the background */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_50%_48%,rgba(124,92,252,0.10),transparent_70%)]" />

          <motion.div
            animate={floatArt}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className="relative w-full max-w-xs"
          >
            <img
              src={hero3d}
              alt="LifeHub Health & Daily Planner Illustration"
              className="relative z-10 w-full h-52 object-contain"
            />

            {/* Grounding shadow so the artwork sits in space instead of floating */}
            <div className="absolute -bottom-1 left-1/2 z-0 h-6 w-3/5 -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(18,19,26,0.18),transparent_65%)] blur-[2px]" />

            {/* Planner-motif chips, mirrored symmetrically on the same axis */}
            <motion.div
              animate={floatChip}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
              className="absolute left-0 top-20 flex size-9 items-center justify-center rounded-2xl bg-white shadow-lg shadow-black/10"
            >
              <Star className="size-4 text-[#F08C3E]" />
            </motion.div>
            <motion.div
              animate={floatChip}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: 0.9 }}
              className="absolute right-0 top-20 flex size-9 items-center justify-center rounded-2xl bg-white shadow-lg shadow-black/10"
            >
              <CalendarDays className="size-4 text-[#4FB8C9]" />
            </motion.div>
          </motion.div>
        </div>

        {/* Primary CTA anchored near the bottom edge, safe-area aware */}
        <div className="mx-auto w-full max-w-sm space-y-3 pb-[max(env(safe-area-inset-bottom),2rem)]">
          {error && (
            <p className="mb-3 rounded-2xl bg-rose-50 p-3 text-xs font-bold text-rose-600 border border-rose-100">
              {error}
            </p>
          )}

          <button
            onClick={handleGoogleSignIn}
            disabled={submitting}
            className="tap flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-[#1E1E1E] px-6 text-white shadow-lg shadow-black/15 transition-all hover:bg-black hover:shadow-xl active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100"
          >
            {submitting ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <FcGoogle className="size-5" />
            )}
            <span className="text-base font-semibold">Get Started with Google</span>
          </button>
        </div>
      </div>
    </Screen>
  );
}
