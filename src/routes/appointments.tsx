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
} from "lucide-react";
import { format, isTomorrow, differenceInCalendarDays } from "date-fns";
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
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useDeleteWithGuard } from "@/hooks/use-delete-with-guard";
import { useData } from "@/lib/data-context";
import { createAppointment, updateAppointment, deleteAppointment, todayLocalDate } from "@/lib/api";
import { Notifications } from "@/lib/notifications-integration";
import { sounds } from "@/lib/sound";
import { Appointment } from "@/lib/types";
import { ListSkeleton } from "@/components/lifehub/SkeletonLoader";
import { parseLocalDate, isToday } from "@/lib/date-utils";

export const Route = createFileRoute("/appointments")({
  head: () => ({
    meta: [{ title: "Appointments — LifeHub" }],
  }),
  component: AppointmentsPage,
});

function getRelativeDateLabel(dateStr: string): { label: string; isTodayDate: boolean } {
  if (!dateStr) return { label: "TBD", isTodayDate: false };
  const d = parseLocalDate(dateStr);
  if (isToday(d)) return { label: "Today", isTodayDate: true };
  if (isTomorrow(d)) return { label: "Tomorrow", isTodayDate: false };

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
    badge:
      "bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/50",
    pillActive: "bg-rose-600 text-white shadow-xs",
    dot: "bg-rose-500",
  },
  medium: {
    label: "Medium Priority",
    shortLabel: "Medium",
    badge:
      "bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50",
    pillActive: "bg-amber-600 text-white shadow-xs",
    dot: "bg-amber-500",
  },
  light: {
    label: "Low Priority",
    shortLabel: "Low",
    badge:
      "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    pillActive: "bg-slate-800 text-white shadow-xs",
    dot: "bg-slate-400",
  },
} as const;

const QUICK_PRESETS = [
  { title: "Doctor Consultation", doctor: "Dr. Sarah Smith", icon: "🩺" },
  { title: "Dental Checkup", doctor: "Dr. Alex Rivera", icon: "🦷" },
  { title: "Physical Therapy", doctor: "Dr. Michael Chen", icon: "🧘" },
  { title: "Eye Exam", doctor: "Dr. Elena Vance", icon: "👁️" },
  { title: "Blood Work & Lab", doctor: "City Health Lab", icon: "💉" },
  { title: "Routine Checkup", doctor: "Primary Care", icon: "🏥" },
];

type FilterTab = "Upcoming" | "Today" | "Completed" | "All";

function AppointmentsPage() {
  const { user, loading: authLoading } = useAuth();
  useAuthGuard(user, authLoading);

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
    setEditingApp(null);
    resetForm();
    setModalOpen(true);
  };

  const openEditModal = (app: Appointment) => {
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
        toast.success("Appointment updated");
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
        toast.success("New appointment scheduled");
      }
      await refreshAppointments();
      setModalOpen(false);
      resetForm();
    } catch {
      toast.error("Could not save appointment");
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
      toast.success("Appointment removed", { id: `apt-removed-${id}` });
      if (selectedPlan?.id === id) setSelectedPlan(null);
    })().catch(() => {
      toast.error("Failed to remove appointment", { id: `apt-remove-error-${id}` });
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
        toast.success(`Completed "${app.title}"`);
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
      toast.error("Could not update session status");
    } finally {
      setJoiningId(null);
    }
  };

  // Earliest non-completed appointment for the Spotlight card
  const nextAppointment = useMemo(() => {
    const upcoming = appointments
      .filter((a) => a.status !== "completed")
      .sort((a, b) => {
        const dateA = `${a.appointment_date} ${a.start_time || "00:00"}`;
        const dateB = `${b.appointment_date} ${b.start_time || "00:00"}`;
        const comparison = dateA.localeCompare(dateB);
        // If same date/time, sort by creation order (use id as tiebreaker)
        if (comparison === 0) {
          return a.id.localeCompare(b.id);
        }
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
        subtitle="Medical consultations & scheduled health events"
        showBack
        action={
          <button
            onClick={openAddModal}
            className="tap inline-flex items-center gap-1.5 rounded-xl bg-[#12131A] px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#12131A]/90 transition-colors"
          >
            <Plus className="size-3.5" />
            <span>New Session</span>
          </button>
        }
      />

      {/* Spotlight Card: Clean, restrained charcoal container */}
      <div className="rounded-2xl bg-[#12131A] text-white p-4 shadow-sm mb-4 border border-black/10 relative overflow-hidden">
        {nextAppointment ? (
          <div>
            <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                Next Upcoming Session
              </span>
              <span className="text-[11px] font-medium text-emerald-400 flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                {getRelativeDateLabel(nextAppointment.appointment_date).label} at{" "}
                {nextAppointment.start_time || "10:00"}
              </span>
            </div>

            <div className="mt-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold text-white truncate">{nextAppointment.title}</h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-300 font-medium">
                  {nextAppointment.doctor_name && (
                    <span className="flex items-center gap-1.5">
                      <Stethoscope className="size-3.5 text-neutral-400" />
                      <span className="truncate">{nextAppointment.doctor_name}</span>
                    </span>
                  )}
                  {nextAppointment.location && (
                    <span className="flex items-center gap-1.5">
                      <MapPin className="size-3.5 text-neutral-400" />
                      <span className="truncate">{nextAppointment.location}</span>
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => setSelectedPlan(nextAppointment)}
                className="tap flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors"
                aria-label="View Details"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            <div className="mt-3.5 flex items-center justify-between pt-2.5 border-t border-white/10 text-xs">
              <span className="text-[11px] text-neutral-400">
                {isToday(parseLocalDate(nextAppointment.appointment_date))
                  ? "Scheduled for today"
                  : `In ${differenceInCalendarDays(parseLocalDate(nextAppointment.appointment_date), new Date())} days`}
              </span>

              <button
                onClick={() => handleToggleComplete(nextAppointment)}
                disabled={joiningId === nextAppointment.id}
                className="tap inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
              >
                {joiningId === nextAppointment.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-3.5" />
                )}
                <span>Mark Complete</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="py-2 text-center">
            <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-xl bg-white/10 text-neutral-300">
              <CalendarPlus className="size-5" />
            </div>
            <h3 className="text-sm font-bold text-white">No Upcoming Appointments</h3>
            <p className="mt-0.5 text-xs text-neutral-400">
              Your health calendar is free. Tap below to schedule a checkup or session.
            </p>
            <button
              onClick={openAddModal}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-white text-[#12131A] px-3.5 py-1.5 text-xs font-semibold hover:bg-neutral-100 transition-colors"
            >
              <Plus className="size-3.5" /> Schedule Session
            </button>
          </div>
        )}
      </div>

      {/* Filter Tabs Row */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 mb-4 no-scrollbar">
        {(
          [
            { id: "Upcoming", label: `Upcoming (${stats.upcomingCount})` },
            { id: "Today", label: `Today (${stats.todayCount})` },
            { id: "Completed", label: `Completed (${stats.completedCount})` },
            { id: "All", label: `All (${stats.totalCount})` },
          ] as const
        ).map((tab) => {
          const isActive = activeFilter === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id as FilterTab)}
              className={`tap rounded-xl px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-all ${
                isActive
                  ? "bg-[#12131A] text-white shadow-2xs"
                  : "bg-white text-neutral-600 border border-neutral-200/80 hover:bg-neutral-50"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Main Appointment List */}
      <div className="space-y-4">
        {appLoading ? (
          <ListSkeleton count={3} />
        ) : filteredApps.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-200/80 p-8 text-center bg-white shadow-2xs">
            <div className="mx-auto mb-3 flex h-28 w-full max-w-[180px] items-center justify-center">
              <img
                src="/illustration/empty-appointments.png"
                alt="No Appointments"
                className="h-full w-full object-contain opacity-90"
              />
            </div>
            <p className="text-sm font-bold text-[#12131A]">No sessions in this view</p>
            <p className="text-xs text-neutral-500 mt-1 max-w-xs mx-auto">
              Schedule your doctor consultations, therapy sessions, and medical appointments here.
            </p>
            <button
              onClick={openAddModal}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#12131A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#12131A]/90 transition-colors"
            >
              <Plus className="size-3.5" /> Schedule First Session
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Today Section */}
            {todayApps.length > 0 && activeFilter !== "Completed" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    Today ({todayApps.length})
                  </h3>
                </div>
                {todayApps.map((app) => (
                  <AppointmentCard
                    key={app.id}
                    app={app}
                    onSelect={() => setSelectedPlan(app)}
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
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 px-1 pt-2">
                    Upcoming Sessions ({upcomingOtherApps.length})
                  </h3>
                )}
                {upcomingOtherApps.map((app) => (
                  <AppointmentCard
                    key={app.id}
                    app={app}
                    onSelect={() => setSelectedPlan(app)}
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
                    <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 px-1">
                      Completed ({completedApps.length})
                    </h3>
                  )}
                  {completedApps.map((app) => (
                    <AppointmentCard
                      key={app.id}
                      app={app}
                      onSelect={() => setSelectedPlan(app)}
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

      {/* Appointment Detail View Modal */}
      {selectedPlan && (
        <Modal open onClose={() => setSelectedPlan(null)} className="bg-white p-5 max-w-md">
          <div className="flex items-start justify-between border-b border-neutral-100 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase border ${
                    PRIORITY_CONFIG[selectedPlan.priority]?.badge ??
                    "bg-neutral-100 text-neutral-700"
                  }`}
                >
                  {PRIORITY_CONFIG[selectedPlan.priority]?.label}
                </span>
                {selectedPlan.status === "completed" && (
                  <span className="inline-block rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase">
                    Completed
                  </span>
                )}
              </div>
              <h2 className="mt-2 text-lg font-bold text-[#12131A]">{selectedPlan.title}</h2>
              <p className="text-xs text-neutral-500 font-medium mt-0.5 flex items-center gap-1">
                <Calendar className="size-3.5 text-neutral-400" />
                {getRelativeDateLabel(selectedPlan.appointment_date).label} at{" "}
                {selectedPlan.start_time || "10:00"}
              </p>
            </div>
            <button
              onClick={() => setSelectedPlan(null)}
              aria-label="Close details"
              className="size-7 flex items-center justify-center rounded-full bg-neutral-100 text-neutral-500 hover:bg-neutral-200 transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {/* Doctor Info */}
            {selectedPlan.doctor_name && (
              <div className="flex items-center gap-3 rounded-xl bg-neutral-50 p-3 border border-neutral-100">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-neutral-200/70 text-neutral-700">
                  <Stethoscope className="size-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                    Doctor / Specialist
                  </span>
                  <span className="text-xs font-bold text-[#12131A] truncate block">
                    {selectedPlan.doctor_name}
                  </span>
                </div>
              </div>
            )}

            {/* Location & Reminder Info */}
            <div className="grid grid-cols-2 gap-2">
              {selectedPlan.location && (
                <div className="rounded-xl bg-neutral-50 p-2.5 border border-neutral-100">
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-0.5">
                    <MapPin className="size-3 text-neutral-400" /> Location
                  </span>
                  <span className="text-xs font-semibold text-[#12131A] block truncate">
                    {selectedPlan.location}
                  </span>
                </div>
              )}

              <div className="rounded-xl bg-neutral-50 p-2.5 border border-neutral-100">
                <span className="flex items-center gap-1 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-0.5">
                  <Bell className="size-3 text-neutral-400" /> Reminder
                </span>
                <span className="text-xs font-semibold text-[#12131A] block">
                  {selectedPlan.reminder_offset_minutes
                    ? `${selectedPlan.reminder_offset_minutes}m before`
                    : "At time of event"}
                </span>
              </div>
            </div>

            {/* Notes */}
            {selectedPlan.notes && (
              <div className="rounded-xl bg-neutral-50 p-3 border border-neutral-100">
                <span className="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">
                  Notes
                </span>
                <p className="text-xs text-neutral-600 leading-relaxed font-normal">
                  {selectedPlan.notes}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="pt-2 space-y-2">
              <button
                onClick={() => handleToggleComplete(selectedPlan)}
                disabled={joiningId === selectedPlan.id}
                className={`tap w-full rounded-xl py-2.5 text-xs font-semibold text-white transition-colors flex items-center justify-center gap-1.5 ${
                  selectedPlan.status === "completed"
                    ? "bg-neutral-700 hover:bg-neutral-800"
                    : "bg-[#12131A] hover:bg-[#12131A]/90"
                }`}
              >
                {joiningId === selectedPlan.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : selectedPlan.status === "completed" ? (
                  <>
                    <Check className="size-3.5" /> Reopen Session
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-3.5" /> Mark Completed
                  </>
                )}
              </button>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const plan = selectedPlan;
                    setSelectedPlan(null);
                    openEditModal(plan);
                  }}
                  className="w-1/2 rounded-xl border border-neutral-200/80 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Pencil className="size-3.5 text-neutral-500" /> Edit
                </button>
                <button
                  onClick={() => handleDelete(selectedPlan.id)}
                  className="w-1/2 rounded-xl border border-rose-200/60 bg-rose-50/50 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-100/50 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Trash2 className="size-3.5 text-rose-500" /> Delete
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Add / Edit Form Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} className="bg-white max-w-md p-5">
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <h3 className="text-base font-bold text-[#12131A] tracking-tight">
            {editingApp ? "Edit Session" : "Schedule New Session"}
          </h3>
          <button
            onClick={() => setModalOpen(false)}
            aria-label="Close form"
            className="size-7 flex items-center justify-center rounded-full bg-neutral-100 text-neutral-500 hover:bg-neutral-200 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Quick Type Presets */}
        {!editingApp && (
          <div className="mt-3">
            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1.5">
              Quick Suggestions
            </span>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {QUICK_PRESETS.map((preset) => (
                <button
                  key={preset.title}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="tap rounded-lg bg-neutral-50 hover:bg-neutral-100 border border-neutral-200/80 px-2.5 py-1 text-[11px] font-medium text-neutral-700 whitespace-nowrap transition-colors flex items-center gap-1 shrink-0"
                >
                  <span>{preset.icon}</span>
                  <span>{preset.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-neutral-700 block mb-1">
              Session Title
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Dental Checkup / Cardiology Consult"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50/50 px-3 py-2 text-xs font-medium outline-none focus:border-neutral-900 focus:bg-white transition-all"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-neutral-700 block mb-1">
                Doctor / Specialist
              </label>
              <input
                type="text"
                required
                placeholder="Dr. Sarah Smith"
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 bg-neutral-50/50 px-3 py-2 text-xs font-medium outline-none focus:border-neutral-900 focus:bg-white transition-all"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-neutral-700 block mb-1">
                Location / Clinic
              </label>
              <input
                type="text"
                placeholder="City Hospital / Online"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 bg-neutral-50/50 px-3 py-2 text-xs font-medium outline-none focus:border-neutral-900 focus:bg-white transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-neutral-700 block mb-1">Date</label>
              <input
                type="date"
                required
                value={appointmentDate}
                onChange={(e) => setAppointmentDate(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 bg-neutral-50/50 px-3 py-2 text-xs font-medium outline-none focus:border-neutral-900 focus:bg-white transition-all"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-neutral-700 block mb-1">Time</label>
              <input
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 bg-neutral-50/50 px-3 py-2 text-xs font-medium outline-none focus:border-neutral-900 focus:bg-white transition-all"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-neutral-700 block mb-1">
              Priority Level
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["light", "medium", "high"] as const).map((p) => {
                const conf = PRIORITY_CONFIG[p];
                const selected = priority === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`tap py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                      selected
                        ? conf.pillActive
                        : "bg-neutral-50 text-neutral-600 border-neutral-200 hover:bg-neutral-100"
                    }`}
                  >
                    {conf.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-neutral-700 block mb-1">
              Reminder Lead Time
            </label>
            <select
              value={reminderOffsetMinutes}
              onChange={(e) => setReminderOffsetMinutes(Number(e.target.value))}
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50/50 px-3 py-2 text-xs font-medium outline-none focus:border-neutral-900 focus:bg-white transition-all"
            >
              <option value={0}>At appointment time</option>
              <option value={15}>15 minutes before</option>
              <option value={30}>30 minutes before</option>
              <option value={60}>1 hour before</option>
              <option value={1440}>1 day before</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-neutral-700 block mb-1">Notes</label>
            <textarea
              rows={2}
              placeholder="Questions for doctor, instructions..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50/50 px-3 py-2 text-xs font-medium outline-none focus:border-neutral-900 focus:bg-white transition-all resize-none"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="w-1/2 rounded-xl border border-neutral-200/80 py-2.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="w-1/2 flex items-center justify-center gap-1.5 rounded-xl bg-[#12131A] py-2.5 text-xs font-semibold text-white hover:bg-[#12131A]/90 transition-colors shadow-2xs"
            >
              {submitting && <Loader2 className="size-3.5 animate-spin" />}
              <span>Save Session</span>
            </button>
          </div>
        </form>
      </Modal>
    </Screen>
  );
}

/** Individual Appointment Card Component */
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
  const priorityConf = PRIORITY_CONFIG[app.priority] ?? PRIORITY_CONFIG.medium;
  const parsedDate = parseLocalDate(app.appointment_date);
  const relativeDate = getRelativeDateLabel(app.appointment_date);

  const monthStr = format(parsedDate, "MMM");
  const dayStr = format(parsedDate, "dd");
  const weekdayStr = format(parsedDate, "EEE");

  return (
    <div
      onClick={onSelect}
      className={`group relative rounded-xl bg-white p-3 border transition-all duration-150 hover:shadow-xs cursor-pointer flex items-center gap-3 ${
        isCompleted
          ? "border-neutral-200/60 bg-neutral-50/50 opacity-75"
          : relativeDate.isTodayDate
            ? "border-emerald-300 ring-1 ring-emerald-500/20"
            : "border-neutral-200/80 hover:border-neutral-300"
      }`}
    >
      {/* Date Box Badge */}
      <div
        className={`flex flex-col items-center justify-center rounded-lg px-2 py-1 min-w-[46px] shrink-0 font-sans border ${
          isCompleted ? "bg-neutral-100 text-neutral-500 border-neutral-200" : priorityConf.badge
        }`}
      >
        <span className="text-[9px] font-bold uppercase tracking-wider opacity-80">{monthStr}</span>
        <span className="text-sm font-black leading-none my-0.5">{dayStr}</span>
        <span className="text-[9px] font-semibold uppercase opacity-80">{weekdayStr}</span>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block rounded-md px-1.5 py-0.2 text-[9px] font-bold uppercase border ${
              isCompleted
                ? "bg-neutral-100 text-neutral-500 border-neutral-200"
                : priorityConf.badge
            }`}
          >
            {priorityConf.shortLabel}
          </span>

          {relativeDate.isTodayDate && !isCompleted && (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200/80 px-1.5 py-0.2 text-[9px] font-bold uppercase">
              <span className="size-1 rounded-full bg-emerald-500" /> Today
            </span>
          )}
        </div>

        <h3
          className={`text-xs font-bold text-[#12131A] tracking-tight truncate mt-0.5 ${
            isCompleted ? "line-through text-neutral-400 font-normal" : ""
          }`}
        >
          {app.title}
        </h3>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-neutral-500 font-medium">
          <span className="flex items-center gap-1">
            <Clock className="size-3 text-neutral-400" />
            <span>{app.start_time || "10:00"}</span>
          </span>

          {app.doctor_name && (
            <span className="flex items-center gap-1 truncate max-w-[130px]">
              <Stethoscope className="size-3 text-neutral-400" />
              <span className="truncate">{app.doctor_name}</span>
            </span>
          )}

          {app.location && (
            <span className="flex items-center gap-1 truncate max-w-[110px]">
              <MapPin className="size-3 text-neutral-400" />
              <span className="truncate">{app.location}</span>
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onToggleComplete}
          disabled={joiningId === app.id}
          title={isCompleted ? "Mark incomplete" : "Mark complete"}
          className={`tap flex size-7 items-center justify-center rounded-lg transition-all ${
            isCompleted
              ? "bg-emerald-600 text-white"
              : "bg-neutral-100 hover:bg-emerald-50 text-neutral-400 hover:text-emerald-600"
          }`}
        >
          {joiningId === app.id ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : isCompleted ? (
            <Check className="size-3.5" />
          ) : (
            <CheckCircle2 className="size-3.5" />
          )}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={`Options for ${app.title}`}
              className="size-7 flex items-center justify-center rounded-lg hover:bg-neutral-100 text-neutral-400 transition-colors"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40 rounded-xl p-1 shadow-md">
            <DropdownMenuItem onClick={onEdit} className="rounded-lg text-xs font-medium py-1.5">
              <Pencil className="size-3.5 mr-2 text-neutral-500" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onToggleComplete}
              className="rounded-lg text-xs font-medium py-1.5"
            >
              <CheckCircle2 className="size-3.5 mr-2 text-emerald-600" />
              {isCompleted ? "Mark Incomplete" : "Mark Completed"}
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuItem
              onClick={onDelete}
              className="rounded-lg text-xs font-medium py-1.5 text-rose-600 focus:text-rose-600"
            >
              <Trash2 className="size-3.5 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
