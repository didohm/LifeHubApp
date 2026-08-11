import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { DAY_SHORT } from "@/lib/api";
import type { DayKey } from "@/lib/types";

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
 * Weekly split strip.
 *
 * Layout is structural, not fluid: on narrow screens the 7 days scroll
 * horizontally at full size (snap-to-day), and from `sm` upward the same
 * cells become a 7-column grid. Hierarchy stacks three dimensions — color,
 * weight and elevation — so the active day, training days and rest days
 * never look alike:
 *
 *  - Today: brand gradient, "TODAY" badge, glow ring + shadow
 *  - Training day: dark surface, white text
 *  - Rest day: muted ghost fill, dashed border
 */
export function WeeklySplitGrid({ days }: { days: WeeklySplitDay[] }) {
  return (
    <div className="flex snap-x snap-proximity gap-1.5 overflow-x-auto pb-1 pt-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:grid-cols-7 sm:gap-2 sm:overflow-visible sm:pb-0 sm:pt-2.5">
      {days.map((d) => {
        const isRest = d.focus.toLowerCase() === "rest";
        return (
          <div
            key={d.key}
            className={cn(
              "relative flex min-w-[68px] snap-start flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-2.5 text-center transition-all sm:min-w-0",
              d.isToday &&
                "bg-gradient-to-b from-[#C49A6C] to-[#B8956B] text-white shadow-lg shadow-[#C49A6C]/35 ring-2 ring-white/40",
              !d.isToday &&
                isRest &&
                "border border-dashed border-black/10 bg-black/[0.045] text-[#9CA3AF]",
              !d.isToday && !isRest && "bg-slate-900 text-white shadow-sm",
            )}
          >
            {d.isToday && (
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-[#C49A6C] px-2 py-0.5 text-[7px] font-black uppercase tracking-[0.14em] text-white shadow-sm ring-2 ring-white">
                Today
              </span>
            )}
            <div className="flex items-center justify-center gap-1">
              <span
                className={cn(
                  "text-[9px] font-extrabold uppercase tracking-wider",
                  d.isToday ? "text-white/90" : isRest ? "text-[#B4BAC4]" : "text-white/60",
                )}
              >
                {DAY_SHORT[d.key]}
              </span>
              {d.completed && (
                <span className="grid size-3.5 place-items-center rounded-full bg-emerald-500 ring-1 ring-white/70">
                  <Check className="size-2.5 text-white" strokeWidth={4} />
                </span>
              )}
            </div>
            <span
              className={cn(
                "text-[10px] font-black leading-tight break-words line-clamp-2",
                d.isToday && "text-white",
              )}
            >
              {isRest ? "Rest" : d.focus}
            </span>
          </div>
        );
      })}
    </div>
  );
}
