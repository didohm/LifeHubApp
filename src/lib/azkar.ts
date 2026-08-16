/**
 * Adhkar service — data + daily progress.
 *
 * Source of truth: /azkar.json (a SQLite table export). It is parsed once at
 * module load into typed records, grouped by category in the order the data
 * ships (the daily sections come first: morning, evening, sleep…).
 *
 * Progress is kept per local day and pruned on load — the same
 * "auto-resets daily" behavior as the hydration tracker.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import raw from "../../azkar.json";

export interface ZekrEntry {
  category: string;
  text: string;
  description: string;
  reference: string;
  count: number;
}

export interface ZekrCategory {
  name: string;
  items: ZekrEntry[];
}

export type AzkarProgress = Record<string, number>;

/**
 * Rows in the export are positional arrays: [category, zekr, description,
 * count, reference, search].
 */
type RawRow = unknown[];

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Many exported rows have no count (one-time supplications) — treat as 1. */
function resolveCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.round(value);
  }
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Remove tashkeel and normalize Arabic characters for robust search matching */
export function normalizeArabicText(text: string): string {
  if (!text) return "";
  return text
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[ـ\s]+/g, " ")
    .trim()
    .toLowerCase();
}

function parseAzkar(): ZekrCategory[] {
  const rows = (raw as { rows?: RawRow[] }).rows ?? [];
  const ordered: ZekrCategory[] = [];
  const byName = new Map<string, ZekrEntry[]>();

  for (const row of rows) {
    const category = asString(row[0]);
    const text = asString(row[1]);
    if (!category || !text) continue;

    let items = byName.get(category);
    if (!items) {
      items = [];
      byName.set(category, items);
      ordered.push({ name: category, items });
    }
    items.push({
      category,
      text,
      description: asString(row[2]),
      reference: asString(row[4]),
      count: resolveCount(row[3]),
    });
  }
  return ordered;
}

export const azkarData: ZekrCategory[] = parseAzkar();

export const MORNING_CATEGORY = "أذكار الصباح";
export const EVENING_CATEGORY = "أذكار المساء";

/** Short English handle for the two timed daily sections. */
export function dueLabel(categoryName: string): string {
  if (categoryName === MORNING_CATEGORY) return "Morning adhkar";
  if (categoryName === EVENING_CATEGORY) return "Evening adhkar";
  return "";
}

export interface DueContext {
  dueIdx: number;
  otherIdx: number;
  otherLabel: string;
}

/**
 * The daily section that is due right now. Morning runs until noon, evening
 * from noon — the app's time-of-day split, mirroring the routine pattern.
 */
export function getDueContext(): DueContext {
  const morningIdx = azkarData.findIndex((c) => c.name === MORNING_CATEGORY);
  const eveningIdx = azkarData.findIndex((c) => c.name === EVENING_CATEGORY);
  const morningDue = new Date().getHours() < 12;

  if (morningDue) {
    return {
      dueIdx: morningIdx >= 0 ? morningIdx : 0,
      otherIdx: eveningIdx >= 0 ? eveningIdx : morningIdx >= 0 ? morningIdx : 0,
      otherLabel: "Tonight",
    };
  }
  return {
    dueIdx: eveningIdx >= 0 ? eveningIdx : 0,
    otherIdx: morningIdx >= 0 ? morningIdx : eveningIdx >= 0 ? eveningIdx : 0,
    otherLabel: "Tomorrow morning",
  };
}

/* ---------------------------------- Store --------------------------------- */

const STORAGE_KEY = "lifehub_azkar_progress_v1";

function todayKey(): string {
  return new Date().toDateString();
}

function itemKey(date: string, catIdx: number, zekrIdx: number): string {
  return `${date}|${catIdx}|${zekrIdx}`;
}

/** Read today's progress, dropping any stale (older) days. */
export function loadTodayProgress(): AzkarProgress {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as AzkarProgress;
    const today = todayKey();
    const out: AzkarProgress = {};
    for (const key of Object.keys(parsed)) {
      if (key.startsWith(`${today}|`)) out[key] = parsed[key];
    }
    return out;
  } catch {
    return {};
  }
}

function persist(progress: AzkarProgress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    /* storage unavailable — session-only progress */
  }
}

/**
 * Per-day tap counts for every zekr. Loaded after mount so the server render
 * and the first client render agree (no hydration mismatch).
 */
export function useAzkarProgress() {
  const [progress, setProgress] = useState<AzkarProgress>({});

  useEffect(() => {
    setProgress(loadTodayProgress());
  }, []);

  const day = todayKey();

  const recordTap = useCallback(
    (catIdx: number, zekrIdx: number) => {
      setProgress((prev) => {
        const key = itemKey(day, catIdx, zekrIdx);
        const next = { ...prev, [key]: (prev[key] ?? 0) + 1 };
        persist(next);
        return next;
      });
    },
    [day],
  );

  const resetZekr = useCallback(
    (catIdx: number, zekrIdx: number) => {
      setProgress((prev) => {
        const key = itemKey(day, catIdx, zekrIdx);
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        persist(next);
        return next;
      });
    },
    [day],
  );

  const resetCategory = useCallback(
    (catIdx: number) => {
      setProgress((prev) => {
        let changed = false;
        const prefix = `${day}|${catIdx}|`;
        const next: AzkarProgress = {};
        for (const key of Object.keys(prev)) {
          if (key.startsWith(prefix)) {
            changed = true;
            continue;
          }
          next[key] = prev[key];
        }
        if (!changed) return prev;
        persist(next);
        return next;
      });
    },
    [day],
  );

  return useMemo(
    () => ({
      progress,
      recordTap,
      resetZekr,
      resetCategory,
      tapsFor: (catIdx: number, zekrIdx: number) => progress[itemKey(day, catIdx, zekrIdx)] ?? 0,
    }),
    [progress, recordTap, resetZekr, resetCategory, day],
  );
}
