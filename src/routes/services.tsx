import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Calendar,
  Wallet,
  Pill,
  FolderClosed,
  ListChecks,
  Bot,
  Activity,
  Cake,
  Dumbbell,
  Target,
  Footprints,
  UtensilsCrossed,
} from "lucide-react";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { sounds } from "@/lib/sound";

export const Route = createFileRoute("/services")({
  head: () => ({
    meta: [
      { title: "Services — LifeHub" },
      {
        name: "description",
        content:
          "Explore all LifeHub services: Workouts, Programs, Walking, Food, Appointments, Medications, Bills, Documents, Tasks, AI assistant & Progress.",
      },
    ],
  }),
  component: Services,
});

const services = [
  { to: "/workouts", label: "Workouts", bg: "bg-[#FFC593]", Icon: Dumbbell },
  { to: "/workout-programs", label: "Workout Programs", bg: "bg-[#E8E2FF]", Icon: Target },
  { to: "/walk", label: "Walking Service", bg: "bg-[#C2F2D0]", Icon: Footprints },
  { to: "/food", label: "Food & Nutrition", bg: "bg-[#FFE8D6]", Icon: UtensilsCrossed },
  { to: "/appointments", label: "Appointments", bg: "bg-[#BEE3FF]", Icon: Calendar },
  { to: "/medications", label: "Hydration & Meds", bg: "bg-[#FFD2E8]", Icon: Pill },
  { to: "/bills", label: "Bills & Payments", bg: "bg-[#E8E2FF]", Icon: Wallet },
  { to: "/documents", label: "Documents", bg: "bg-[#C2F2D0]", Icon: FolderClosed },
  { to: "/tasks", label: "To-Do Routine", bg: "bg-[#FFC593]", Icon: ListChecks },
  { to: "/birthdays", label: "Birthdays", bg: "bg-[#FFE8D6]", Icon: Cake },
  { to: "/ai", label: "AI Assistant", bg: "bg-[#7C5CFC] text-white", Icon: Bot },
  { to: "/analytics", label: "Progress", bg: "bg-white border border-black/5", Icon: Activity },
] as const;

function Services() {
  return (
    <Screen>
      <ScreenHeader title="Services" subtitle="All daily routines & tools" showBack />
      <div className="mt-3 grid grid-cols-2 gap-3">
        {services.map(({ to, label, bg, Icon }) => (
          <Link
            key={to}
            to={to}
            onClick={() => sounds.playCardClick()}
            className={`card-soft tap ${bg} p-5 flex flex-col justify-between active:scale-[0.97] shadow-xs hover:shadow-md transition-all min-h-[130px]`}
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-white/80 text-[#12131A] shadow-xs">
              <Icon className="size-5" />
            </span>
            <span className="mt-3 block text-sm font-extrabold">{label}</span>
          </Link>
        ))}
      </div>
    </Screen>
  );
}
