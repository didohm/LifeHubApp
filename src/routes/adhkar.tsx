import { useState, useMemo, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Search,
  Sunrise,
  Moon,
  Copy,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { sounds } from "@/lib/sound";
import {
  azkarData,
  getDueContext,
  useAzkarProgress,
  normalizeArabicText,
  MORNING_CATEGORY,
} from "@/lib/azkar";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/adhkar")({
  head: () => ({
    meta: [
      { title: "Daily Adhkar & Supplications — LifeHub" },
      {
        name: "description",
        content: "Daily Morning, Evening, and Situational Adhkar with an interactive digital Tasbih.",
      },
    ],
  }),
  component: AdhkarPage,
});

type AzkarApi = ReturnType<typeof useAzkarProgress>;

function AdhkarPage() {
  const [activeCat, setActiveCat] = useState<number | null>(null);
  const [zekrIdx, setZekrIdx] = useState(0);
  const [query, setQuery] = useState("");
  const [fontSize, setFontSize] = useState<"sm" | "md" | "lg" | "xl">("md");
  const azkar = useAzkarProgress();

  const openCategory = (catIdx: number) => {
    sounds.playCardClick();
    setQuery("");
    setActiveCat(catIdx);
    const items = azkarData[catIdx]?.items || [];
    const firstIncomplete = items.findIndex((item, i) => azkar.tapsFor(catIdx, i) < item.count);
    setZekrIdx(firstIncomplete === -1 ? 0 : firstIncomplete);
  };

  if (azkarData.length === 0) {
    return (
      <Screen>
        <ScreenHeader title="Adhkar" subtitle="Morning, evening & daily supplications" showBack />
        <div className="card-soft mt-3 border border-dashed border-border bg-white p-8 text-center shadow-2xs">
          <p className="text-sm font-bold text-foreground">Adhkar content isn't available.</p>
          <p className="mt-1 text-xs text-muted-foreground">Please restart the app to reload.</p>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      {activeCat === null ? (
        <Browse query={query} onQuery={setQuery} onOpen={openCategory} azkar={azkar} />
      ) : (
        <Reader
          catIdx={activeCat}
          zekrIdx={zekrIdx}
          onZekrIdxChange={setZekrIdx}
          onBack={() => setActiveCat(null)}
          fontSize={fontSize}
          onChangeFontSize={setFontSize}
          azkar={azkar}
        />
      )}
    </Screen>
  );
}

/* ══════════════════════════════════════════════════════════════
   BROWSE VIEW
   ══════════════════════════════════════════════════════════════ */

function Browse({
  query,
  onQuery,
  onOpen,
  azkar,
}: {
  query: string;
  onQuery: (q: string) => void;
  onOpen: (catIdx: number) => void;
  azkar: AzkarApi;
}) {
  const { dueIdx, otherIdx, otherLabel } = getDueContext();
  const dueCat = azkarData[dueIdx] || azkarData[0];
  const isMorning = dueCat.name === MORNING_CATEGORY;

  const dueTotal = dueCat.items.length;
  const dueDone = dueCat.items.filter((item, i) => azkar.tapsFor(dueIdx, i) >= item.count).length;
  const duePct = dueTotal > 0 ? Math.round((dueDone / dueTotal) * 100) : 0;
  const dueDoneAll = dueTotal > 0 && dueDone === dueTotal;

  const normalizedQuery = normalizeArabicText(query);

  const filtered = useMemo(() => {
    return azkarData
      .map((cat, idx) => ({ cat, idx }))
      .filter(({ cat }) => {
        if (!normalizedQuery) return true;
        if (normalizeArabicText(cat.name).includes(normalizedQuery)) return true;
        return cat.items.some(
          (it) =>
            normalizeArabicText(it.text).includes(normalizedQuery) ||
            normalizeArabicText(it.reference).includes(normalizedQuery) ||
            normalizeArabicText(it.description).includes(normalizedQuery),
        );
      });
  }, [normalizedQuery]);

  return (
    <div className="page-fade-enter">
      <ScreenHeader
        title="Adhkar"
        subtitle="Morning, evening & situational supplications"
        showBack
      />

      {/* ════════════════════════════════════════════════════════════
          TIME-AWARE DAILY DUE ADHKAR HERO
          ════════════════════════════════════════════════════════════ */}
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="card-soft mt-1 overflow-hidden p-5 shadow-xs border text-left relative"
        style={{
          background: isMorning
            ? "linear-gradient(135deg, #FEF3C7 0%, #FFFBEB 50%, #FAF8FF 100%)"
            : "linear-gradient(135deg, #E0E7FF 0%, #EEF2FF 50%, #FAF8FF 100%)",
          borderColor: isMorning ? "rgba(245, 158, 11, 0.25)" : "rgba(99, 102, 241, 0.25)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-[11px] font-black shadow-2xs",
                isMorning ? "bg-amber-500 text-white" : "bg-indigo-600 text-white",
              )}
            >
              {isMorning ? <Sunrise className="size-3.5" /> : <Moon className="size-3.5" />}
              {isMorning ? "Morning Routine" : "Evening Routine"}
            </span>

            <h2
              dir="rtl"
              lang="ar"
              className="mt-2.5 font-arabic text-2xl sm:text-3xl font-bold leading-tight text-[#12131A]"
            >
              {dueCat.name}
            </h2>

            <p className="mt-1 text-xs font-semibold text-muted-foreground">
              {dueTotal} daily supplications · {dueDoneAll ? "Completed today ✓" : `${dueDone}/${dueTotal} recited`}
            </p>
          </div>

          <div
            className={cn(
              "flex size-12 items-center justify-center rounded-2xl shadow-2xs shrink-0",
              dueDoneAll ? "bg-emerald-500 text-white" : "bg-white text-[#12131A]",
            )}
          >
            {dueDoneAll ? <Check className="size-6 stroke-[3]" /> : isMorning ? <Sunrise className="size-6 text-amber-600" /> : <Moon className="size-6 text-indigo-600" />}
          </div>
        </div>

        <div className="mt-4">
          <div className="h-2 w-full rounded-full bg-black/5 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                dueDoneAll ? "bg-emerald-500" : isMorning ? "bg-amber-500" : "bg-indigo-600",
              )}
              style={{ width: `${duePct}%` }}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(dueIdx)}
            className={cn(
              "tap flex-1 flex items-center justify-center gap-2 rounded-2xl py-3 text-xs font-black text-white shadow-md transition-transform active:scale-98",
              isMorning ? "bg-amber-600 hover:bg-amber-700" : "bg-indigo-600 hover:bg-indigo-700",
            )}
          >
            {dueDoneAll ? "Review Recitations" : "Recite Now"} <ArrowRight className="size-3.5" />
          </button>

          {otherIdx !== dueIdx && (
            <button
              type="button"
              onClick={() => onOpen(otherIdx)}
              className="tap rounded-2xl bg-white px-3.5 py-3 text-xs font-bold text-foreground border border-border/60 shadow-2xs hover:bg-slate-50 transition-transform"
            >
              {otherLabel}
            </button>
          )}
        </div>
      </motion.section>

      {/* ════════════════════════════════════════════════════════════
          SEARCH INPUT WITH ARABIC NORMALIZATION
          ════════════════════════════════════════════════════════════ */}
      <div className="mt-4 relative">
        <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          dir="auto"
          placeholder="Search supplication or category (e.g. سفر, نوم, صباح)..."
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          className="w-full rounded-2xl border border-border/70 bg-white py-2.5 pl-10 pr-4 text-xs font-semibold text-foreground outline-none shadow-2xs focus:border-[#7C5CFC] transition-all"
        />
      </div>

      {/* ════════════════════════════════════════════════════════════
          CATEGORIES LIST
          ════════════════════════════════════════════════════════════ */}
      <div className="mt-5 mb-2.5 flex items-center justify-between px-1">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          {query ? "Search Results" : "All Categories"}
        </h3>
        <span className="text-xs font-bold text-muted-foreground">
          {filtered.length} categories
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="card-soft mt-2 border border-dashed border-border bg-white p-8 text-center shadow-2xs">
          <BookOpenText className="mx-auto size-10 text-muted-foreground/40" />
          <p className="mt-2 text-sm font-extrabold text-foreground">No matching supplications found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try searching by category name, zikr phrase, or hadith source.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(({ cat, idx }) => {
            const doneInCat = cat.items.filter(
              (item, i) => azkar.tapsFor(idx, i) >= item.count,
            ).length;
            const isCatComplete = cat.items.length > 0 && doneInCat === cat.items.length;

            return (
              <motion.button
                key={idx}
                type="button"
                onClick={() => onOpen(idx)}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "card-soft tap flex w-full items-center justify-between gap-3 border bg-white p-3.5 text-left shadow-2xs transition-all hover:shadow-xs group",
                  isCatComplete ? "border-emerald-200/80 bg-emerald-50/20" : "border-border/60",
                )}
              >
                <span
                  dir="rtl"
                  lang="ar"
                  className="min-w-0 flex-1 truncate font-arabic text-base sm:text-lg font-bold leading-snug text-foreground text-right"
                >
                  {cat.name}
                </span>

                <div className="flex shrink-0 items-center gap-2">
                  {doneInCat > 0 && (
                    <span
                      className={cn(
                        "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black",
                        isCatComplete
                          ? "bg-emerald-500 text-white"
                          : "bg-emerald-500/15 text-emerald-700",
                      )}
                    >
                      <Check className="size-3 stroke-[3]" />
                      {doneInCat}/{cat.items.length}
                    </span>
                  )}
                  <span className="text-xs font-bold text-muted-foreground">
                    {cat.items.length}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                </div>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   READER & ELECTRONIC TASBIH VIEW
   ══════════════════════════════════════════════════════════════ */

function Reader({
  catIdx,
  zekrIdx,
  onZekrIdxChange,
  onBack,
  fontSize,
  onChangeFontSize,
  azkar,
}: {
  catIdx: number;
  zekrIdx: number;
  onZekrIdxChange: (idx: number) => void;
  onBack: () => void;
  fontSize: "sm" | "md" | "lg" | "xl";
  onChangeFontSize: (s: "sm" | "md" | "lg" | "xl") => void;
  azkar: AzkarApi;
}) {
  const cat = azkarData[catIdx] || { name: "Adhkar", items: [] };
  const total = cat.items.length;
  const item = cat.items[zekrIdx] || { text: "", count: 1, reference: "", description: "" };

  const [direction, setDirection] = useState<1 | -1>(1);
  const advancingRef = useRef(false);

  const taps = Math.min(azkar.tapsFor(catIdx, zekrIdx), item.count);
  const remaining = Math.max(0, item.count - taps);
  const done = remaining === 0;
  const isLast = zekrIdx === total - 1;

  const fontClasses: Record<"sm" | "md" | "lg" | "xl", string> = {
    sm: "text-lg leading-[2.1]",
    md: "text-xl leading-[2.2]",
    lg: "text-2xl leading-[2.3]",
    xl: "text-3xl leading-[2.4]",
  };

  const goToNext = () => {
    if (zekrIdx < total - 1) {
      setDirection(1);
      onZekrIdxChange(zekrIdx + 1);
    }
  };

  const goToPrev = () => {
    if (zekrIdx > 0) {
      setDirection(-1);
      onZekrIdxChange(zekrIdx - 1);
    }
  };

  const handleTap = () => {
    if (done) {
      if (!isLast) {
        goToNext();
      }
      return;
    }

    const nextTaps = taps + 1;
    azkar.recordTap(catIdx, zekrIdx);

    if (nextTaps >= item.count) {
      sounds.playSuccess();
      if (isLast) {
        toast.success(`Alhamdulillah! All ${total} supplications completed.`);
      } else {
        // Fast, fluid automatic progression to next dhikr with transition
        if (!advancingRef.current) {
          advancingRef.current = true;
          setTimeout(() => {
            goToNext();
            advancingRef.current = false;
          }, 110);
        }
      }
    } else {
      sounds.playActionClick();
    }
  };

  const handleCopy = () => {
    sounds.playClick();
    navigator.clipboard.writeText(`${item.text}\n\n${item.reference ? `[${item.reference}]` : ""}`);
    toast.success("Copied to clipboard!");
  };

  return (
    <div className="page-fade-enter pb-8 overflow-hidden">
      {/* ════════════════════════════════════════════════════════════
          HEADER CONTROLS
          ════════════════════════════════════════════════════════════ */}
      <header className="mb-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            sounds.playClick();
            onBack();
          }}
          aria-label="Back to categories"
          className="tap flex size-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-white text-foreground shadow-2xs hover:bg-slate-50"
        >
          <ChevronLeft className="size-5" />
        </button>

        <div className="min-w-0 flex-1 text-center">
          <h1
            dir="rtl"
            lang="ar"
            className="truncate font-arabic text-lg sm:text-xl font-bold leading-tight text-foreground"
          >
            {cat.name}
          </h1>
          <p className="text-[11px] font-bold text-muted-foreground">
            {zekrIdx + 1} of {total}
          </p>
        </div>

        {/* Font Size Selector */}
        <div className="flex shrink-0 items-center gap-1 bg-white border border-border/60 rounded-full p-0.5 shadow-2xs">
          {(["sm", "md", "lg"] as const).map((size) => (
            <button
              key={size}
              onClick={() => {
                sounds.playNavClick();
                onChangeFontSize(size);
              }}
              className={cn(
                "size-7 rounded-full text-xs font-black transition-all",
                fontSize === size ? "bg-[#12131A] text-white" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {size === "sm" ? "A" : size === "md" ? "A+" : "A++"}
            </button>
          ))}
        </div>
      </header>

      {/* Category Progress Bar */}
      <div className="mb-3">
        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-300"
            style={{ width: `${total > 0 ? Math.round(((zekrIdx + (done ? 1 : 0)) / total) * 100) : 0}%` }}
          />
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════
          MAIN RECITATION CARD (ANIMATED DIRECTIONAL TRANSITION)
          ════════════════════════════════════════════════════════════ */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={zekrIdx}
          initial={{ opacity: 0, x: direction * 28, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -direction * 28, scale: 0.98 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="card-soft border border-border/70 bg-white p-5 sm:p-6 text-center shadow-xs"
        >
          {/* Source Reference Badge */}
          <div className="flex items-center justify-between border-b border-border/40 pb-3 mb-4">
            <div className="flex items-center gap-1.5">
              <BookOpenText className="size-3.5 text-amber-600" />
              <span
                dir="rtl"
                lang="ar"
                className="font-arabic text-xs font-bold text-muted-foreground truncate max-w-[200px]"
              >
                {item.reference || "ذكر مأثور"}
              </span>
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="tap flex items-center gap-1 text-[11px] font-bold text-muted-foreground hover:text-foreground"
              title="Copy text"
            >
              <Copy className="size-3.5" /> Copy
            </button>
          </div>

          {/* Arabic Recitation Text */}
          <div className="my-2 py-2">
            <p
              dir="rtl"
              lang="ar"
              className={cn(
                "font-arabic whitespace-pre-line font-normal text-[#12131A] select-text selection:bg-amber-100",
                fontClasses[fontSize],
              )}
            >
              {item.text}
            </p>
          </div>

          {/* Virtue / Benefit Card */}
          {item.description && (
            <div
              dir="rtl"
              lang="ar"
              className="mt-4 rounded-2xl bg-amber-50/60 border border-amber-200/60 p-3.5 text-right font-arabic text-xs leading-relaxed text-amber-950 font-medium"
            >
              {item.description}
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════
              INTERACTIVE DIGITAL TASBIH (COUNTER)
              ════════════════════════════════════════════════════════════ */}
          <div className="mt-6 pt-4 border-t border-border/40 flex flex-col items-center">
            <div className="relative size-32 my-2 flex items-center justify-center">
              <svg className="size-full -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  className="stroke-slate-100"
                  strokeWidth="7"
                  fill="transparent"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  className={cn(
                    "transition-all duration-300 ease-out",
                    done ? "stroke-emerald-500" : "stroke-[#7C5CFC]",
                  )}
                  strokeWidth="7"
                  strokeDasharray={2 * Math.PI * 42}
                  strokeDashoffset={2 * Math.PI * 42 * (1 - Math.min(1, taps / item.count))}
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>
              <div className="absolute flex flex-col items-center justify-center">
                {done ? (
                  <CheckCircle2 className="size-10 text-emerald-500 animate-in zoom-in-50 duration-200" />
                ) : (
                  <>
                    <span className="text-3xl font-black text-[#12131A] tracking-tight">{remaining}</span>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      {remaining === 1 ? "tap left" : "taps left"}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Big Tactile Tap Button */}
            <button
              type="button"
              onClick={handleTap}
              className={cn(
                "tap mt-3 w-full max-w-xs flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black text-white shadow-md active:scale-95 transition-all",
                done
                  ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200"
                  : "bg-[#7C5CFC] hover:bg-[#6C4CE8] shadow-[#7C5CFC]/25",
              )}
            >
              {done ? (
                <>
                  <Check className="size-4 stroke-[3]" /> Completed
                </>
              ) : (
                `Tap to Count (${taps}/${item.count})`
              )}
            </button>

            {/* Reset button */}
            {taps > 0 && (
              <button
                type="button"
                onClick={() => {
                  sounds.playClick();
                  azkar.resetZekr(catIdx, zekrIdx);
                }}
                className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="size-3" /> Reset count
              </button>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* ════════════════════════════════════════════════════════════
          BOTTOM NAVIGATION CONTROLS
          ════════════════════════════════════════════════════════════ */}
      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            sounds.playClick();
            goToPrev();
          }}
          disabled={zekrIdx === 0}
          className="tap flex-1 flex items-center justify-center gap-1 rounded-2xl bg-white py-3 text-xs font-bold text-foreground border border-border/60 shadow-2xs hover:bg-slate-50 disabled:opacity-30"
        >
          <ChevronLeft className="size-4" /> Previous
        </button>

        {done && isLast ? (
          <button
            type="button"
            onClick={() => {
              sounds.playSuccess();
              onBack();
            }}
            className="tap flex-1 flex items-center justify-center gap-1 rounded-2xl bg-emerald-600 py-3 text-xs font-black text-white shadow-md hover:bg-emerald-700"
          >
            Finished <Check className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              sounds.playClick();
              goToNext();
            }}
            disabled={isLast}
            className="tap flex-1 flex items-center justify-center gap-1 rounded-2xl bg-[#12131A] py-3 text-xs font-bold text-white shadow-xs hover:bg-[#12131A]/90 disabled:opacity-30"
          >
            Next <ChevronRight className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
