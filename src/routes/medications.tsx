import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Plus,
  Pill,
  CheckCircle2,
  Trash2,
  Edit2,
  X,
  Loader2,
  History,
  Droplets,
  Moon,
  ChevronDown,
  Minus,
} from "lucide-react";
import { toast } from "sonner";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { Modal } from "@/components/lifehub/Modal";
import { useAuth } from "@/hooks/use-auth";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useDeleteWithGuard } from "@/hooks/use-delete-with-guard";
import { useData } from "@/lib/data-context";
import { useHydration } from "@/lib/use-hydration";
import { Medication } from "@/lib/types";
import { Progress } from "@/components/ui/progress";
import { ListSkeleton } from "@/components/lifehub/SkeletonLoader";
import { sounds } from "@/lib/sound";

export const Route = createFileRoute("/medications")({
  head: () => ({
    meta: [{ title: "Health Routine & Hydration — LifeHub" }],
  }),
  component: MedicationsPage,
});

function MedicationsPage() {
  const { user, loading: authLoading } = useAuth();
  useAuthGuard(user, authLoading);

  const {
    medications,
    medicationLogs,
    medLoading,
    medError,
    addMedication,
    editMedication,
    removeMedication,
    toggleMedication,
    refreshMedications,
  } = useData();

  // Firestore-backed Daily Hydration Hook (auto resets every 24h)
  const {
    glasses: waterGlasses,
    goal: waterGoal,
    pct: waterPct,
    addWater: addWaterApi,
    removeWater: removeWaterApi,
    busy: waterBusy,
  } = useHydration(user?.id);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingMed, setEditingMed] = useState<Medication | null>(null);
  const [logsModalOpen, setLogsModalOpen] = useState(false);

  const [name, setName] = useState("");
  const [dosage, setDosage] = useState("");
  const [frequency, setFrequency] = useState("Daily");
  const [scheduledTime, setScheduledTime] = useState("08:00");
  const [priority, setPriority] = useState<"high" | "medium" | "light">("medium");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { deleteWithGuard } = useDeleteWithGuard();

  const openAddModal = () => {
    setEditingMed(null);
    setName("");
    setDosage("");
    setFrequency("Daily");
    setScheduledTime("08:00");
    setPriority("medium");
    setNotes("");
    setModalOpen(true);
  };

  const openEditModal = (med: Medication) => {
    setEditingMed(med);
    setName(med.name);
    setDosage(med.dosage);
    setFrequency(med.frequency);
    setScheduledTime(med.scheduled_time);
    setPriority(med.priority);
    setNotes(med.notes || "");
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);

    try {
      if (editingMed) {
        await editMedication(editingMed.id, {
          name,
          dosage,
          frequency,
          scheduled_time: scheduledTime,
          priority,
          notes,
        });
        toast.success("Routine updated!");
      } else {
        await addMedication({
          name,
          dosage,
          frequency,
          scheduled_time: scheduledTime,
          priority,
          notes,
        });
        toast.success("Health routine added!");
      }
      setModalOpen(false);
    } catch (err: any) {
      toast.error("Failed to save schedule.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (id: string, currentTaken: boolean) => {
    if (!user) return;
    try {
      await toggleMedication(id, currentTaken);
      toast.success(!currentTaken ? "Dose marked taken! 💊" : "Reset dose status");
    } catch (err) {
      toast.error("Could not update dose status");
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    await deleteWithGuard(id, async () => {
      await removeMedication(id);
      toast.success("Item deleted.", { id: `med-removed-${id}` });
    })().catch(() => {
      toast.error("Failed to delete.", { id: `med-delete-error-${id}` });
    });
  };

  const handleAddWater = async () => {
    sounds.playActionClick();
    await addWaterApi(1);
    toast.success("Added +1 Glass of water 💧");
  };

  const handleRemoveWater = async () => {
    if (waterGlasses > 0) {
      sounds.playActionClick();
      await removeWaterApi(1);
      toast.info("Removed 1 glass of water");
    }
  };

  const takenCount = medications.filter((m) => m.taken).length;
  const adherenceRate =
    medications.length > 0 ? Math.round((takenCount / medications.length) * 100) : 0;

  return (
    <Screen>
      <ScreenHeader
        title="Hydration & Health"
        showBack
        action={
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setLogsModalOpen(true)}
              className="tap flex size-9 items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs border border-black/5"
              title="Logs"
            >
              <History className="size-4" />
            </button>
            <button
              onClick={openAddModal}
              className="tap flex items-center gap-1 rounded-full bg-[#12131A] px-3.5 py-1.5 text-xs font-bold text-white shadow-md hover:bg-[#12131A]/90"
            >
              <Plus className="size-3.5" /> Add
            </button>
          </div>
        }
      />

      {/* Hydration Circular Progress Gauge */}
      <section className="card-soft bg-white p-6 border border-black/5 shadow-xs text-center">
        <div className="flex items-center justify-between text-xs text-[#6B7280] font-extrabold uppercase tracking-wide mb-2">
          <span>Daily Hydration Tracker</span>
          <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
            Auto-Resets Daily
          </span>
        </div>

        {/* Daily Progress — glasses vs goal (existing Progress component) */}
        <div className="mx-auto my-4 max-w-sm">
          <div className="flex items-baseline justify-center gap-2">
            <span className="text-3xl font-black text-[#12131A]">{waterGlasses}</span>
            <span className="text-[11px] font-bold text-[#6B7280]">of {waterGoal} glasses</span>
          </div>
          <Progress
            value={waterGoal > 0 ? Math.min(100, Math.round((waterGlasses / waterGoal) * 100)) : 0}
            className="mt-2.5 h-2"
          />
        </div>

        {/* Water Droplet Icons Row */}
        <div className="mt-2 flex justify-center gap-2">
          {Array.from({ length: waterGoal }, (_, i) => (
            <Droplets
              key={i}
              className={`size-4.5 transition-colors ${
                i < waterGlasses ? "text-[#7C5CFC] fill-[#7C5CFC]" : "text-black/15"
              }`}
            />
          ))}
        </div>

        {/* + / - Water Buttons */}
        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={handleRemoveWater}
            disabled={waterBusy || waterGlasses <= 0}
            className="tap rounded-full bg-black/5 p-3 text-xs font-bold text-[#12131A] hover:bg-black/10 disabled:opacity-30"
            title="Remove glass"
          >
            <Minus className="size-4" />
          </button>
          <button
            onClick={handleAddWater}
            disabled={waterBusy}
            className="tap flex-1 rounded-full bg-[#7C5CFC] py-3 text-xs font-extrabold text-white shadow-md hover:bg-[#6C4CFC] transition-transform active:scale-98 disabled:opacity-50"
          >
            + Add Water Glass
          </button>
        </div>
      </section>

      {/* Routine Medication List */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-lg font-extrabold text-[#12131A]">Medication & Daily Doses</h2>
        <span className="text-xs font-bold text-[#6B7280]">
          {medications.length > 0 ? `${adherenceRate}% Adherence` : "0 Tracked"}
        </span>
      </div>

      {/* Health Reminders Banner */}
      <section className="card-soft relative mt-3 overflow-hidden bg-[#FFD2E8]/30 border border-pink-100/60 p-4 shadow-xs flex items-center justify-between">
        <div className="max-w-[65%]">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-0.5 text-[10px] font-extrabold text-[#12131A]">
            💊 Health Schedule
          </span>
          <h2 className="mt-1.5 text-sm font-black text-[#12131A]">Reminders & Timed Doses</h2>
          <p className="mt-0.5 text-[11px] font-medium text-[#6B7280]">
            Never miss a dose or hydration milestone.
          </p>
        </div>
        <img
          src="/illustration/health-reminders.png"
          alt="Health Reminders"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
          className="h-20 w-24 object-contain shrink-0 drop-shadow-[0_6px_12px_rgba(255,105,180,0.25)]"
        />
      </section>

      <div className="mt-3 space-y-2">
        {medLoading ? (
          <ListSkeleton count={2} />
        ) : medications.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200/60 p-6 text-center bg-white">
            <div className="mx-auto mb-3 flex h-36 w-full max-w-[220px] items-center justify-center">
              <img
                src="/illustration/empty-medications.png"
                alt="No Medications"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
                className="h-full w-full object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.08)]"
              />
            </div>
            <p className="mt-2 text-sm font-bold text-[#12131A]">No medications added yet</p>
            <p className="text-xs text-[#6B7280]">Tap "+ Add" to schedule your daily doses.</p>
            <button
              onClick={openAddModal}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#12131A] px-4 py-2 text-xs font-bold text-white shadow-xs"
            >
              <Plus className="size-3.5" /> Add First Medication
            </button>
          </div>
        ) : (
          medications.map((med) => (
            <div
              key={med.id}
              className={`card-soft p-4 border transition-all flex items-center justify-between shadow-xs ${
                med.taken
                  ? "bg-[#C2F2D0]/40 border-[#C2F2D0] text-[#12131A]"
                  : "bg-white border-black/5 text-[#12131A]"
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-extrabold">
                    {med.scheduled_time}
                  </span>
                  <span className="text-xs text-[#6B7280] font-semibold">{med.frequency}</span>
                </div>
                <h3 className="mt-1 text-base font-extrabold">{med.name}</h3>
                <p className="text-xs font-medium text-[#6B7280]">{med.dosage}</p>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleToggle(med.id, med.taken)}
                  className={`tap flex size-10 items-center justify-center rounded-full transition-colors ${
                    med.taken
                      ? "bg-[#12131A] text-white shadow-sm"
                      : "bg-black/5 text-[#12131A] hover:bg-black/10"
                  }`}
                >
                  <CheckCircle2 className="size-5" />
                </button>
                <button
                  onClick={() => openEditModal(med)}
                  className="size-8 flex items-center justify-center rounded-full text-[#6B7280] hover:bg-black/5"
                >
                  <Edit2 className="size-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(med.id)}
                  className="size-8 flex items-center justify-center rounded-full text-rose-500 hover:bg-rose-50"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} className="bg-white">
        <div className="flex items-center justify-between border-b border-black/5 pb-3">
          <h3 className="text-base font-extrabold text-[#12131A]">
            {editingMed ? "Edit Medication" : "Add Medication Routine"}
          </h3>
          <button
            onClick={() => setModalOpen(false)}
            className="size-7 flex items-center justify-center rounded-full bg-black/5"
          >
            <X className="size-4" />
          </button>
        </div>
        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-bold text-[#12131A]">Medication Name</label>
            <input
              type="text"
              required
              placeholder="Vitamin D3 / Omeprazole"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs outline-none focus:border-[#7C5CFC]"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold text-[#12131A]">Dosage</label>
              <input
                type="text"
                required
                placeholder="1 Tablet / 10mg"
                value={dosage}
                onChange={(e) => setDosage(e.target.value)}
                className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs outline-none focus:border-[#7C5CFC]"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#12131A]">Time</label>
              <input
                type="time"
                required
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs outline-none focus:border-[#7C5CFC]"
              />
            </div>
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
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null} Save
            </button>
          </div>
        </form>
      </Modal>

      {/* Logs Modal */}
      <Modal open={logsModalOpen} onClose={() => setLogsModalOpen(false)} className="bg-white">
        <div className="flex items-center justify-between border-b border-black/5 pb-3">
          <h3 className="text-base font-extrabold text-[#12131A]">Health History Logs</h3>
          <button
            onClick={() => setLogsModalOpen(false)}
            className="size-7 flex items-center justify-center rounded-full bg-black/5"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-3 max-h-72 overflow-y-auto space-y-2">
          {medicationLogs.length === 0 ? (
            <p className="p-6 text-center text-xs text-[#6B7280]">No history logs recorded yet.</p>
          ) : (
            medicationLogs.map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between rounded-xl bg-[#F9F9FD] p-3 text-xs"
              >
                <span className="font-bold text-[#12131A]">Dose marked taken</span>
                <span className="text-[10px] text-[#6B7280]">
                  {new Date(l.taken_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))
          )}
        </div>
      </Modal>
    </Screen>
  );
}
