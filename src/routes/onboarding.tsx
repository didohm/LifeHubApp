import { useState, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Cake, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Screen } from "@/components/lifehub/Screen";
import { useAuth } from "@/hooks/use-auth";
import { updateUserProfile } from "@/lib/api";
import { calculateAge, toDateInputValue } from "@/lib/utils";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [{ title: "Welcome — LifeHub" }],
  }),
  component: OnboardingPage,
});

const MIN_DATE = "1900-01-01";

function OnboardingPage() {
  const { user, loading: authLoading, isNewUser, updateUserField } = useAuth();
  const navigate = useNavigate();

  const [dob, setDob] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const todayStr = toDateInputValue();

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate({ to: "/auth" });
    } else if (user.date_of_birth) {
      // Already onboarded — skip this screen
      navigate({ to: "/" });
    } else if (!isNewUser) {
      // The Birthday (Date of Birth) screen is only for brand-new accounts.
      // Existing users who somehow land here are sent home — never prompted.
      navigate({ to: "/" });
    }
  }, [authLoading, user, isNewUser, navigate]);

  const isFuture = dob !== "" && dob > todayStr;
  const isTooOld = dob !== "" && dob < MIN_DATE;
  const isValid = dob !== "" && !isFuture && !isTooOld;
  const age = calculateAge(dob);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isValid) return;
    setSubmitting(true);
    setError("");
    try {
      await updateUserProfile(user.id, { date_of_birth: dob });
      updateUserField("date_of_birth", dob);
      toast.success("Welcome to LifeHub! 🎉");
      navigate({ to: "/" });
    } catch {
      setError("Could not save your date of birth. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // While auth state is unknown render nothing (the root gate owns the splash
  // — no loading screens after auth is resolved).
  if (authLoading) return null;

  return (
    <Screen>
      <div className="flex min-h-[80vh] flex-col justify-center py-6">
        <div className="card-soft bg-white p-6 border border-black/5 shadow-xs">
          <div className="mx-auto mb-3 flex h-32 w-full max-w-[220px] items-center justify-center">
            <img
              src="/illustration/daily-routine.png"
              alt="Daily Routine Onboarding"
              className="h-full w-full object-contain drop-shadow-[0_8px_16px_rgba(124,92,252,0.2)]"
            />
          </div>
          <h1 className="text-center text-xl font-black text-[#12131A] tracking-tight">
            Welcome to LifeHub
          </h1>
          <p className="mt-1 text-center text-xs font-medium text-[#6B7280] leading-relaxed">
            One last step — tell us your date of birth to complete your profile.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-3">
            <div>
              <label className="text-xs font-bold text-[#12131A]">
                Date of Birth <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                required
                max={todayStr}
                value={dob}
                onChange={(e) => {
                  setDob(e.target.value);
                  setError("");
                }}
                className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs outline-none focus:border-[#7C5CFC]"
              />
              {dob !== "" && (isFuture || isTooOld) && (
                <p className="mt-1.5 text-[11px] font-bold text-rose-500">
                  {isFuture
                    ? "Date of birth can't be in the future."
                    : "Please choose a valid date of birth."}
                </p>
              )}
              {isValid && (
                <p className="mt-1.5 flex items-center gap-1 text-[11px] font-bold text-[#6B7280]">
                  Age:{" "}
                  <span className="rounded-full bg-[#7C5CFC]/10 px-2 py-0.5 text-[10px] font-extrabold text-[#7C5CFC]">
                    {age} {age === 1 ? "year" : "years"}
                  </span>
                </p>
              )}
            </div>

            {error && (
              <p className="rounded-2xl bg-rose-50 p-3 text-xs font-bold text-rose-600 border border-rose-100">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={!isValid || submitting}
              className="tap flex w-full items-center justify-center gap-2 rounded-full bg-[#7C5CFC] py-3.5 text-xs font-extrabold text-white shadow-md hover:bg-[#6C4CFC] disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Save & Continue
            </button>

            <p className="text-center text-[11px] font-semibold text-[#6B7280]">
              This step is required to complete your profile.
            </p>
          </form>
        </div>
      </div>
    </Screen>
  );
}
