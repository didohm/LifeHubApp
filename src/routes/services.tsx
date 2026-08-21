import { useState } from "react";
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
  Sunrise,
  ChevronRight,
  Search,
} from "lucide-react";
import { motion } from "framer-motion";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { useData } from "@/lib/data-context";
import { sounds } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { GlobalSearchModal } from "@/components/lifehub/GlobalSearchModal";

export const Route = createFileRoute("/services")({
  head: () => ({
    meta: [
      { title: "Services & Daily Routines — LifeHub" },
      {
        name: "description",
        content:
          "Explore all LifeHub services: Workouts, Programs, Walking, Adhkar, Appointments, Medications, Bills, Documents, Tasks, AI assistant & Progress.",
      },
    ],
  }),
  component: Services,
});

interface ServiceItem {
  to: string;
  label: string;
  description: string;
  gradient: string;
  iconColor: string;
  badgeColor: string;
  Icon: React.ElementType;
  getCount?: (data: ReturnType<typeof useData>) => string | null;
}

const servicesData: ServiceItem[] = [
  {
    to: "/medications",
    label: "Hydration & Meds",
    description: "Prescriptions, dosages & water tracking",
    gradient: "from-[#FFE6F2] via-[#FFF0F7] to-[#FFF5F9] border-pink-200/60",
    iconColor: "text-pink-600 bg-pink-500/15",
    badgeColor: "bg-pink-500/10 text-pink-700",
    Icon: Pill,
    getCount: (d) => {
      const pending = (d.medications || []).filter((m) => !m.taken).length;
      return pending > 0 ? `${pending} pending` : `${(d.medications || []).length} active`;
    },
  },
  {
    to: "/appointments",
    label: "Appointments",
    description: "Doctor visits, sessions & prep",
    gradient: "from-[#DDF2FF] via-[#ECF7FF] to-[#F5FAFF] border-sky-200/60",
    iconColor: "text-sky-600 bg-sky-500/15",
    badgeColor: "bg-sky-500/10 text-sky-700",
    Icon: Calendar,
    getCount: (d) => {
      const up = (d.appointments || []).filter((a) => a.status !== "completed").length;
      return `${up} upcoming`;
    },
  },
  {
    to: "/workouts",
    label: "Workouts",
    description: "Exercise logs, reps & session tracker",
    gradient: "from-[#FFE4CC] via-[#FFF0E2] to-[#FFF6ED] border-orange-200/60",
    iconColor: "text-orange-600 bg-orange-500/15",
    badgeColor: "bg-orange-500/10 text-orange-700",
    Icon: Dumbbell,
    getCount: (d) => `${(d.workouts || []).length} logged`,
  },
  {
    to: "/workout-programs",
    label: "Workout Programs",
    description: "Weekly splits, cardio & custom plans",
    gradient: "from-[#EAE6FF] via-[#F4F1FF] to-[#FAF8FF] border-purple-200/60",
    iconColor: "text-purple-600 bg-purple-500/15",
    badgeColor: "bg-purple-500/10 text-purple-700",
    Icon: Target,
    getCount: (d) => `${(d.workoutPrograms || []).length} programs`,
  },
  {
    to: "/walk",
    label: "Walking & GPS",
    description: "Real-time route mapping & stats",
    gradient: "from-[#DCFCE7] via-[#EDFDF2] to-[#F7FEFA] border-emerald-200/60",
    iconColor: "text-emerald-600 bg-emerald-500/15",
    badgeColor: "bg-emerald-500/10 text-emerald-700",
    Icon: Footprints,
    getCount: (d) => `${(d.walkSessions || []).length} walks`,
  },
  {
    to: "/adhkar",
    label: "Adhkar & Zikr",
    description: "Morning, evening & daily supplications",
    gradient: "from-[#FEF3C7] via-[#FFFBEB] to-[#FEFDF8] border-amber-200/60",
    iconColor: "text-amber-700 bg-amber-500/15",
    badgeColor: "bg-amber-500/10 text-amber-800",
    Icon: Sunrise,
    getCount: () => "Daily Zikr",
  },
  {
    to: "/tasks",
    label: "To-Do Routine",
    description: "Daily task checklist & priorities",
    gradient: "from-[#E0F2FE] via-[#F0F9FF] to-[#F8FAFC] border-blue-200/60",
    iconColor: "text-blue-600 bg-blue-500/15",
    badgeColor: "bg-blue-500/10 text-blue-700",
    Icon: ListChecks,
    getCount: (d) => {
      const remaining = (d.todos || []).filter((t) => !t.completed).length;
      return `${remaining} remaining`;
    },
  },
  {
    to: "/bills",
    label: "Bills & Payments",
    description: "Recurring utilities, dues & invoices",
    gradient: "from-[#FFE8E0] via-[#FFF3EE] to-[#FFF8F5] border-rose-200/60",
    iconColor: "text-rose-600 bg-rose-500/15",
    badgeColor: "bg-rose-500/10 text-rose-700",
    Icon: Wallet,
    getCount: (d) => {
      const unpaid = (d.bills || []).filter((b) => b.status === "unpaid").length;
      return unpaid > 0 ? `${unpaid} unpaid` : "Up to date";
    },
  },
  {
    to: "/documents",
    label: "Documents",
    description: "Secure records, prescriptions, IDs & files",
    gradient: "from-[#F1F5F9] via-[#F8FAFC] to-white border-slate-200/80",
    iconColor: "text-slate-700 bg-slate-200",
    badgeColor: "bg-slate-200/60 text-slate-700",
    Icon: FolderClosed,
    getCount: (d) => `${(d.documents || []).length} files`,
  },
  {
    to: "/birthdays",
    label: "Birthdays & Events",
    description: "Important milestones & age reminders",
    gradient: "from-[#FCE7F3] via-[#FDF2F8] to-[#FFF9FB] border-pink-200/60",
    iconColor: "text-pink-600 bg-pink-500/15",
    badgeColor: "bg-pink-500/10 text-pink-700",
    Icon: Cake,
    getCount: (d) => `${(d.birthdays || []).length} dates`,
  },
  {
    to: "/ai",
    label: "AI Health Assistant",
    description: "24/7 intelligent health advisor & summaries",
    gradient: "from-[#7C5CFC] to-[#906FFA] border-[#7C5CFC]/30",
    iconColor: "text-white bg-white/20",
    badgeColor: "bg-white/20 text-white",
    Icon: Bot,
    getCount: () => "Live AI",
  },
  {
    to: "/analytics",
    label: "Progress & Analytics",
    description: "Comprehensive habit charts & health metrics",
    gradient: "from-white to-slate-50 border-border/80",
    iconColor: "text-[#7C5CFC] bg-[#7C5CFC]/15",
    badgeColor: "bg-[#7C5CFC]/10 text-[#7C5CFC]",
    Icon: Activity,
    getCount: () => "Charts",
  },
];

function Services() {
  const data = useData();
  const { user } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <Screen
      // Responsive container overrides: relax the global max-w-md cap so the
      // services hub can breathe on tablet/desktop while keeping mobile tight.
      // Mobile-first outer padding: px-4 (16px) on <640px gives cards more
      // room; scales to sm:px-6 / lg:px-8 per html-tailwind responsive-padding.
      contentClassName="max-w-5xl xl:max-w-6xl !px-4 sm:!px-6 lg:!px-8 !pt-4 sm:!pt-6 lg:!pt-8 !pb-28 sm:!pb-32"
    >
      <ScreenHeader
        title="Services"
        subtitle="All daily routines, health & tools"
        showBack
        action={
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="tap flex size-11 sm:size-10 items-center justify-center rounded-full border border-black/[0.04] bg-white text-[#12131A] shadow-sm hover:bg-slate-50"
            aria-label="Search services and items"
            title="Search"
          >
            <Search className="size-5" strokeWidth={2.4} />
          </button>
        }
      />

      {/* ════════════════════════════════════════════════════════════
          SERVICES GRID — responsive, mobile-first
          2 cols on mobile (375px), 3 cols from md (768px), 4 cols on xl
          gap scales with viewport to keep ≥8px touch spacing (ux:touch-spacing)
          ════════════════════════════════════════════════════════════ */}
      <div className="mt-2 grid grid-cols-2 gap-3 sm:mt-3 sm:gap-4 md:grid-cols-3 lg:gap-5 xl:grid-cols-4">
        {servicesData.map((service, idx) => {
          const count = service.getCount?.(data);
          const isAi = service.to === "/ai";

          return (
            <motion.div
              key={service.to}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: idx * 0.02 }}
            >
              <Link
                to={service.to}
                onClick={() => sounds.playCardClick()}
                className={cn(
                  "card-soft tap group relative flex min-h-[148px] flex-col justify-between overflow-hidden border p-3.5 pr-9 shadow-2xs transition-all hover:-translate-y-0.5 hover:shadow-md sm:min-h-[160px] sm:p-4 sm:pr-10 lg:min-h-[172px] lg:p-5 lg:pr-10",
                  "bg-gradient-to-br",
                  service.gradient,
                )}
              >
                <div>
                  <div className="flex items-center justify-between gap-1.5">
                    <div
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-full shadow-sm transition-transform group-hover:scale-105 sm:size-11",
                        service.iconColor,
                      )}
                    >
                      <service.Icon className="size-[18px] sm:size-5" strokeWidth={2.35} />
                    </div>

                    {count && (
                      <span
                        className={cn(
                          "rounded-full px-2 py-1 text-[9px] font-extrabold uppercase tracking-wide shadow-2xs truncate max-w-[84px] sm:max-w-[96px] sm:px-2.5 sm:text-[10px] lg:max-w-[110px]",
                          service.badgeColor,
                        )}
                      >
                        {count}
                      </span>
                    )}
                  </div>

                  <h3
                    className={cn(
                      "mt-3 text-[14px] font-extrabold leading-snug line-clamp-1 transition-transform group-hover:translate-x-0.5 sm:mt-3.5 sm:text-[15px]",
                      isAi ? "text-white" : "text-foreground",
                    )}
                  >
                    {service.label}
                  </h3>

                  <p
                    className={cn(
                      "mt-1 line-clamp-2 text-[11.5px] leading-snug sm:text-[12px]",
                      isAi ? "text-white/80" : "text-muted-foreground",
                    )}
                  >
                    {service.description}
                  </p>
                </div>

                <ChevronRight
                  className={cn(
                    "absolute right-3 top-1/2 size-4 -translate-y-1/2 transition-transform group-hover:translate-x-0.5 sm:right-3.5 sm:size-5",
                    isAi ? "text-white/85" : "text-[#12131A]",
                  )}
                  strokeWidth={2.2}
                />
              </Link>
            </motion.div>
          );
        })}
      </div>

      {user && (
        <GlobalSearchModal
          isOpen={searchOpen}
          onClose={() => setSearchOpen(false)}
          userId={user.id}
        />
      )}
    </Screen>
  );
}
