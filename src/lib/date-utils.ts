/**
 * Date utility functions
 * Centralized date parsing and manipulation logic
 */

/**
 * Parse a date string in local timezone (YYYY-MM-DD)
 * Returns a Date object set to midnight in local timezone
 */
export function parseLocalDate(dateStr: string | undefined): Date {
  if (!dateStr) return new Date();
  const datePart = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
  const [y, m, d] = datePart.split("-").map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return new Date();
  return new Date(y, m - 1, d);
}

/**
 * Parse a date string and return only the date portion (no time)
 * Alias for parseLocalDate for backward compatibility
 */
export function parseDateOnly(dateStr: string | undefined): Date {
  return parseLocalDate(dateStr);
}

/**
 * Check if a date is today
 */
export function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

/**
 * Format a date to YYYY-MM-DD string
 */
export function formatDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
