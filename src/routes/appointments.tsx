import { useState, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Plus,
  Clock,
  MapPin,
  Trash2,
  Edit2,
  X,
  Loader2,
  CalendarHeart,
  Check,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { useAuth } from "@/hooks/use-auth";
import { useData } from "@/lib/data-context";
import { createAppointment, updateAppointment, deleteAppointment } from "@/lib/api";
import { Appointment } from "@/lib/types";
import { ListSkeleton } from "@/components/lifehub/SkeletonLoader";

export const Route = createFileRoute("/appointments")({
  head: () => ({
    meta: [{ title: "Appointments — Balance" }],
  }),
  component: AppointmentsPage,
});

function AppointmentsPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const { appointments, appLoading, refreshAppointments } = useData();

  const [activeTab, setActiveTab] = useState<"Upcoming" | "Completed">("Upcoming");
  const [selectedPlan, setSelectedPlan] = useState<Appointment | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<Appointment | null>(null);

  const [title, setTitle] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [location, setLocation] = useState("");
  const [appointmentDate, setAppointmentDate] = useState(new Date().toISOString().split("T")[0]);
  const [startTime, setStartTime] = useState("10:00");
  const [priority, setPriority] = useState<"high" | "medium" | "light">("medium");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate({ to: "/auth" });
    }
  }, [user, authLoading, navigate]);

  const resetForm = () => {
    setTitle("");
    setDoctorName("");
    setLocation("");
    setAppointmentDate(new Date().toISOString().split("T")[0]);
    setStartTime("10:00");
    setPriority("medium");
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
    setNotes(app.notes || "");
    setModalOpen(true);
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
          notes,
        });
        toast.success("Appointment updated!");
      } else {
        await createAppointment(user.id, {
          title,
          doctor_name: doctorName,
          location,
          appointment_date: appointmentDate,
          start_time: startTime,
          priority,
          reminder: true,
          notes,
        });
        toast.success("New appointment scheduled!");
      }
      await refreshAppointments();
      setModalOpen(false);
      resetForm();
    } catch {
      toast.error("Could not save appointment.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    try {
      await deleteAppointment(id, user.id);
      await refreshAppointments();
      toast.success("Removed appointment.");
    } catch (err) {
      toast.error("Failed to remove appointment.");
    }
  };

  // Mark the appointment as completed and refresh shared state so the item
  // moves to the Completed tab and analytics update immediately.
  const handleJoinSession = async (app: Appointment) => {
    if (!user || app.status === "completed" || joining) return;
    setJoining(true);
    try {
      await updateAppointment(app.id, user.id, { status: "completed" });
      await refreshAppointments();
      toast.success(`Session "${app.title}" completed — nice work! 🎉`);
      setSelectedPlan(null);
    } catch {
      toast.error("Could not mark session as completed.");
    } finally {
      setJoining(false);
    }
  };

  const filteredApps = appointments.filter((app) => {
    if (activeTab === "Upcoming") return app.status !== "completed";
    return app.status === "completed";
  });

  return (
    <Screen>
      <ScreenHeader
        title="Appointments"
        subtitle="Medical consultations & scheduled events"
        showBack
        action={
          <button
            onClick={openAddModal}
            className="tap flex items-center gap-1 rounded-full bg-[#12131A] px-3.5 py-1.5 text-xs font-bold text-white shadow-md hover:bg-[#12131A]/90"
          >
            <Plus className="size-3.5" /> Add Appointment
          </button>
        }
      />

      {/* Segmented Control Filter Bar */}
      <div className="mt-2 flex rounded-full bg-[#E8E2FF]/50 p-1">
        <button
          onClick={() => setActiveTab("Upcoming")}
          className={`w-1/2 py-2 text-xs font-extrabold rounded-full transition-all ${
            activeTab === "Upcoming" ? "bg-slate-900 text-white shadow-sm" : "text-[#6B7280]"
          }`}
        >
          Upcoming ({appointments.filter((a) => a.status !== "completed").length})
        </button>
        <button
          onClick={() => setActiveTab("Completed")}
          className={`w-1/2 py-2 text-xs font-extrabold rounded-full transition-all ${
            activeTab === "Completed" ? "bg-slate-900 text-white shadow-sm" : "text-[#6B7280]"
          }`}
        >
          Completed ({appointments.filter((a) => a.status === "completed").length})
        </button>
      </div>

      {/* Real Plan List from Database */}
      <div className="mt-4 space-y-3">
        {appLoading ? (
          <ListSkeleton count={3} />
        ) : filteredApps.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200/60 p-6 text-center bg-white">
            <div className="mx-auto mb-3 flex h-36 w-full max-w-[220px] items-center justify-center">
              <img
                src="/illustration/empty-appointments.png"
                alt="No Appointments"
                className="h-full w-full object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.08)]"
              />
            </div>
            <p className="mt-2 text-sm font-bold text-[#12131A]">No sessions in your plan</p>
            <p className="text-xs text-[#6B7280] mt-1">
              Tap "+ Add Appointment" to schedule consultations & sessions.
            </p>
            <button
              onClick={openAddModal}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#12131A] px-4 py-2 text-xs font-bold text-white shadow-xs"
            >
              <Plus className="size-3.5" /> Add First Session
            </button>
          </div>
        ) : (
          filteredApps.map((app, idx) => {
            const bgColors = [
              "bg-[#FFC593]",
              "bg-[#BEE3FF]",
              "bg-[#E8E2FF]",
              "bg-[#FFD2E8]",
              "bg-[#C2F2D0]",
            ];
            const bgClass = bgColors[idx % bgColors.length];

            return (
              <div
                key={app.id}
                onClick={() => setSelectedPlan(app)}
                className={`card-soft ${bgClass} p-4 text-[#12131A] tap flex items-center justify-between cursor-pointer shadow-xs hover:shadow-md transition-all`}
              >
                <div>
                  <span className="rounded-full bg-white/70 px-2.5 py-0.5 text-[10px] font-extrabold uppercase">
                    {app.priority} Priority
                  </span>
                  <h3 className="mt-2 text-lg font-black">{app.title}</h3>
                  <p className="text-xs font-medium text-[#12131A]/80 mt-0.5">
                    {app.appointment_date} at {app.start_time || "10:00"}{" "}
                    {app.location ? `· ${app.location}` : ""}
                  </p>
                  {app.doctor_name && (
                    <p className="text-[11px] font-bold text-[#12131A]/90 mt-2 flex items-center gap-1.5 border-t border-black/10 pt-2">
                      <span className="flex size-4 items-center justify-center rounded-full bg-white/70 text-[#12131A]">
                        <User className="size-2.5" />
                      </span>{" "}
                      {app.doctor_name}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => openEditModal(app)}
                    aria-label={`Edit appointment ${app.title}`}
                    className="size-7 flex items-center justify-center rounded-full bg-white/80 text-[#12131A] hover:bg-white"
                  >
                    <Edit2 className="size-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(app.id)}
                    aria-label={`Delete appointment ${app.title}`}
                    className="size-7 flex items-center justify-center rounded-full bg-white/80 text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Workout / Session Details Modal for Real Selected Item */}
      {selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="rounded-2xl bg-[#FFC593] p-5 text-[#12131A] relative">
              <button
                onClick={() => setSelectedPlan(null)}
                aria-label="Close appointment details"
                className="absolute top-3 right-3 size-7 flex items-center justify-center rounded-full bg-white/70 text-[#12131A]"
              >
                <X className="size-4" />
              </button>
              <span className="rounded-full bg-white/80 px-3 py-0.5 text-[11px] font-extrabold uppercase">
                {selectedPlan.priority} Priority
              </span>
              <h2 className="mt-3 text-2xl font-black">{selectedPlan.title}</h2>
              <p className="text-xs font-semibold text-[#12131A]/80 mt-1">Real Scheduled Session</p>
            </div>

            <div className="mt-4 space-y-2.5 text-xs text-[#12131A]">
              <div className="flex items-center gap-2.5 font-bold">
                <Clock className="size-4 text-[#7C5CFC]" />
                <span>
                  {selectedPlan.appointment_date} · {selectedPlan.start_time || "10:00"}
                </span>
              </div>
              {selectedPlan.location && (
                <div className="flex items-center gap-2.5 font-bold">
                  <MapPin className="size-4 text-[#7C5CFC]" />
                  <span>{selectedPlan.location}</span>
                </div>
              )}
              {selectedPlan.doctor_name && (
                <div className="flex items-center gap-2.5 border-t border-black/5 pt-3">
                  <span className="flex size-8 items-center justify-center rounded-full bg-[#E8E2FF] text-[#7C5CFC]">
                    <User className="size-4" />
                  </span>
                  <div>
                    <span className="block text-[10px] text-[#6B7280] font-bold">
                      Trainer / Host
                    </span>
                    <span className="font-extrabold">{selectedPlan.doctor_name}</span>
                  </div>
                </div>
              )}
            </div>

            {selectedPlan.notes && (
              <div className="mt-4 border-t border-black/5 pt-3">
                <h4 className="text-xs font-extrabold text-[#12131A]">Notes</h4>
                <p className="mt-1 text-xs text-[#6B7280] leading-relaxed">{selectedPlan.notes}</p>
              </div>
            )}

            <button
              onClick={() => handleJoinSession(selectedPlan)}
              disabled={joining || selectedPlan.status === "completed"}
              className={`tap mt-5 w-full rounded-full py-3 text-xs font-extrabold text-white shadow-md transition-all ${
                selectedPlan.status === "completed"
                  ? "bg-[#34D399] cursor-default"
                  : "bg-[#7C5CFC] hover:bg-[#6C4CFC]"
              } ${joining ? "opacity-70" : ""}`}
            >
              {joining ? (
                <span className="inline-flex items-center justify-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" /> Completing…
                </span>
              ) : selectedPlan.status === "completed" ? (
                <span className="inline-flex items-center justify-center gap-1.5">
                  <Check className="size-3.5" /> Session Completed
                </span>
              ) : (
                "Join Session"
              )}
            </button>
          </div>
        </div>
      )}

      {/* Add / Edit Form Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-black/5 pb-3">
              <h3 className="text-base font-extrabold text-[#12131A]">
                {editingApp ? "Edit Session" : "Schedule New Session"}
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                aria-label="Close appointment form"
                className="size-7 flex items-center justify-center rounded-full bg-black/5"
              >
                <X className="size-4" />
              </button>
            </div>
            <form onSubmit={handleSave} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-bold text-[#12131A]">Session Title</label>
                <input
                  type="text"
                  required
                  placeholder="Yoga Group / Consultation"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs outline-none focus:border-[#7C5CFC]"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold text-[#12131A]">Doctor / Specialist</label>
                  <input
                    type="text"
                    required
                    placeholder="Dr. Sarah Smith"
                    value={doctorName}
                    onChange={(e) => setDoctorName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs outline-none focus:border-[#7C5CFC]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[#12131A]">Location / Clinic</label>
                  <input
                    type="text"
                    placeholder="City Health Center / Online"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs outline-none focus:border-[#7C5CFC]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold text-[#12131A]">Date</label>
                  <input
                    type="date"
                    required
                    value={appointmentDate}
                    onChange={(e) => setAppointmentDate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs outline-none focus:border-[#7C5CFC]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[#12131A]">Time</label>
                  <input
                    type="time"
                    required
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs outline-none focus:border-[#7C5CFC]"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-[#12131A]">Priority / Intensity</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs outline-none focus:border-[#7C5CFC]"
                >
                  <option value="light">Light</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="w-1/2 rounded-xl border border-black/10 py-2.5 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-1/2 flex items-center justify-center gap-1 rounded-xl bg-[#12131A] py-2.5 text-xs font-bold text-white"
                >
                  {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null} Save Session
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Screen>
  );
}
