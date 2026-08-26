import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Plus,
  Target,
  Edit2,
  Trash2,
  X,
  Loader2,
  Calendar,
  Dumbbell,
  Zap,
  Sparkles,
  Flame,
  Check,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { Modal } from "@/components/lifehub/Modal";
import { WeeklySplitGrid, todayDayKey } from "@/components/lifehub/WeeklySplitGrid";
import { useAuth } from "@/hooks/use-auth";
import { useDeleteWithGuard } from "@/hooks/use-delete-with-guard";
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
import { focusForDay } from "@/lib/workout-utils";
import { sounds } from "@/lib/sound";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/workout-programs")({
  head: () => ({
    meta: [
      { title: "Workout Programs & Splits — LifeHub" },
      {
        name: "description",
        content:
          "Customizable workout splits, calisthenics routines, and cardio schedules with smart templates.",
      },
    ],
  }),
  component: WorkoutProgramsPage,
});

const WORKOUT_TYPES: WorkoutType[] = ["Gym", "Calisthenics", "Cardio"];

const DEFAULT_WEEKLY_PLAN: ProgramDayPlan[] = [
  { day: "mon", focus: "Push (Chest & Triceps)" },
  { day: "tue", focus: "Pull (Back & Biceps)" },
  { day: "wed", focus: "Legs & Core" },
  { day: "thu", focus: "Push & Shoulders" },
  { day: "fri", focus: "Pull & Lats" },
  { day: "sat", focus: "Cardio & Full Body" },
  { day: "sun", focus: "Rest" },
];

interface ProgramPreset {
  id: string;
  name: string;
  workoutType: WorkoutType;
  badge: string;
  description: string;
  plan: ProgramDayPlan[];
  cardioDays?: DayKey[];
}

const PROGRAM_PRESETS: ProgramPreset[] = [
  {
    id: "ppl-6day",
    name: "Push / Pull / Legs Split",
    workoutType: "Gym",
    badge: "6-Day Pro Split",
    description:
      "High-frequency split targeting push, pull, and leg muscle groups with balanced rest.",
    plan: [
      { day: "mon", focus: "Push (Chest/Shoulders/Tris)" },
      { day: "tue", focus: "Pull (Back/Lats/Biceps)" },
      { day: "wed", focus: "Legs & Abs" },
      { day: "thu", focus: "Push (Hypertrophy)" },
      { day: "fri", focus: "Pull (Volume focus)" },
      { day: "sat", focus: "Legs & Calves" },
      { day: "sun", focus: "Rest" },
    ],
  },
  {
    id: "upper-lower-4day",
    name: "Upper / Lower Split",
    workoutType: "Gym",
    badge: "4-Day Strength",
    description: "Balances heavy compound power and recovery, optimal for strength & physique.",
    plan: [
      { day: "mon", focus: "Upper Body Strength" },
      { day: "tue", focus: "Lower Body Strength" },
      { day: "wed", focus: "Rest" },
      { day: "thu", focus: "Upper Body Hypertrophy" },
      { day: "fri", focus: "Lower Body Hypertrophy" },
      { day: "sat", focus: "Rest" },
      { day: "sun", focus: "Rest" },
    ],
  },
  {
    id: "calisthenics-skills",
    name: "Calisthenics Skills & Core",
    workoutType: "Calisthenics",
    badge: "5-Day Bodyweight",
    description:
      "Skill mastery, planche & lever progressions, handstands, and explosive endurance.",
    plan: [
      { day: "mon", focus: "Push & Planche Progressions" },
      { day: "tue", focus: "Pull & Front Lever Work" },
      { day: "wed", focus: "Legs & Core Conditioning" },
      { day: "thu", focus: "Handstand & Balance Skills" },
      { day: "fri", focus: "Full Body Endurance Circuit" },
      { day: "sat", focus: "Rest" },
      { day: "sun", focus: "Rest" },
    ],
  },
  {
    id: "fullbody-3day",
    name: "Full Body Athlete 3X",
    workoutType: "Gym",
    badge: "3-Day High Efficiency",
    description: "Compound lifts 3 times a week with dedicated 48h recovery between sessions.",
    plan: [
      { day: "mon", focus: "Full Body (Strength A)" },
      { day: "tue", focus: "Rest" },
      { day: "wed", focus: "Full Body (Power B)" },
      { day: "thu", focus: "Rest" },
      { day: "fri", focus: "Full Body (Hypertrophy C)" },
      { day: "sat", focus: "Rest" },
      { day: "sun", focus: "Rest" },
    ],
  },
  {
    id: "cardio-hiit",
    name: "Cardio & HIIT Conditioning",
    workoutType: "Cardio",
    badge: "4-Day Cardio",
    description: "Endurance running, Zone 2 base building, sprint intervals and recovery.",
    cardioDays: ["mon", "tue", "thu", "sat"],
    plan: [
      { day: "mon", focus: "Cardio (Interval Sprints)" },
      { day: "tue", focus: "Cardio (Zone 2 Base)" },
      { day: "wed", focus: "Rest" },
      { day: "thu", focus: "Cardio (Tempo Session)" },
      { day: "fri", focus: "Rest" },
      { day: "sat", focus: "Cardio (Long Endurance)" },
      { day: "sun", focus: "Rest" },
    ],
  },
];

function WorkoutProgramsPage() {
  const { user } = useAuth();

  const { workoutPrograms, fitnessLoading, refreshFitness } = useData();

  const todayKey = todayDayKey();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProgram, setEditingProgram] = useState<WorkoutProgram | null>(null);

  const [name, setName] = useState("");
  const [workoutType, setWorkoutType] = useState<WorkoutType>("Calisthenics");
  const [weeklyPlan, setWeeklyPlan] = useState<ProgramDayPlan[]>(DEFAULT_WEEKLY_PLAN);
  const [cardioDays, setCardioDays] = useState<DayKey[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Preset application guard state
  const [pendingPreset, setPendingPreset] = useState<ProgramPreset | null>(null);

  const { deleteWithGuard } = useDeleteWithGuard();

  const resetForm = () => {
    setName("");
    setWorkoutType("Calisthenics");
    setWeeklyPlan(DEFAULT_WEEKLY_PLAN);
    setCardioDays([]);
    setNotes("");
    setPendingPreset(null);
  };

  const openAddModal = () => {
    sounds.playActionClick();
    setEditingProgram(null);
    resetForm();
    setModalOpen(true);
  };

  const confirmApplyPreset = () => {
    if (!pendingPreset) return;
    const preset = pendingPreset;
    sounds.playClick();
    setName(preset.name);
    setWorkoutType(preset.workoutType);
    if (preset.workoutType === "Cardio") {
      setCardioDays(preset.cardioDays || ["mon", "wed", "fri"]);
      setWeeklyPlan(preset.plan);
    } else {
      setCardioDays([]);
      setWeeklyPlan(preset.plan);
    }
    setNotes(preset.description);
    setPendingPreset(null);
    toast.success(`Applied ${preset.name} template!`);
  };

  const applyPreset = (preset: ProgramPreset) => {
    // Guard: if form already has custom data, ask for confirmation
    const hasCustomData =
      name.trim() !== "" ||
      notes.trim() !== "" ||
      weeklyPlan.some((p) => p.focus !== DEFAULT_WEEKLY_PLAN.find((d) => d.day === p.day)?.focus);
    if (hasCustomData) {
      setPendingPreset(preset);
    } else {
      confirmApplyPreset();
    }
  };

  const openEditModal = (p: WorkoutProgram) => {
    sounds.playActionClick();
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
      // Convert structured cardio days back into display labels (preserve any custom labels)
      setWeeklyPlan((prev) => {
        if (prev.length > 0) return prev;
        return DAY_KEY_ORDER.map((dk) => ({
          day: dk,
          focus: cardioDays.includes(dk) ? "Cardio" : "Rest",
        }));
      });
    }
  };

  const handleCardioDayToggle = (dayKey: DayKey, checked: boolean) => {
    sounds.playClick();
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
        sounds.playSuccess();
        toast.success("Workout Program updated!");
      } else {
        await createWorkoutProgram(user.id, payload);
        sounds.playSuccess();
        toast.success("New Workout Program created! 🎯");
      }
      await refreshFitness();
      setModalOpen(false);
      resetForm();
    } catch {
      sounds.playError();
      toast.error("Failed to save Workout Program.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    await deleteWithGuard(id, async () => {
      await deleteWorkoutProgram(id, user.id);
      await refreshFitness();
      toast.success("Program removed.", { id: `program-removed-${id}` });
    })().catch(() => {
      toast.error("Could not delete program.", { id: `program-delete-error-${id}` });
    });
  };

  const handleSetActive = async (id: string) => {
    if (!user) return;
    try {
      sounds.playActionClick();
      await activateWorkoutProgram(id, user.id);
      await refreshFitness();
      toast.success("Active workout program updated! 🎯");
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
            className="tap flex items-center gap-1.5 rounded-full bg-[#12131A] px-3.5 py-1.5 text-xs font-black text-white shadow-md hover:bg-[#12131A]/90 transition-transform active:scale-95"
          >
            <Plus className="size-3.5 stroke-[3]" /> Create Program
          </button>
        }
      />

      {/* Programs List */}
      <div className="space-y-4">
        {fitnessLoading ? (
          <ListSkeleton count={2} />
        ) : workoutPrograms.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-center shadow-xs">
            <div className="mx-auto mb-3 flex h-36 w-full max-w-[220px] items-center justify-center">
              <img
                src="/illustration/workout-programs.webp"
                alt="Workout Programs"
                className="h-full w-full object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.08)]"
              />
            </div>
            <p className="mt-2 text-base font-black text-[#12131A]">No workout programs yet</p>
            <p className="text-xs text-[#6B7280] mt-1 max-w-sm mx-auto">
              Choose a proven training split like Push / Pull / Legs, Calisthenics Skills, or create
              your own custom routine.
            </p>
            <button
              onClick={openAddModal}
              className="tap mt-5 inline-flex items-center gap-1.5 rounded-full bg-[#12131A] px-5 py-2.5 text-xs font-black text-white shadow-md hover:bg-slate-800 transition-transform active:scale-95"
            >
              <Plus className="size-4 stroke-[3]" /> Create First Program
            </button>
          </div>
        ) : (
          workoutPrograms.map((program) => {
            const trainingCount = DAY_KEY_ORDER.filter(
              (dk) => focusForDay(program, dk).toLowerCase() !== "rest",
            ).length;
            const restCount = 7 - trainingCount;

            return (
              <div
                key={program.id}
                className={cn(
                  "card-soft bg-white p-5 border shadow-xs space-y-3 transition-all",
                  program.is_active
                    ? "border-emerald-200/80 ring-1 ring-emerald-500/20 bg-gradient-to-b from-white to-[#F9FEFA]"
                    : "border-black/5 hover:border-black/10",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#7C5CFC]/10 px-2.5 py-0.5 text-xs font-black text-[#7C5CFC] uppercase tracking-wider">
                        {program.workout_type === "Cardio" ? (
                          <Zap className="size-3" />
                        ) : (
                          <Dumbbell className="size-3" />
                        )}
                        {program.workout_type || "Program"}
                      </span>
                      {program.is_active && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-black text-emerald-700">
                          <Check className="size-3 stroke-[3]" /> Active Program
                        </span>
                      )}
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-muted-foreground">
                        {trainingCount}d train · {restCount}d rest
                      </span>
                    </div>
                    <h3 className="mt-1.5 text-lg font-black text-[#12131A] tracking-tight">
                      {program.name}
                    </h3>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {!program.is_active && (
                      <button
                        onClick={() => handleSetActive(program.id)}
                        className="tap rounded-full border border-emerald-600/30 bg-emerald-50/60 px-3 py-1 text-xs font-black text-emerald-700 hover:bg-emerald-100/80 transition-colors"
                      >
                        Set Active
                      </button>
                    )}
                    <button
                      onClick={() => openEditModal(program)}
                      title="Edit Program"
                      className="tap flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[#6B7280] hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 transition-colors"
                    >
                      <Edit2 className="size-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(program.id)}
                      title="Delete Program"
                      className="tap flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-rose-500 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 transition-colors"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>

                {/* Weekly Plan Grid */}
                <div className="rounded-2xl bg-[#F9F9FD] p-3 border border-black/5">
                  <span className="text-xs font-extrabold uppercase text-[#6B7280] tracking-wider block mb-2">
                    Weekly Split
                  </span>
                  <WeeklySplitGrid
                    days={DAY_KEY_ORDER.map((dayKey) => ({
                      key: dayKey,
                      focus: focusForDay(program, dayKey),
                      isToday: dayKey === todayKey,
                    }))}
                  />
                </div>

                {program.notes && (
                  <p className="text-xs text-muted-foreground bg-slate-50 border border-slate-100 rounded-xl p-2.5 font-medium leading-relaxed">
                    💡 {program.notes}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add/Edit Program Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} className="bg-white max-w-lg">
        <div className="flex items-center justify-between border-b border-black/5 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-xl bg-[#12131A] text-white">
              <Layers className="size-4" />
            </div>
            <div>
              <h3 className="text-base font-black text-[#12131A]">
                {editingProgram ? "Edit Program" : "Create Workout Program"}
              </h3>
              <p className="text-xs font-semibold text-muted-foreground">
                Define your training split and weekly focus
              </p>
            </div>
          </div>
          <button
            onClick={() => setModalOpen(false)}
            className="tap flex size-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Quick Presets Carousel/Grid (Only when creating new) */}
        {!editingProgram && (
          <div className="mt-3.5 rounded-2xl bg-slate-50 p-3 border border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-black uppercase text-muted-foreground tracking-wider flex items-center gap-1">
                <Flame className="size-3 text-amber-500" /> Instant Split Presets
              </span>
              <span className="text-xs text-muted-foreground font-medium">1-tap setup</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-36 overflow-y-auto pr-1">
              {PROGRAM_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="tap flex flex-col items-start rounded-xl border border-slate-200 bg-white p-2 text-left hover:border-[#7C5CFC]/50 hover:bg-[#7C5CFC]/5 transition-all shadow-2xs group"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-black text-[#12131A] group-hover:text-[#7C5CFC] transition-colors">
                      {preset.name}
                    </span>
                    <span className="text-xs font-black text-[#7C5CFC] bg-[#7C5CFC]/10 px-1.5 py-0.5 rounded-md">
                      {preset.badge}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                    {preset.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {pendingPreset && (
          <div className="mt-3.5 rounded-2xl border border-amber-300/60 bg-amber-50 p-3.5">
            <p className="text-xs font-bold text-amber-900">
              Apply "{pendingPreset.name}"? This will replace your current form data.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={confirmApplyPreset}
                className="tap rounded-full bg-amber-600 px-3.5 py-1.5 text-xs font-black text-white hover:bg-amber-700 transition-colors"
              >
                Apply Template
              </button>
              <button
                type="button"
                onClick={() => setPendingPreset(null)}
                className="rounded-full border border-amber-300 px-3.5 py-1.5 text-xs font-black text-amber-900 hover:bg-amber-100 transition-colors"
              >
                Keep My Data
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSave} className="mt-4 space-y-3.5">
          <div>
            <label className="text-xs font-bold text-[#12131A]">Program Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Calisthenics Master / PPL Split"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs font-bold outline-none focus:border-[#7C5CFC] focus:bg-white transition-colors"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-[#12131A]">Primary Workout Type</label>
            <select
              value={workoutType}
              onChange={(e) => handleWorkoutTypeChange(e.target.value as WorkoutType)}
              className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs font-bold outline-none focus:border-[#7C5CFC] focus:bg-white transition-colors"
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
              <p className="text-xs text-[#6B7280] font-medium mb-2">
                Check the days you do cardio. Unchecked days are marked as recovery days.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {DAY_KEY_ORDER.map((dayKey) => {
                  const checked = cardioDays.includes(dayKey);
                  return (
                    <div
                      key={dayKey}
                      onClick={() => handleCardioDayToggle(dayKey, !checked)}
                      className={cn(
                        "flex items-center justify-between rounded-xl border p-2.5 cursor-pointer transition-colors tap",
                        checked
                          ? "border-[#7C5CFC]/40 bg-[#7C5CFC]/5"
                          : "border-black/10 bg-[#F9F9FD]",
                      )}
                    >
                      <span className="text-xs font-bold text-[#12131A]">{DAY_LABELS[dayKey]}</span>
                      <span className="flex items-center gap-2">
                        {checked ? (
                          <span className="rounded-full bg-[#7C5CFC]/15 px-2 py-0.5 text-xs font-black text-[#7C5CFC]">
                            Cardio
                          </span>
                        ) : (
                          <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-black text-[#6B7280]">
                            Rest
                          </span>
                        )}
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => handleCardioDayToggle(dayKey, !!v)}
                          aria-label={`${DAY_LABELS[dayKey]} cardio day`}
                          className="size-4 rounded-[6px] border-black/20 data-[state=checked]:border-[#7C5CFC] data-[state=checked]:bg-[#7C5CFC] data-[state=checked]:text-white"
                        />
                      </span>
                    </div>
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
                      <span className="w-20 text-xs font-black text-[#6B7280] shrink-0">
                        {DAY_LABELS[dayKey]}
                      </span>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Push / Rest / Legs"
                        value={currentItem?.focus || ""}
                        onChange={(e) => handleDayFocusChange(dayKey, e.target.value)}
                        className="flex-1 rounded-xl border border-black/10 bg-[#F9F9FD] p-2 text-xs font-semibold outline-none focus:border-[#7C5CFC] focus:bg-white transition-colors"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-bold text-[#12131A]">
              Program Notes & Guidelines (optional)
            </label>
            <textarea
              rows={2}
              placeholder="Progression targets, warmup cues, or target weights..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs font-medium outline-none focus:border-[#7C5CFC] focus:bg-white resize-none"
            />
          </div>

          <div className="flex gap-2 pt-3">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="w-1/2 rounded-xl border border-black/10 py-2.5 text-xs font-black text-muted-foreground hover:bg-black/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="tap w-1/2 flex items-center justify-center gap-1.5 rounded-xl bg-[#12131A] py-2.5 text-xs font-black text-white shadow-md hover:bg-slate-800 disabled:opacity-50 transition-transform active:scale-95"
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null} Save Program
            </button>
          </div>
        </form>
      </Modal>
    </Screen>
  );
}
