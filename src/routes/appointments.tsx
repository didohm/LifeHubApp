import { useState, useEffect, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Plus,
  Clock,
  MapPin,
  Trash2,
  X,
  Loader2,
  Check,
  MoreHorizontal,
  Pencil,
  CheckCircle2,
  Calendar,
  Stethoscope,
  Bell,
  ChevronRight,
  CalendarPlus,
  Activity,
  User,
  AlertCircle,
  ExternalLink,
  ChevronLeft,
  Navigation,
} from "lucide-react";
import { format, isTomorrow, isYesterday, differenceInCalendarDays } from "date-fns";
import { toast } from "sonner";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { Modal } from "@/components/lifehub/Modal";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { useDeleteWithGuard } from "@/hooks/use-delete-with-guard";
import { useData } from "@/lib/data-context";
import { createAppointment, updateAppointment, deleteAppointment, todayLocalDate } from "@/lib/api";
import { Notifications } from "@/lib/notifications-integration";
import { sounds } from "@/lib/sound";
import { Appointment } from "@/lib/types";
import { ListSkeleton } from "@/components/lifehub/SkeletonLoader";
import { parseLocalDate, isToday } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/appointments")({
  head: () => ({
    meta: [
      { title: "Medical Appointments & Health Sessions — LifeHub" },
      {
        name: "description",
        content:
          "Track doctor visits, medical consultations, dental checkups, and therapy sessions.",
      },
    ],
  }),
  component: AppointmentsPage,
});

function getRelativeDateLabel(dateStr: string): { label: string; isTodayDate: boolean } {
  if (!dateStr) return { label: "TBD", isTodayDate: false };
  const d = parseLocalDate(dateStr);
  if (isToday(d)) return { label: "Today", isTodayDate: true };
  if (isTomorrow(d)) return { label: "Tomorrow", isTodayDate: false };
  if (isYesterday(d)) return { label: "Yesterday", isTodayDate: false };

  const diff = differenceInCalendarDays(d, new Date());
  if (diff > 1 && diff <= 7) {
    return { label: format(d, "EEEE"), isTodayDate: false };
  }
  return { label: format(d, "MMM d, yyyy"), isTodayDate: false };
}

const PRIORITY_CONFIG = {
  high: {
    label: "High Priority",
    shortLabel: "High",
    badge: "bg-rose-50 text-rose-700 border-rose-200",
    pillActive: "bg-rose-600 text-white shadow-xs",
    dot: "bg-rose-500",
  },
  medium: {
    label: "Medium Priority",
    shortLabel: "Medium",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    pillActive: "bg-amber-600 text-white shadow-xs",
    dot: "bg-amber-500",
  },
  light: {
    label: "Low Priority",
    shortLabel: "Low",
    badge: "bg-slate-100 text-slate-700 border-slate-200",
    pillActive: "bg-slate-800 text-white shadow-xs",
    dot: "bg-slate-400",
  },
} as const;

const QUICK_PRESETS = [
  { title: "General Consultation", doctor: "Dr. Sarah Smith", icon: "🩺" },
  { title: "Dental Checkup & Cleaning", doctor: "Dr. Alex Rivera", icon: "🦷" },
  { title: "Physical Therapy Session", doctor: "Dr. Michael Chen", icon: "🧘" },
  { title: "Eye Exam & Vision Check", doctor: "Dr. Elena Vance", icon: "👁️" },
  { title: "Blood Panel & Lab Test", doctor: "City Diagnostics Lab", icon: "💉" },
  { title: "Cardiology Review", doctor: "Dr. Robert Hayes", icon: "❤️" },
];

type FilterTab = "Upcoming" | "Today" | "Completed" | "All";

function AppointmentsPage() {
  const { user } = useAuth();

  const { appointments, appLoading, refreshAppointments } = useData();

  const [activeFilter, setActiveFilter] = useState<FilterTab>("Upcoming");
  const [selectedPlan, setSelectedPlan] = useState<Appointment | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<Appointment | null>(null);

  const [title, setTitle] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [location, setLocation] = useState("");
  const [appointmentDate, setAppointmentDate] = useState(todayLocalDate());
  const [startTime, setStartTime] = useState("10:00");
  const [priority, setPriority] = useState<"high" | "medium" | "light">("medium");
  const [reminderOffsetMinutes, setReminderOffsetMinutes] = useState<number>(30);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const { deleteWithGuard } = useDeleteWithGuard();

  const resetForm = () => {
    setTitle("");
    setDoctorName("");
    setLocation("");
    setAppointmentDate(todayLocalDate());
    setStartTime("10:00");
    setPriority("medium");
    setReminderOffsetMinutes(30);
    setNotes("");
  };

  const openAddModal = () => {
    sounds.playActionClick();
    setEditingApp(null);
    resetForm();
    setModalOpen(true);
  };

  const openEditModal = (app: Appointment) => {
    sounds.playActionClick();
    setEditingApp(app);
    setTitle(app.title);
    setDoctorName(app.doctor_name);
    setLocation(app.location || "");
    setAppointmentDate(app.appointment_date);
    setStartTime(app.start_time || "10:00");
    setPriority(app.priority);
    setReminderOffsetMinutes(app.reminder_offset_minutes ?? 30);
    setNotes(app.notes || "");
    setModalOpen(true);
  };

  const applyPreset = (preset: { title: string; doctor: string }) => {
    sounds.playClick();
    setTitle(preset.title);
    if (!doctorName) setDoctorName(preset.doctor);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);

    try {
      if (editingApp) {
        await updateAppointment(editingApp.id, user.id, {
          title,
          doctor_name: doctorName,
          location,
          appointment_date: appointmentDate,
          start_time: startTime,
          priority,
          reminder: true,
          reminder_offset_minutes: reminderOffsetMinutes,
          notes,
        });
        Notifications.cancelAppointment(editingApp.id);
        Notifications.scheduleAppointment({
          id: editingApp.id,
          title,
          doctor_name: doctorName,
          appointment_date: appointmentDate,
          start_time: startTime,
          reminder: true,
          reminder_offset_minutes: reminderOffsetMinutes,
        } as any);
        sounds.playClick();
        toast.success("Appointment updated successfully!");
      } else {
        const newApp = await createAppointment(user.id, {
          title,
          doctor_name: doctorName,
          location,
          appointment_date: appointmentDate,
          start_time: startTime,
          priority,
          reminder: true,
          reminder_offset_minutes: reminderOffsetMinutes,
          notes,
        });
        Notifications.scheduleAppointment(newApp);
        sounds.playSuccess();
        toast.success("New appointment scheduled!");
      }
      await refreshAppointments();
      setModalOpen(false);
      resetForm();
    } catch {
      sounds.playError();
      toast.error("Could not save appointment.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    await deleteWithGuard(id, async () => {
      await deleteAppointment(id, user.id);
      Notifications.cancelAppointment(id);
      sounds.playClick();
      await refreshAppointments();
      toast.success("Appointment removed.");
      if (selectedPlan?.id === id) setSelectedPlan(null);
    })().catch(() => {
      sounds.playError();
      toast.error("Failed to remove appointment.");
    });
  };

  const handleToggleComplete = async (app: Appointment) => {
    if (!user || joiningId) return;
    const isCompleting = app.status !== "completed";
    setJoiningId(app.id);

    try {
      if (isCompleting) {
        await updateAppointment(app.id, user.id, { status: "completed" });
        Notifications.cancelAppointment(app.id);
        sounds.playSuccess();
        toast.success(`Completed "${app.title}" 🎉`);
      } else {
        await updateAppointment(app.id, user.id, { status: "upcoming" });
        sounds.playClick();
        toast.success(`Reopened "${app.title}"`);
      }
      await refreshAppointments();
      if (selectedPlan?.id === app.id) {
        setSelectedPlan({
          ...app,
          status: isCompleting ? "completed" : "upcoming",
        });
      }
    } catch {
      sounds.playError();
      toast.error("Could not update status.");
    } finally {
      setJoiningId(null);
    }
  };

  // Earliest non-completed appointment for Spotlight card
  const nextAppointment = useMemo(() => {
    const upcoming = appointments
      .filter((a) => a.status !== "completed")
      .sort((a, b) => {
        const dateA = `${a.appointment_date} ${a.start_time || "00:00"}`;
        const dateB = `${b.appointment_date} ${b.start_time || "00:00"}`;
        const comparison = dateA.localeCompare(dateB);
        if (comparison === 0) return a.id.localeCompare(b.id);
        return comparison;
      });
    return upcoming[0] || null;
  }, [appointments]);

  // Counts
  const stats = useMemo(() => {
    const upcomingCount = appointments.filter((a) => a.status !== "completed").length;
    const todayCount = appointments.filter(
      (a) => a.status !== "completed" && isToday(parseLocalDate(a.appointment_date)),
    ).length;
    const completedCount = appointments.filter((a) => a.status === "completed").length;
    return { upcomingCount, todayCount, completedCount, totalCount: appointments.length };
  }, [appointments]);

  // Filtered Appointments List
  const filteredApps = useMemo(() => {
    return appointments.filter((app) => {
      if (activeFilter === "Upcoming") return app.status !== "completed";
      if (activeFilter === "Today")
        return app.status !== "completed" && isToday(parseLocalDate(app.appointment_date));
      if (activeFilter === "Completed") return app.status === "completed";
      return true;
    });
  }, [appointments, activeFilter]);

  // Grouping
  const todayApps = filteredApps.filter(
    (a) => isToday(parseLocalDate(a.appointment_date)) && a.status !== "completed",
  );

  const upcomingOtherApps = useMemo(() => {
    return filteredApps.filter(
      (a) => !isToday(parseLocalDate(a.appointment_date)) && a.status !== "completed",
    );
  }, [filteredApps]);

  const completedApps = useMemo(() => {
    return filteredApps.filter((a) => a.status === "completed");
  }, [filteredApps]);

  return (
    <Screen>
      <ScreenHeader
        title="Appointments"
        subtitle="Medical visits, consultations & checkups"
        showBack
        action={
          <button
            onClick={openAddModal}
            className="tap flex items-center gap-1.5 rounded-full bg-[#12131A] px-4 py-2 text-xs font-black text-white shadow-md hover:bg-slate-800 transition-transform active:scale-95"
          >
            <Plus className="size-3.5 stroke-[3]" /> Add Session
          </button>
        }
      />

      {/* ══════════════════════════════════════════════════════════════
          SPOTLIGHT CARD: NEXT UPCOMING APPOINTMENT
          ══════════════════════════════════════════════════════════════ */}
      <div className="card-soft rounded-3xl bg-gradient-to-br from-[#0E1017] via-[#171A26] to-[#25293A] text-white p-5 shadow-md mb-4 border border-white/10 relative overflow-hidden">
        {nextAppointment ? (
          <div>
            <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                Next Upcoming Consultation
              </span>
              <span className="text-[11px] font-extrabold text-white/80 bg-white/10 px-2.5 py-0.5 rounded-full">
                {getRelativeDateLabel(nextAppointment.appointment_date).label} ·{" "}
                {nextAppointment.start_time || "10:00"}
              </span>
            </div>

            <div className="mt-3.5 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-black text-white tracking-tight truncate">
                  {nextAppointment.title}
                </h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/70 font-semibold">
                  {nextAppointment.doctor_name && (
                    <span className="flex items-center gap-1.5">
                      <Stethoscope className="size-3.5 text-emerald-400" />
                      <span className="truncate">{nextAppointment.doctor_name}</span>
                    </span>
                  )}
                  {nextAppointment.location && (
                    <span className="flex items-center gap-1.5">
                      <MapPin className="size-3.5 text-cyan-400" />
                      <span className="truncate">{nextAppointment.location}</span>
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  sounds.playClick();
                  setSelectedPlan(nextAppointment);
                }}
                className="tap flex size-9 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white hover:bg-white/20 transition-colors border border-white/10"
                aria-label="View Details"
              >
                <ChevronRight className="size-4.5" />
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between pt-3 border-t border-white/10 text-xs">
              <span className="text-[11px] font-semibold text-white/50">
                {(() => {
                  const diff = differenceInCalendarDays(
                    parseLocalDate(nextAppointment.appointment_date),
                    new Date(),
                  );
                  if (diff === 0) return "Scheduled for today";
                  if (diff === 1) return "Scheduled for tomorrow";
                  if (diff > 1) return `Coming up in ${diff} days`;
                  if (diff === -1) return "Yesterday";
                  return `${Math.abs(diff)} days ago`;
                })()}
              </span>

              <button
                type="button"
                onClick={() => handleToggleComplete(nextAppointment)}
                disabled={joiningId === nextAppointment.id}
                className="tap inline-flex items-center gap-1.5 rounded-full bg-emerald-500 hover:bg-emerald-600 px-4 py-1.5 text-xs font-black text-white shadow-sm transition-transform active:scale-95"
              >
                {joiningId === nextAppointment.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-3.5" />
                )}
                <span>Mark Done</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="py-3 text-center">
            <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-2xl bg-white/10 text-emerald-400">
              <CalendarPlus className="size-6" />
            </div>
            <h3 className="text-base font-black text-white">No Upcoming Appointments</h3>
            <p className="mt-0.5 text-xs text-white/60 font-medium">
              Your health schedule is clear. Tap below to schedule a consultation.
            </p>
            <button
              type="button"
              onClick={openAddModal}
              className="tap mt-3 inline-flex items-center gap-1.5 rounded-full bg-white text-[#12131A] px-4 py-2 text-xs font-black hover:bg-slate-100 transition-transform active:scale-95 shadow-md"
            >
              <Plus className="size-3.5 stroke-[3]" /> Schedule Session
            </button>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          FILTER TABS ROW
          ══════════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 mb-4 [scrollbar-width:none]">
        {(
          [
            { id: "Upcoming", label: "Upcoming", count: stats.upcomingCount },
            { id: "Today", label: "Today", count: stats.todayCount },
            { id: "Completed", label: "Completed", count: stats.completedCount },
            { id: "All", label: "All Sessions", count: stats.totalCount },
          ] as const
        ).map((tab) => {
          const isActive = activeFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                sounds.playNavClick();
                setActiveFilter(tab.id as FilterTab);
              }}
              className={cn(
                "tap flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-black whitespace-nowrap transition-all shadow-2xs",
                isActive
                  ? "bg-[#12131A] text-white shadow-xs"
                  : "bg-white text-muted-foreground border border-black/5 hover:bg-slate-50 hover:text-foreground",
              )}
            >
              <span>{tab.label}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.2 text-[9px] font-black",
                  isActive ? "bg-white/20 text-white" : "bg-slate-100 text-muted-foreground",
                )}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          MAIN APPOINTMENTS LIST
          ══════════════════════════════════════════════════════════════ */}
      <div className="space-y-4 mb-6">
        {appLoading ? (
          <ListSkeleton count={3} />
        ) : filteredApps.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-6 text-center shadow-xs">
            <div className="mx-auto mb-3 flex h-32 w-full max-w-[190px] items-center justify-center">
              <img
                src="/illustration/empty-appointments.webp"
                alt="Appointments Illustration"
                className="h-full w-full object-contain"
              />
            </div>
            <p className="text-base font-black text-[#12131A]">No appointments in this view</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto font-medium">
              Schedule your doctor visits, dental checkups, and medical sessions to stay on top of
              your health.
            </p>
            <button
              type="button"
              onClick={openAddModal}
              className="tap mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#12131A] px-5 py-2.5 text-xs font-black text-white shadow-md hover:bg-slate-800 transition-transform active:scale-95"
            >
              <Plus className="size-3.5 stroke-[3]" /> Schedule Session
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Today Section */}
            {todayApps.length > 0 && activeFilter !== "Completed" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-emerald-800">
                    Today ({todayApps.length})
                  </h3>
                </div>
                {todayApps.map((app) => (
                  <AppointmentCard
                    key={app.id}
                    app={app}
                    onSelect={() => {
                      sounds.playClick();
                      setSelectedPlan(app);
                    }}
                    onToggleComplete={() => handleToggleComplete(app)}
                    onEdit={() => openEditModal(app)}
                    onDelete={() => handleDelete(app.id)}
                    joiningId={joiningId}
                  />
                ))}
              </div>
            )}

            {/* Upcoming / Later Section */}
            {upcomingOtherApps.length > 0 && activeFilter !== "Completed" && (
              <div className="space-y-2">
                {todayApps.length > 0 && (
                  <h3 className="text-xs font-black uppercase tracking-wider text-muted-foreground px-1 pt-2">
                    Upcoming Sessions ({upcomingOtherApps.length})
                  </h3>
                )}
                {upcomingOtherApps.map((app) => (
                  <AppointmentCard
                    key={app.id}
                    app={app}
                    onSelect={() => {
                      sounds.playClick();
                      setSelectedPlan(app);
                    }}
                    onToggleComplete={() => handleToggleComplete(app)}
                    onEdit={() => openEditModal(app)}
                    onDelete={() => handleDelete(app.id)}
                    joiningId={joiningId}
                  />
                ))}
              </div>
            )}

            {/* Completed Section */}
            {completedApps.length > 0 &&
              (activeFilter === "Completed" || activeFilter === "All") && (
                <div className="space-y-2 pt-1">
                  {(todayApps.length > 0 || upcomingOtherApps.length > 0) && (
                    <h3 className="text-xs font-black uppercase tracking-wider text-muted-foreground px-1">
                      Completed ({completedApps.length})
                    </h3>
                  )}
                  {completedApps.map((app) => (
                    <AppointmentCard
                      key={app.id}
                      app={app}
                      onSelect={() => {
                        sounds.playClick();
                        setSelectedPlan(app);
                      }}
                      onToggleComplete={() => handleToggleComplete(app)}
                      onEdit={() => openEditModal(app)}
                      onDelete={() => handleDelete(app.id)}
                      joiningId={joiningId}
                    />
                  ))}
                </div>
              )}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          APPOINTMENT DETAIL MODAL
          ══════════════════════════════════════════════════════════════ */}
      {selectedPlan && (
        <Modal open onClose={() => setSelectedPlan(null)} className="bg-white p-5 max-w-md">
          <div className="flex items-start justify-between border-b border-black/5 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-block rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase border",
                    PRIORITY_CONFIG[selectedPlan.priority]?.badge ?? "bg-slate-100 text-slate-700",
                  )}
                >
                  {PRIORITY_CONFIG[selectedPlan.priority]?.label}
                </span>
                {selectedPlan.status === "completed" && (
                  <span className="inline-block rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-black uppercase">
                    Completed
                  </span>
                )}
              </div>
              <h2 className="mt-2 text-lg font-black text-[#12131A] tracking-tight">
                {selectedPlan.title}
              </h2>
              <p className="text-xs text-muted-foreground font-semibold mt-0.5 flex items-center gap-1">
                <Calendar className="size-3.5 text-muted-foreground" />
                {getRelativeDateLabel(selectedPlan.appointment_date).label} at{" "}
                {selectedPlan.start_time || "10:00"}
              </p>
            </div>
            <button
              onClick={() => setSelectedPlan(null)}
              aria-label="Close details"
              className="size-7 flex items-center justify-center rounded-full bg-black/5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {/* Doctor Info */}
            {selectedPlan.doctor_name && (
              <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3.5 border border-black/5">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#12131A] text-white">
                  <Stethoscope className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block text-[10px] font-black text-muted-foreground uppercase tracking-wider">
                    Doctor / Specialist
                  </span>
                  <span className="text-xs font-black text-[#12131A] truncate block">
                    {selectedPlan.doctor_name}
                  </span>
                </div>
              </div>
            )}

            {/* Location & Reminder Info */}
            <div className="grid grid-cols-2 gap-2">
              {selectedPlan.location && (
                <div className="rounded-2xl bg-slate-50 p-3 border border-black/5">
                  <span className="flex items-center gap-1 text-[10px] font-black text-muted-foreground uppercase tracking-wider mb-0.5">
                    <MapPin className="size-3 text-cyan-600" /> Location
                  </span>
                  <span className="text-xs font-bold text-[#12131A] block truncate">
                    {selectedPlan.location}
                  </span>
                </div>
              )}

              <div className="rounded-2xl bg-slate-50 p-3 border border-black/5">
                <span className="flex items-center gap-1 text-[10px] font-black text-muted-foreground uppercase tracking-wider mb-0.5">
                  <Bell className="size-3 text-amber-600" /> Reminder
                </span>
                <span className="text-xs font-bold text-[#12131A] block">
                  {selectedPlan.reminder_offset_minutes
                    ? `${selectedPlan.reminder_offset_minutes}m before`
                    : "At time of event"}
                </span>
              </div>
            </div>

            {/* Notes */}
            {selectedPlan.notes && (
              <div className="rounded-2xl bg-slate-50 p-3.5 border border-black/5">
                <span className="block text-[10px] font-black text-muted-foreground uppercase tracking-wider mb-1">
                  Session Notes
                </span>
                <p className="text-xs text-slate-700 leading-relaxed font-medium">
                  {selectedPlan.notes}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="pt-2 space-y-2">
              <button
                type="button"
                onClick={() => handleToggleComplete(selectedPlan)}
                disabled={joiningId === selectedPlan.id}
                className={cn(
                  "tap w-full rounded-full py-3 text-xs font-black text-white shadow-md transition-all flex items-center justify-center gap-1.5",
                  selectedPlan.status === "completed"
                    ? "bg-slate-700 hover:bg-slate-800"
                    : "bg-[#12131A] hover:bg-slate-800",
                )}
              >
                {joiningId === selectedPlan.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : selectedPlan.status === "completed" ? (
                  <>
                    <Check className="size-4 stroke-[3]" /> Reopen Session
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-4" /> Mark Completed
                  </>
                )}
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const plan = selectedPlan;
                    setSelectedPlan(null);
                    openEditModal(plan);
                  }}
                  className="tap w-1/2 rounded-full border border-black/10 py-2.5 text-xs font-black text-[#12131A] hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Pencil className="size-3.5 text-muted-foreground" /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(selectedPlan.id)}
                  className="tap w-1/2 rounded-full border border-rose-200 bg-rose-50/70 py-2.5 text-xs font-black text-rose-600 hover:bg-rose-100 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Trash2 className="size-3.5 text-rose-500" /> Delete
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════════════════════
          ADD / EDIT APPOINTMENT FORM MODAL
          ══════════════════════════════════════════════════════════════ */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} className="bg-white max-w-md p-5">
        <div className="flex items-center justify-between border-b border-black/5 pb-3">
          <div>
            <h3 className="text-base font-black text-[#12131A] tracking-tight">
              {editingApp ? "Edit Session" : "Schedule New Session"}
            </h3>
            <p className="text-[11px] font-semibold text-muted-foreground">
              Doctor consultations, checkups & therapy
            </p>
          </div>
          <button
            onClick={() => setModalOpen(false)}
            aria-label="Close form"
            className="size-7 flex items-center justify-center rounded-full bg-black/5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Quick Type Presets */}
        {!editingApp && (
          <div className="mt-3.5">
            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-wider block mb-1.5">
              Quick Suggestions
            </span>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
              {QUICK_PRESETS.map((preset) => (
                <button
                  key={preset.title}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="tap rounded-xl bg-slate-50 hover:bg-slate-100 border border-black/5 px-3 py-1.5 text-[11px] font-bold text-slate-800 whitespace-nowrap transition-colors flex items-center gap-1.5 shrink-0"
                >
                  <span>{preset.icon}</span>
                  <span>{preset.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSave} className="mt-4 space-y-3.5">
          <div>
            <label className="text-xs font-bold text-[#12131A] block mb-1">Session Title</label>
            <input
              type="text"
              required
              placeholder="e.g. Dental Checkup / Cardiology Consultation"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-[#F9F9FD] px-3 py-2.5 text-xs font-bold outline-none focus:border-[#7C5CFC] focus:bg-white transition-all"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold text-[#12131A] block mb-1">
                Doctor / Specialist
              </label>
              <input
                type="text"
                required
                placeholder="Dr. Sarah Smith"
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-[#F9F9FD] px-3 py-2.5 text-xs font-bold outline-none focus:border-[#7C5CFC] focus:bg-white transition-all"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#12131A] block mb-1">
                Clinic / Location
              </label>
              <input
                type="text"
                placeholder="City Health Center / Room 302"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-[#F9F9FD] px-3 py-2.5 text-xs font-bold outline-none focus:border-[#7C5CFC] focus:bg-white transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold text-[#12131A] block mb-1">Date</label>
              <input
                type="date"
                required
                value={appointmentDate}
                onChange={(e) => setAppointmentDate(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-[#F9F9FD] px-3 py-2.5 text-xs font-bold outline-none focus:border-[#7C5CFC] focus:bg-white transition-all"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#12131A] block mb-1">Time</label>
              <input
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-[#F9F9FD] px-3 py-2.5 text-xs font-bold outline-none focus:border-[#7C5CFC] focus:bg-white transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold text-[#12131A] block mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as "high" | "medium" | "light")}
                className="w-full rounded-xl border border-black/10 bg-[#F9F9FD] px-3 py-2.5 text-xs font-bold outline-none focus:border-[#7C5CFC] focus:bg-white transition-all"
              >
                <option value="high">High Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="light">Low Priority</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-[#12131A] block mb-1">Reminder Alert</label>
              <select
                value={reminderOffsetMinutes}
                onChange={(e) => setReminderOffsetMinutes(Number(e.target.value))}
                className="w-full rounded-xl border border-black/10 bg-[#F9F9FD] px-3 py-2.5 text-xs font-bold outline-none focus:border-[#7C5CFC] focus:bg-white transition-all"
              >
                <option value={15}>15 minutes before</option>
                <option value={30}>30 minutes before</option>
                <option value={60}>1 hour before</option>
                <option value={1440}>1 day before</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-[#12131A] block mb-1">
              Notes & Preparations
            </label>
            <textarea
              rows={2}
              placeholder="Fasting required, bring medical insurance card, lab results..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-[#F9F9FD] px-3 py-2 text-xs font-medium outline-none focus:border-[#7C5CFC] focus:bg-white transition-all resize-none"
            />
          </div>

          <div className="flex gap-2 pt-3">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="w-1/2 rounded-full border border-black/10 py-2.5 text-xs font-black text-muted-foreground hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="tap w-1/2 flex items-center justify-center gap-1.5 rounded-full bg-[#12131A] py-2.5 text-xs font-black text-white shadow-md hover:bg-slate-800 disabled:opacity-50 transition-transform active:scale-95"
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {submitting ? "Saving..." : editingApp ? "Update Session" : "Schedule Session"}
            </button>
          </div>
        </form>
      </Modal>
    </Screen>
  );
}

// ══════════════════════════════════════════════════════════════
// APPOINTMENT CARD COMPONENT
// ══════════════════════════════════════════════════════════════
function AppointmentCard({
  app,
  onSelect,
  onToggleComplete,
  onEdit,
  onDelete,
  joiningId,
}: {
  app: Appointment;
  onSelect: () => void;
  onToggleComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
  joiningId: string | null;
}) {
  const isCompleted = app.status === "completed";
  const dateInfo = getRelativeDateLabel(app.appointment_date);

  return (
    <div
      className={cn(
        "card-soft bg-white p-4 border border-black/5 shadow-xs hover:shadow-sm transition-all rounded-2xl flex items-center justify-between gap-3 group",
        isCompleted && "opacity-60 bg-slate-50/50",
      )}
    >
      {/* Checkbox Complete Action */}
      <button
        type="button"
        onClick={onToggleComplete}
        disabled={joiningId === app.id}
        aria-label={`Mark appointment ${app.title} as completed`}
        className={cn(
          "tap flex size-6 shrink-0 items-center justify-center rounded-full border transition-all",
          isCompleted
            ? "bg-emerald-500 border-emerald-500 text-white"
            : "border-slate-300 hover:border-slate-400 bg-white",
        )}
      >
        {joiningId === app.id ? (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        ) : isCompleted ? (
          <Check className="size-3.5 stroke-[3]" />
        ) : null}
      </button>

      {/* Main Content Info */}
      <div className="min-w-0 flex-1 cursor-pointer" onClick={onSelect}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider",
              dateInfo.isTodayDate
                ? "bg-emerald-100 text-emerald-800"
                : "bg-slate-100 text-slate-700",
            )}
          >
            {dateInfo.label} · {app.start_time || "10:00"}
          </span>

          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase",
              PRIORITY_CONFIG[app.priority]?.badge ?? "bg-slate-100 text-slate-700",
            )}
          >
            {PRIORITY_CONFIG[app.priority]?.shortLabel}
          </span>
        </div>

        <h4
          className={cn(
            "mt-1 text-sm font-black text-[#12131A] tracking-tight truncate",
            isCompleted && "line-through text-muted-foreground",
          )}
        >
          {app.title}
        </h4>

        <div className="mt-0.5 flex items-center gap-3 text-[11px] font-semibold text-muted-foreground truncate">
          {app.doctor_name && (
            <span className="flex items-center gap-1 truncate">
              <Stethoscope className="size-3 text-slate-500" />
              {app.doctor_name}
            </span>
          )}
          {app.location && (
            <span className="flex items-center gap-1 truncate">
              <MapPin className="size-3 text-slate-400" />
              {app.location}
            </span>
          )}
        </div>
      </div>

      {/* Dropdown Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="tap size-8 flex items-center justify-center rounded-full text-muted-foreground hover:bg-slate-100 hover:text-foreground shrink-0"
            aria-label="Appointment Options"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-40 rounded-2xl bg-white p-1.5 shadow-lg border border-black/5"
        >
          <DropdownMenuItem onClick={onSelect} className="rounded-xl text-xs font-bold py-2">
            View Details
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onEdit} className="rounded-xl text-xs font-bold py-2">
            Edit Session
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDelete}
            className="rounded-xl text-xs font-bold py-2 text-rose-600 focus:text-rose-600 focus:bg-rose-50"
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
