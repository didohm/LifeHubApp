import { WorkoutProgram, DayKey } from "./types";

export const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Check if a program is a cardio program
 */
export function isCardioProgram(p: WorkoutProgram): boolean {
  return p.workout_type === "Cardio";
}

/**
 * Get structured training days for cardio programs (with legacy text-plan fallback).
 * Returns the list of days that have cardio training scheduled.
 */
export function cardioTrainingDays(p: WorkoutProgram): DayKey[] {
  const structured = p.training_days;
  if (structured && structured.length > 0) return structured;
  
  // Legacy fallback: parse from weekly_plan
  return DAY_KEYS.filter((dk) => {
    const focus = (p.weekly_plan || []).find((x) => x.day === dk)?.focus || "";
    return focus.toLowerCase() !== "rest";
  });
}

/**
 * Get the focus/muscle group for a specific day in a program.
 * For cardio programs, returns "Cardio" or "Rest".
 * For other programs, returns the focus from weekly_plan or "Rest".
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
