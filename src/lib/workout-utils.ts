import { WorkoutProgram, DayKey } from "./types";

export const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Format a Date as a local ISO date string (YYYY-MM-DD).
 */
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Get the DayKey for a given Date.
 */
export function dayKeyOf(d: Date): DayKey {
  return DAY_KEYS[d.getDay()];
}

/**
 * Format a duration in seconds as MM:SS.
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Check if a program is a cardio program.
 */
export function isCardioProgram(p: WorkoutProgram): boolean {
  return p.workout_type === "Cardio";
}

/**
 * Get structured training days for cardio programs.
 */
export function cardioTrainingDays(p: WorkoutProgram): DayKey[] {
  const structured = p.training_days;
  if (structured && structured.length > 0) return structured;
  return [];
}

/**
 * Get the focus / muscle group for a specific day in a program.
 */
export function focusForDay(p: WorkoutProgram, day: DayKey): string {
  if (isCardioProgram(p)) {
    return cardioTrainingDays(p).includes(day) ? "Cardio" : "Rest";
  }

  const plan = (p.weekly_plan || []).find((item) => item.day === day);
  if (plan?.focus) return plan.focus;
  return "Rest";
}

/**
 * Check if a specific day is a training day (not rest) for a program.
 */
export function isTrainingDay(p: WorkoutProgram, day: DayKey): boolean {
  if (isCardioProgram(p)) return cardioTrainingDays(p).includes(day);
  return focusForDay(p, day).toLowerCase() !== "rest";
}

/**
 * Normalized category used for deriving tags and tips.
 * Matches against the beginning of words to avoid false positives.
 */
function matchFocusCategory(focus: string): string {
  const f = focus.toLowerCase();
  const entries = [
    ["push", "push"],
    ["pull", "pull"],
    ["leg", "leg"],
    ["upper", "upper"],
    ["lower", "lower"],
    ["skill", "skill"],
    ["calisthenic", "skill"],
    ["planche", "skill"],
    ["lever", "skill"],
    ["cardio", "cardio"],
    ["hiit", "cardio"],
    ["sprint", "cardio"],
    ["full body", "full"],
    ["fullbody", "full"],
    ["rest", "rest"],
  ] as const;

  for (const [keyword, category] of entries) {
    const regex = new RegExp(`\\b${keyword}\\b`);
    if (regex.test(f)) return category;
  }
  return "default";
}

/**
 * Get muscle-group tags for a focus string.
 */
export function getFocusTags(focus: string, workoutType?: string): string[] {
  const category = matchFocusCategory(focus || "");
  switch (category) {
    case "push":
      return ["Chest", "Front Delts", "Triceps"];
    case "pull":
      return ["Lats", "Rhomboids", "Biceps"];
    case "leg":
      return ["Quads", "Hamstrings", "Glutes", "Calves"];
    case "upper":
      return ["Chest", "Back", "Shoulders", "Arms"];
    case "lower":
      return ["Quads", "Hamstrings", "Calves", "Core"];
    case "skill":
      return ["Shoulder Stability", "Straight Arm Strength", "Core"];
    case "cardio":
    case "hiit":
      return ["Cardiovascular", "VO2 Max", "Aerobic Base"];
    case "full":
      return ["Compound Chains", "Core", "Total Body"];
    case "rest":
      return ["Active Recovery", "Joint Mobility", "Sleep"];
    default:
      if (workoutType === "Cardio") return ["Cardiovascular", "VO2 Max", "Aerobic Base"];
      return ["Target Muscles", "Conditioning", "Mobility"];
  }
}

/**
 * Get coaching tips for a focus string.
 */
export function getFocusTips(focus: string): string {
  const category = matchFocusCategory(focus || "");
  switch (category) {
    case "push":
      return "Warm up shoulder rotators and wrists with resistance bands before heavy pressing sets.";
    case "pull":
      return "Focus on elbow drive and full scapular retraction to isolate the lats and rhomboids.";
    case "leg":
      return "Perform dynamic ankle and hip mobility openers before squats or compound leg movements.";
    case "cardio":
    case "hiit":
      return "Keep hydration high. Maintain Zone 2 pacing on endurance runs and maximum effort on sprint intervals.";
    case "skill":
      return "Rest 2–3 minutes between skill attempts to keep the nervous system fresh and explosive.";
    case "rest":
      return "Prioritize 8+ hours of sleep, 3L water intake, and light walking to facilitate tissue recovery.";
    default:
      return "Maintain strict form, controlled tempo, and steady progressive overload.";
  }
}
