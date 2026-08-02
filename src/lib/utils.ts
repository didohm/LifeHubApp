import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Age calculated dynamically from a YYYY-MM-DD date of birth.
 * Never stored — always derived at render time.
 */
export function calculateAge(
  dateOfBirth: string | null | undefined,
  from: Date = new Date(),
): number {
  if (!dateOfBirth) return 0;
  const [y, m, d] = dateOfBirth.split("-").map(Number);
  if (!y || !m || !d) return 0;
  let age = from.getFullYear() - y;
  const monthDiff = from.getMonth() + 1 - m;
  if (monthDiff < 0 || (monthDiff === 0 && from.getDate() < d)) age -= 1;
  return Math.max(0, age);
}

/** Local date string (YYYY-MM-DD) for a given date — used for date input bounds. */
export function toDateInputValue(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
