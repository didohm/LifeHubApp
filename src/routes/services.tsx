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
} from "lucide-react";
import { motion } from "framer-motion";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { useData } from "@/lib/data-context";
import { sounds } from "@/lib/sound";
import { cn } from "@/lib/utils";

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
    gradient: "from-[#7C5CFC] to-[#906FFA] text-white border-[#7C5CFC]/30",
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
    getCount: () => "Charts & Trends",
  },
];

function Services() {
  const data = useData();

  return (
    <Screen>
      <ScreenHeader
        title="Services"
        subtitle="All daily routines, health & tools"
        showBack
      />

      {/* ════════════════════════════════════════════════════════════
          SERVICES GRID
          ════════════════════════════════════════════════════════════ */}
      <div className="mt-1 grid grid-cols-2 gap-3">
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
                  "card-soft tap group relative flex flex-col justify-between p-4 shadow-2xs hover:shadow-md transition-all min-h-[145px] border",
                  "bg-gradient-to-br",
                  service.gradient,
                )}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div
                      className={cn(
                        "flex size-9 items-center justify-center rounded-2xl shadow-2xs transition-transform group-hover:scale-105",
                        service.iconColor,
                      )}
                    >
                      <service.Icon className="size-4.5" />
                    </div>

                    {count && (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[9.5px] font-black uppercase tracking-wide shadow-2xs truncate max-w-[80px]",
                          service.badgeColor,
                        )}
                      >
                        {count}
                      </span>
                    )}
                  </div>

                  <h3
                    className={cn(
                      "mt-3 text-sm font-extrabold leading-snug line-clamp-1 group-hover:translate-x-0.5 transition-transform",
                      isAi ? "text-white" : "text-[#12131A]",
                    )}
                  >
                    {service.label}
                  </h3>

                  <p
                    className={cn(
                      "mt-1 text-[11px] leading-snug line-clamp-2",
                      isAi ? "text-white/80" : "text-muted-foreground",
                    )}
                  >
                    {service.description}
                  </p>
                </div>

                <div
                  className={cn(
                    "mt-3 flex items-center justify-between border-t pt-2 text-[10.5px] font-bold",
                    isAi ? "border-white/20 text-white/90" : "border-black/5 text-muted-foreground",
                  )}
                >
                  <span>Open Tool</span>
                  <ChevronRight
                    className={cn(
                      "size-3.5 group-hover:translate-x-1 transition-transform",
                      isAi ? "text-white" : "text-[#7C5CFC]",
                    )}
                  />
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </Screen>
  );
}
