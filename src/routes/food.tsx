import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { UtensilsCrossed, Bell, Heart, Salad, Apple, Coffee } from "lucide-react";
import { toast } from "sonner";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";

export const Route = createFileRoute("/food")({
  head: () => ({
    meta: [{ title: "Food & Nutrition — Coming Soon" }],
  }),
  component: FoodPage,
});

function FoodPage() {
  const [notified, setNotified] = useState(false);

  const handleNotifyMe = () => {
    setNotified(true);
    toast.success("You're on the early access list! We'll notify you when Nutrition launches. 🥗");
  };

  return (
    <Screen>
      <ScreenHeader
        title="Food & Nutrition"
        subtitle="Nutrition tracking under development"
        showBack
      />

      {/* Main Beautiful Coming Soon Container */}
      <div className="card-soft relative overflow-hidden bg-gradient-to-br from-[#12131A] via-[#1F192F] to-[#341A3A] p-8 text-center text-white shadow-2xl my-4">
        {/* Animated background food icons */}
        <div className="absolute top-4 left-4 text-2xl opacity-20 animate-bounce">🥗</div>
        <div className="absolute bottom-6 left-8 text-2xl opacity-20 animate-pulse">🍎</div>
        <div className="absolute top-8 right-6 text-2xl opacity-20 animate-bounce">🥑</div>
        <div className="absolute bottom-4 right-8 text-2xl opacity-20 animate-pulse">☕</div>

        <div className="relative z-10 mx-auto max-w-sm">
          {/* Main Badge */}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-1 text-xs font-extrabold text-[#7C5CFC] backdrop-blur-md border border-white/10 mb-6">
            <UtensilsCrossed className="size-3.5 text-[#7C5CFC]" /> Under Development
          </span>

          {/* Hero Icon */}
          <div className="mx-auto my-4 flex size-24 items-center justify-center rounded-3xl bg-gradient-to-tr from-[#7C5CFC] to-[#FF80B5] text-white shadow-lg">
            <UtensilsCrossed className="size-12" />
          </div>

          <h2 className="mt-4 text-3xl font-black tracking-tight text-white">
            Food & Nutrition Tracker
          </h2>

          <p className="mt-3 text-xs leading-relaxed text-white/70 font-medium">
            We are building a smart, privacy-first nutrition logging experience with calorie
            targets, macronutrient breakdowns, and AI recipe analysis. No fake data — real tracking
            is coming soon!
          </p>

          {/* Planned Features Preview Pill List */}
          <div className="mt-6 flex flex-wrap justify-center gap-2 text-[11px] font-bold text-white/90">
            <span className="rounded-full bg-white/10 px-3 py-1 border border-white/10 flex items-center gap-1">
              <Salad className="size-3 text-emerald-400" /> Macro Tracking
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1 border border-white/10 flex items-center gap-1">
              <Apple className="size-3 text-rose-400" /> Calorie Goals
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1 border border-white/10 flex items-center gap-1">
              <Coffee className="size-3 text-amber-400" /> Meal Logging
            </span>
          </div>

          {/* Notify Action Button */}
          <div className="mt-8">
            <button
              onClick={handleNotifyMe}
              disabled={notified}
              className={`tap w-full rounded-full py-3.5 text-xs font-black transition-all shadow-md flex items-center justify-center gap-2 ${
                notified
                  ? "bg-emerald-500 text-white cursor-default"
                  : "bg-white text-[#12131A] hover:bg-white/90 active:scale-95"
              }`}
            >
              {notified ? (
                <>
                  <Heart className="size-4 fill-white" /> Early Access Requested
                </>
              ) : (
                <>
                  <Bell className="size-4 text-[#7C5CFC]" /> Get Notified On Launch
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </Screen>
  );
}
