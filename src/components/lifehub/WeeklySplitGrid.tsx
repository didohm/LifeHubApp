import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { DAY_SHORT } from "@/lib/api";
import type { DayKey } from "@/lib/types";
import { sounds } from "@/lib/sound";

export interface WeeklySplitDay {
  key: DayKey;
  focus: string;
  isToday?: boolean;
  /** Whether the day's session was already completed. */
  completed?: boolean;
}

const WEEK_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Day key (Sunday-first) for a given date, matching program day keys. */
export function dayKeyOf(d: Date): DayKey {
  return WEEK_KEYS[d.getDay()];
}

/** Day key of today, in the program's Sunday-first ordering. */
export function todayDayKey(): DayKey {
  return dayKeyOf(new Date());
}

/**
 * Weekly split grid.
 *
 * Always a responsive grid — 4 columns on narrow screens, 7 from `sm` up —
 * so the full week is visible with no horizontal scrolling. Cells encode
 * three levels of hierarchy: today (solid brand accent), training day
 * (amber tint), rest day (quiet gray).
 */
export function WeeklySplitGrid({
  days,
  selectedKey,
  onSelectDay,
}: {
  days: WeeklySplitDay[];
  selectedKey?: DayKey;
  onSelectDay?: (key: DayKey) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7 sm:gap-2">
      {days.map((d) => {
        const isRest = d.focus.toLowerCase() === "rest";
        const isSelected = selectedKey === d.key;

        return (
          <button
            key={d.key}
            type="button"
            onClick={() => {
              if (onSelectDay) {
                sounds.playNavClick();
                onSelectDay(d.key);
              }
            }}
            className={cn(
              "relative flex flex-col items-center justify-center gap-1.5 rounded-xl px-1 py-2.5 text-center transition-all tap",
              onSelectDay && "cursor-pointer active:scale-95",
              !onSelectDay && "cursor-default",
              d.isToday
                ? "bg-gradient-to-b from-[#7C5CFC] to-[#6B4DE8] text-white shadow-md shadow-[#7C5CFC]/30 ring-2 ring-white/50"
                : isRest
                  ? "border border-dashed border-slate-200 bg-slate-50 hover:bg-slate-100"
                  : "border border-amber-500/25 bg-amber-500/10 hover:bg-amber-500/15",
              isSelected && !d.isToday && "ring-2 ring-[#7C5CFC] shadow-md",
            )}
          >
            <span className="flex items-center justify-center gap-1">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider",
                  d.isToday
                    ? "bg-white/20 text-white"
                    : isRest
                      ? "bg-slate-100 text-slate-400"
                      : "bg-amber-500/15 text-amber-800",
                )}
              >
                {DAY_SHORT[d.key]}
              </span>
              {d.completed && (
                <span
                  className={cn(
                    "grid size-4 place-items-center rounded-full bg-emerald-500",
                    d.isToday ? "ring-2 ring-white/70" : "ring-1 ring-white",
                  )}
                >
                  <Check className="size-2.5 text-white stroke-[3]" />
                </span>
              )}
            </span>
            <span
              className={cn(
                "text-[11px] font-bold leading-tight break-words line-clamp-2",
                d.isToday ? "text-white" : isRest ? "text-slate-400" : "text-[#12131A]",
              )}
            >
              {isRest ? "Rest" : d.focus}
            </span>
          </button>
        );
      })}
    </div>
  );
}
