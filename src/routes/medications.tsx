import { useState, useCallback } from "react";
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
  Minus,
  Clock,
  Flame,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { Modal } from "@/components/lifehub/Modal";
import { useAuth } from "@/hooks/use-auth";
import { useDeleteWithGuard } from "@/hooks/use-delete-with-guard";
import { useData } from "@/lib/data-context";
import { useHydration } from "@/lib/use-hydration";
import { Medication } from "@/lib/types";
import { ListSkeleton } from "@/components/lifehub/SkeletonLoader";
import { sounds } from "@/lib/sound";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/medications")({
  head: () => ({
    meta: [{ title: "Health Routine & Hydration — LifeHub" }],
  }),
  component: MedicationsPage,
});

function MedicationsPage() {
  const { user } = useAuth();

  const {
    medications = [],
    medicationLogs = [],
    medLoading,
    addMedication,
    editMedication,
    removeMedication,
    toggleMedication,
  } = useData();

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
    sounds.playActionClick();
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
    sounds.playActionClick();
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
        toast.success("Schedule updated!");
      } else {
        await addMedication({
          name,
          dosage,
          frequency,
          scheduled_time: scheduledTime,
          priority,
          notes,
        });
        toast.success("Medication added!");
      }
      setModalOpen(false);
    } catch {
      toast.error("Failed to save schedule.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (id: string, currentTaken: boolean) => {
    if (!user) return;
    try {
      if (!currentTaken) {
        sounds.playSuccess();
      } else {
        sounds.playClick();
      }
      await toggleMedication(id, currentTaken);
      toast.success(!currentTaken ? "Dose marked as taken! 💊" : "Dose status reset");
    } catch {
      toast.error("Could not update dose status");
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    await deleteWithGuard(id, async () => {
      await removeMedication(id);
      toast.success("Item removed.");
    })().catch(() => {
      toast.error("Failed to delete.");
    });
  };

  const handleAddWater = async () => {
    try {
      sounds.playWater();
      await addWaterApi(1);
      toast.success("Logged +1 Glass of Water 💧");
    } catch {
      toast.error("Failed to log water glass");
    }
  };

  const handleRemoveWater = async () => {
    if (waterGlasses > 0) {
      try {
        sounds.playClick();
        await removeWaterApi(1);
        toast.info("Removed 1 glass of water");
      } catch {
        toast.error("Failed to remove water glass");
      }
    }
  };

  const takenCount = medications.filter((m) => m.taken).length;
  const adherenceRate =
    medications.length > 0 ? Math.round((takenCount / medications.length) * 100) : 0;

  return (
    <Screen>
      <ScreenHeader
        title="Hydration & Meds"
        subtitle="Daily doses, schedules & water intake"
        showBack
        action={
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                sounds.playActionClick();
                setLogsModalOpen(true);
              }}
              className="tap flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs border border-border/60 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC]"
              aria-label="Dose logs"
              title="Dose logs"
            >
              <History className="size-4" />
            </button>
            <button
              onClick={openAddModal}
              className="tap flex items-center gap-1 rounded-full bg-[#12131A] px-4 py-2.5 min-h-[44px] text-xs font-bold text-white shadow-xs hover:bg-[#12131A]/90 transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#12131A]"
            >
              <Plus className="size-3.5" /> Add Med
            </button>
          </div>
        }
      />

      {/* ════════════════════════════════════════════════════════════
          HYDRATION HERO TRACKER
          ════════════════════════════════════════════════════════════ */}
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="card-soft mt-1 bg-gradient-to-br from-[#E0F2FE] via-[#F0F9FF] to-[#FAF8FF] p-5 border border-sky-200/60 shadow-xs text-center relative overflow-hidden"
      >
        <div className="flex items-center justify-between text-xs font-black uppercase tracking-wider text-sky-950/80 mb-2">
          <span className="flex items-center gap-1">
            <Droplets className="size-4 text-sky-600" /> Daily Hydration
          </span>
          <span className="text-[11px] text-sky-700 font-bold bg-white/90 px-2.5 py-0.5 rounded-full shadow-2xs">
            Goal: {waterGoal} glasses
          </span>
        </div>

        {/* Circular SVG Gauge */}
        <div className="relative mx-auto my-3 size-36 flex items-center justify-center">
          <svg className="size-full -rotate-90" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="40"
              className="stroke-sky-200/50"
              strokeWidth="9"
              fill="transparent"
            />
            <circle
              cx="50"
              cy="50"
              r="40"
              className="stroke-sky-500 transition-all duration-700 ease-out"
              strokeWidth="9"
              strokeDasharray={2 * Math.PI * 40}
              strokeDashoffset={2 * Math.PI * 40 * (1 - Math.min(1, waterPct / 100))}
              strokeLinecap="round"
              fill="transparent"
            />
          </svg>
          <div className="absolute flex flex-col items-center justify-center">
            <span className="text-3xl font-black text-[#12131A] tracking-tight">
              {waterGlasses}
            </span>
            <span className="text-[11px] font-bold text-sky-900/80">/ {waterGoal} glasses</span>
            <span className="text-[11px] font-extrabold text-sky-600">{waterPct}%</span>
          </div>
        </div>

        {/* Tactile + / - Buttons */}
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={handleRemoveWater}
            disabled={waterBusy || waterGlasses <= 0}
            className="tap rounded-2xl bg-white p-3 min-h-[44px] min-w-[44px] flex items-center justify-center text-[#12131A] shadow-2xs border border-sky-200/60 hover:bg-sky-50 disabled:opacity-30 transition-transform active:scale-95"
            title="Remove glass"
          >
            <Minus className="size-4" />
          </button>
          <button
            onClick={handleAddWater}
            disabled={waterBusy}
            className="tap flex-1 flex items-center justify-center gap-2 rounded-2xl bg-sky-500 py-3 text-xs font-black text-white shadow-md hover:bg-sky-600 transition-transform active:scale-98 disabled:opacity-50"
          >
            <Droplets className="size-4" /> +1 Glass of Water (250ml)
          </button>
        </div>
      </motion.section>

      {/* ════════════════════════════════════════════════════════════
          MEDICATIONS & DAILY DOSES
          ════════════════════════════════════════════════════════════ */}
      <div className="mt-6 flex items-center justify-between px-1">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          Scheduled Doses ({medications.length})
        </h2>
        <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
          {medications.length > 0 ? `${adherenceRate}% taken today` : "No meds"}
        </span>
      </div>

      <div className="mt-2.5 space-y-2.5">
        {medLoading ? (
          <ListSkeleton count={3} />
        ) : medications.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border p-8 text-center bg-white shadow-2xs">
            <Pill className="mx-auto size-10 text-pink-400/50" />
            <p className="mt-2 text-sm font-extrabold text-[#12131A]">No medications scheduled</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add your vitamins, prescriptions, or daily supplements.
            </p>
            <button
              onClick={openAddModal}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#12131A] px-4 py-2 text-xs font-extrabold text-white shadow-xs"
            >
              <Plus className="size-3.5" /> Add First Medication
            </button>
          </div>
        ) : (
          medications.map((med) => (
            <motion.div
              key={med.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "card-soft p-4 border transition-all flex items-center justify-between shadow-2xs",
                med.taken
                  ? "bg-emerald-50/50 border-emerald-200/80 text-[#12131A]"
                  : "bg-white border-border/70 text-[#12131A]",
              )}
            >
              <div className="min-w-0 flex-1 pr-3">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-700 flex items-center gap-1">
                    <Clock className="size-3" /> {med.scheduled_time}
                  </span>
                  <span className="text-[11px] text-muted-foreground font-semibold">
                    {med.frequency}
                  </span>
                  {med.priority === "high" && (
                    <span className="rounded-full bg-rose-50 px-2 py-0.2 text-[11px] font-black text-rose-600">
                      High Priority
                    </span>
                  )}
                </div>

                <h3
                  className={cn(
                    "mt-1.5 text-sm sm:text-base font-extrabold truncate",
                    med.taken && "line-through opacity-70",
                  )}
                >
                  {med.name}
                </h3>
                <p className="text-xs font-medium text-muted-foreground truncate">{med.dosage}</p>
                {med.notes && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground/80 italic truncate">
                    {med.notes}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => handleToggle(med.id, med.taken)}
                  className={cn(
                    "tap flex size-10 items-center justify-center rounded-2xl transition-all shadow-2xs",
                    med.taken
                      ? "bg-emerald-600 text-white shadow-emerald-200"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                  )}
                  title={med.taken ? "Mark not taken" : "Mark as taken"}
                >
                  {med.taken ? (
                    <Check className="size-5 stroke-[3]" />
                  ) : (
                    <CheckCircle2 className="size-5" />
                  )}
                </button>
                <button
                  onClick={() => openEditModal(med)}
                  className="tap flex size-10 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-muted-foreground hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                  title="Edit"
                >
                  <Edit2 className="size-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(med.id)}
                  className="tap flex size-10 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-rose-500 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                  title="Delete"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════
          ADD / EDIT MEDICATION MODAL
          ════════════════════════════════════════════════════════════ */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        className="p-5 max-w-md bg-white rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <h3 className="text-base font-extrabold text-foreground">
            {editingMed ? "Edit Medication" : "Add Medication Schedule"}
          </h3>
          <button
            onClick={() => setModalOpen(false)}
            className="tap flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-muted-foreground hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-bold text-foreground">
              Medication / Supplement Name
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Vitamin D3, Omega-3, Metformin"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-slate-50 p-3 text-[16px] sm:text-sm font-semibold text-foreground outline-none focus:border-[#7C5CFC] focus:bg-white min-h-[44px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold text-foreground">Dosage</label>
              <input
                type="text"
                required
                placeholder="1 Tablet / 10mg"
                value={dosage}
                onChange={(e) => setDosage(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-slate-50 p-3 text-[16px] sm:text-sm font-semibold text-foreground outline-none focus:border-[#7C5CFC] focus:bg-white min-h-[44px]"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-foreground">Time</label>
              <input
                type="time"
                required
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-slate-50 p-3 text-[16px] sm:text-sm font-semibold text-foreground outline-none focus:border-[#7C5CFC] focus:bg-white min-h-[44px]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold text-foreground">Frequency</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-slate-50 p-3 text-[16px] sm:text-sm font-semibold text-foreground outline-none min-h-[44px]"
              >
                <option value="Daily">Daily</option>
                <option value="Twice daily">Twice daily</option>
                <option value="Weekly">Weekly</option>
                <option value="As needed">As needed</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-foreground">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as "high" | "medium" | "light")}
                className="mt-1 w-full rounded-xl border border-border bg-slate-50 p-3 text-[16px] sm:text-sm font-semibold text-foreground outline-none min-h-[44px]"
              >
                <option value="high">High Priority</option>
                <option value="medium">Regular</option>
                <option value="light">Light</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-foreground">
              Special Instructions (optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Take with breakfast / after meal"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-slate-50 p-3 text-[16px] sm:text-sm font-semibold text-foreground outline-none focus:border-[#7C5CFC] focus:bg-white min-h-[44px]"
            />
          </div>

          <div className="flex gap-2 pt-3">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="w-1/2 rounded-xl border border-border py-2.5 text-xs font-bold text-foreground hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="w-1/2 flex items-center justify-center gap-1.5 rounded-xl bg-[#12131A] py-2.5 text-xs font-bold text-white shadow-xs hover:bg-[#12131A]/90 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null} Save Medication
            </button>
          </div>
        </form>
      </Modal>

      {/* ════════════════════════════════════════════════════════════
          LOGS HISTORY MODAL
          ════════════════════════════════════════════════════════════ */}
      <Modal
        open={logsModalOpen}
        onClose={() => setLogsModalOpen(false)}
        className="p-5 max-w-md bg-white rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <h3 className="text-base font-extrabold text-foreground flex items-center gap-1.5">
            <History className="size-4 text-[#7C5CFC]" /> Dose Logging History
          </h3>
          <button
            onClick={() => setLogsModalOpen(false)}
            className="tap flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-muted-foreground hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-3 max-h-72 overflow-y-auto space-y-2">
          {medicationLogs.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">
              No history logs recorded yet. Doses will appear here when marked taken.
            </p>
          ) : (
            medicationLogs.map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-xs border border-border/60"
              >
                <span className="font-bold text-foreground">Dose marked taken</span>
                <span className="text-[11px] text-muted-foreground font-semibold">
                  {l.taken_at
                    ? new Date(l.taken_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Logged"}
                </span>
              </div>
            ))
          )}
        </div>
      </Modal>
    </Screen>
  );
}
