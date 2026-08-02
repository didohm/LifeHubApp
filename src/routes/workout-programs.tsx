import { useState, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, Target, Edit2, Trash2, X, Loader2, Calendar } from "lucide-react";
import { toast } from "sonner";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { useAuth } from "@/hooks/use-auth";
import { useData } from "@/lib/data-context";
import {
  createWorkoutProgram,
  updateWorkoutProgram,
  deleteWorkoutProgram,
  activateWorkoutProgram,
  DAY_KEY_ORDER,
  DAY_LABELS,
} from "@/lib/api";
import { WorkoutProgram, WorkoutType, DayKey, ProgramDayPlan } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { ListSkeleton } from "@/components/lifehub/SkeletonLoader";

export const Route = createFileRoute("/workout-programs")({
  head: () => ({
    meta: [{ title: "Workout Programs — Balance" }],
  }),
  component: WorkoutProgramsPage,
});

const WORKOUT_TYPES: WorkoutType[] = ["Gym", "Calisthenics", "Cardio"];

const DEFAULT_WEEKLY_PLAN: ProgramDayPlan[] = [
  { day: "mon", focus: "Push" },
  { day: "tue", focus: "Pull" },
  { day: "wed", focus: "Legs" },
  { day: "thu", focus: "Skills" },
  { day: "fri", focus: "Full Body" },
  { day: "sat", focus: "Cardio" },
  { day: "sun", focus: "Rest" },
];

/** Focus label shown for a day, honoring structured cardio data. */
function programDayFocus(program: WorkoutProgram, dayKey: DayKey): string {
  if (program.workout_type === "Cardio") {
    const structured = program.training_days;
    if (structured && structured.length > 0) {
      return structured.includes(dayKey) ? "Cardio" : "Rest";
    }
    const plan = (program.weekly_plan || []).find((p) => p.day === dayKey);
    return plan && plan.focus && plan.focus.toLowerCase() !== "rest" ? "Cardio" : "Rest";
  }
  const plan = (program.weekly_plan || []).find((p) => p.day === dayKey);
  return plan?.focus || "Rest";
}

function WorkoutProgramsPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const { workoutPrograms, fitnessLoading, refreshFitness } = useData();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProgram, setEditingProgram] = useState<WorkoutProgram | null>(null);

  const [name, setName] = useState("");
  const [workoutType, setWorkoutType] = useState<WorkoutType>("Calisthenics");
  const [weeklyPlan, setWeeklyPlan] = useState<ProgramDayPlan[]>(DEFAULT_WEEKLY_PLAN);
  const [cardioDays, setCardioDays] = useState<DayKey[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate({ to: "/auth" });
    }
  }, [user, authLoading, navigate]);

  const resetForm = () => {
    setName("");
    setWorkoutType("Calisthenics");
    setWeeklyPlan(DEFAULT_WEEKLY_PLAN);
    setCardioDays([]);
    setNotes("");
  };

  // Auto-activate the first program for users with legacy data (no active flag)
  useEffect(() => {
    if (!user || workoutPrograms.length === 0) return;
    if (!workoutPrograms.some((p) => p.is_active)) {
      activateWorkoutProgram(workoutPrograms[0].id, user.id)
        .then(() => refreshFitness())
        .catch(() => {});
    }
  }, [user, workoutPrograms, refreshFitness]);

  const openAddModal = () => {
    setEditingProgram(null);
    resetForm();
    setModalOpen(true);
  };

  const openEditModal = (p: WorkoutProgram) => {
    setEditingProgram(p);
    setName(p.name);
    setWorkoutType(p.workout_type || "Calisthenics");

    // Ensure all 7 days exist
    const planMap = new Map<DayKey, string>();
    (p.weekly_plan || []).forEach((item) => planMap.set(item.day, item.focus));
    const fullPlan: ProgramDayPlan[] = DAY_KEY_ORDER.map((dayKey) => ({
      day: dayKey,
      focus: planMap.get(dayKey) || "Rest",
    }));

    if (p.workout_type === "Cardio") {
      // Structured cardio schedule (with legacy text-plan fallback)
      const structured = p.training_days;
      setCardioDays(
        structured && structured.length > 0
          ? structured
          : DAY_KEY_ORDER.filter((dk) => (planMap.get(dk) || "Rest").toLowerCase() !== "rest"),
      );
    } else {
      setCardioDays([]);
      setWeeklyPlan(fullPlan);
    }

    setNotes(p.notes || "");
    setModalOpen(true);
  };

  const handleDayFocusChange = (dayKey: DayKey, focus: string) => {
    setWeeklyPlan((prev) => prev.map((item) => (item.day === dayKey ? { ...item, focus } : item)));
  };

  const handleWorkoutTypeChange = (nextType: WorkoutType) => {
    setWorkoutType(nextType);

    if (nextType === "Cardio") {
      // Convert the free-form labels into structured training days
      setCardioDays(
        DAY_KEY_ORDER.filter(
          (dk) => (weeklyPlan.find((x) => x.day === dk)?.focus || "Rest").toLowerCase() !== "rest",
        ),
      );
    } else {
      // Convert structured cardio days back into display labels
      setWeeklyPlan(
        DAY_KEY_ORDER.map((dk) => ({
          day: dk,
          focus: cardioDays.includes(dk) ? "Cardio" : "Rest",
        })),
      );
    }
  };

  const handleCardioDayToggle = (dayKey: DayKey, checked: boolean) => {
    setCardioDays((prev) =>
      checked
        ? prev.includes(dayKey)
          ? prev
          : [...prev, dayKey]
        : prev.filter((d) => d !== dayKey),
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);

    try {
      // Cardio programs persist structured training days; Gym/Calisthenics
      // persist the free-form weekly plan labels.
      const payload =
        workoutType === "Cardio"
          ? {
              name,
              workout_type: workoutType,
              training_days: cardioDays,
              weekly_plan: [] as ProgramDayPlan[],
              notes,
            }
          : {
              name,
              workout_type: workoutType,
              training_days: [] as DayKey[],
              weekly_plan: weeklyPlan,
              notes,
            };

      if (editingProgram) {
        await updateWorkoutProgram(editingProgram.id, user.id, payload);
        toast.success("Workout Program updated!");
      } else {
        await createWorkoutProgram(user.id, payload);
        toast.success("New Workout Program created! 🎯");
      }
      await refreshFitness();
      setModalOpen(false);
      resetForm();
    } catch {
      toast.error("Failed to save Workout Program.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    try {
      await deleteWorkoutProgram(id, user.id);
      await refreshFitness();
      toast.success("Program removed.");
    } catch {
      toast.error("Could not delete program.");
    }
  };

  const handleSetActive = async (id: string) => {
    if (!user) return;
    try {
      await activateWorkoutProgram(id, user.id);
      await refreshFitness();
      toast.success("Active program updated! 🎯");
    } catch {
      toast.error("Could not update active program.");
    }
  };

  return (
    <Screen>
      <ScreenHeader
        title="Workout Programs"
        subtitle="Manage your weekly split & training routines"
        showBack
        action={
          <button
            onClick={openAddModal}
            className="tap flex items-center gap-1 rounded-full bg-[#12131A] px-3.5 py-1.5 text-xs font-bold text-white shadow-md hover:bg-[#12131A]/90"
          >
            <Plus className="size-3.5" /> Create Program
          </button>
        }
      />

      {/* Programs List */}
      <div className="space-y-4">
        {fitnessLoading ? (
          <ListSkeleton count={2} />
        ) : workoutPrograms.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200/60 p-8 text-center bg-white">
            <div className="mx-auto mb-3 flex h-36 w-full max-w-[220px] items-center justify-center">
              <img
                src="/illustration/workout-programs.png"
                alt="Workout Programs"
                className="h-full w-full object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.08)]"
              />
            </div>
            <p className="mt-2 text-sm font-bold text-[#12131A]">No workout programs yet</p>
            <p className="text-xs text-[#6B7280] mt-1">
              Create a program like Gym Push/Pull/Legs, Calisthenics, or a Cardio split.
            </p>
            <button
              onClick={openAddModal}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#12131A] px-4 py-2 text-xs font-bold text-white shadow-xs"
            >
              <Plus className="size-3.5" /> Create First Program
            </button>
          </div>
        ) : (
          workoutPrograms.map((program) => (
            <div
              key={program.id}
              className="card-soft bg-white p-5 border border-black/5 shadow-xs space-y-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="rounded-full bg-[#7C5CFC]/10 px-2.5 py-0.5 text-[10px] font-extrabold text-[#7C5CFC] uppercase">
                      {program.workout_type || "Program"}
                    </span>
                    {program.is_active && (
                      <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-600">
                        Active
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1 text-lg font-black text-[#12131A]">{program.name}</h3>
                </div>
                <div className="flex items-center gap-1">
                  {!program.is_active && (
                    <button
                      onClick={() => handleSetActive(program.id)}
                      className="tap rounded-full border border-[#7C5CFC]/30 px-2.5 py-1 text-[10px] font-extrabold text-[#7C5CFC] hover:bg-[#7C5CFC]/10"
                    >
                      Set Active
                    </button>
                  )}
                  <button
                    onClick={() => openEditModal(program)}
                    className="size-8 flex items-center justify-center rounded-full text-[#6B7280] hover:bg-black/5"
                  >
                    <Edit2 className="size-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(program.id)}
                    className="size-8 flex items-center justify-center rounded-full text-rose-500 hover:bg-rose-50"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>

              {/* Weekly Plan Grid */}
              <div className="rounded-2xl bg-[#F9F9FD] p-3 border border-black/5">
                <span className="text-[10px] font-extrabold uppercase text-[#6B7280] tracking-wider block mb-2">
                  Weekly Split
                </span>
                <div className="grid grid-cols-7 gap-1 text-center">
                  {DAY_KEY_ORDER.map((dayKey) => {
                    const focusLabel = programDayFocus(program, dayKey);
                    const isRest = focusLabel.toLowerCase() === "rest";

                    return (
                      <div
                        key={dayKey}
                        className={`rounded-xl p-1.5 flex flex-col justify-between min-h-[52px] ${
                          isRest ? "bg-black/5 text-[#6B7280]" : "bg-slate-900 text-white shadow-sm"
                        }`}
                      >
                        <span className="text-[9px] font-extrabold uppercase">
                          {DAY_LABELS[dayKey].slice(0, 3)}
                        </span>
                        <span className="text-[10px] font-black truncate leading-tight mt-1">
                          {focusLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {program.notes && <p className="text-xs text-[#6B7280] italic">💡 {program.notes}</p>}
            </div>
          ))
        )}
      </div>

      {/* Add/Edit Program Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-black/5 pb-3">
              <h3 className="text-base font-extrabold text-[#12131A]">
                {editingProgram ? "Edit Program" : "Create Workout Program"}
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
                <label className="text-xs font-bold text-[#12131A]">Program Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Calisthenics Master / PPL Split"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs outline-none focus:border-[#7C5CFC]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#12131A]">Primary Workout Type</label>
                <select
                  value={workoutType}
                  onChange={(e) => handleWorkoutTypeChange(e.target.value as WorkoutType)}
                  className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs outline-none focus:border-[#7C5CFC]"
                >
                  {WORKOUT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {/* Weekly Split Inputs */}
              {workoutType === "Cardio" ? (
                <div>
                  <label className="text-xs font-bold text-[#12131A] block mb-0.5">
                    Cardio Training Days
                  </label>
                  <p className="text-[11px] text-[#6B7280] font-medium mb-2">
                    Check the days you do cardio. Unchecked days are rest days.
                  </p>
                  <div className="space-y-1.5">
                    {DAY_KEY_ORDER.map((dayKey) => {
                      const checked = cardioDays.includes(dayKey);
                      return (
                        <label
                          key={dayKey}
                          className={`flex items-center justify-between rounded-xl border p-2.5 cursor-pointer transition-colors ${
                            checked
                              ? "border-[#7C5CFC]/30 bg-[#7C5CFC]/5"
                              : "border-black/10 bg-[#F9F9FD]"
                          }`}
                        >
                          <span className="text-xs font-bold text-[#12131A]">
                            {DAY_LABELS[dayKey]}
                          </span>
                          <span className="flex items-center gap-2">
                            {checked ? (
                              <span className="rounded-full bg-[#7C5CFC]/10 px-2 py-0.5 text-[10px] font-extrabold text-[#7C5CFC]">
                                Cardio
                              </span>
                            ) : (
                              <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-extrabold text-[#6B7280]">
                                Rest
                              </span>
                            )}
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => handleCardioDayToggle(dayKey, !!v)}
                              className="size-4 rounded-[6px] border-black/20 data-[state=checked]:border-[#7C5CFC] data-[state=checked]:bg-[#7C5CFC] data-[state=checked]:text-white"
                            />
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-xs font-bold text-[#12131A] block mb-1">
                    Weekly Schedule (7 Days)
                  </label>
                  <div className="space-y-1.5">
                    {DAY_KEY_ORDER.map((dayKey) => {
                      const currentItem = weeklyPlan.find((p) => p.day === dayKey);
                      return (
                        <div key={dayKey} className="flex items-center gap-2">
                          <span className="w-20 text-xs font-bold text-[#6B7280]">
                            {DAY_LABELS[dayKey]}
                          </span>
                          <input
                            type="text"
                            required
                            placeholder="e.g. Push / Rest"
                            value={currentItem?.focus || ""}
                            onChange={(e) => handleDayFocusChange(dayKey, e.target.value)}
                            className="flex-1 rounded-xl border border-black/10 bg-[#F9F9FD] p-2 text-xs outline-none focus:border-[#7C5CFC]"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-[#12131A]">Program Notes (optional)</label>
                <textarea
                  rows={2}
                  placeholder="Program goals, progression guidelines..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs outline-none focus:border-[#7C5CFC] resize-none"
                />
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
                  className="w-1/2 flex items-center justify-center gap-1 rounded-xl bg-[#12131A] py-2.5 text-xs font-bold text-white shadow-md disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null} Save Program
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Screen>
  );
}
