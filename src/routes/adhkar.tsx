import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { Progress } from "@/components/ui/progress";
import { sounds } from "@/lib/sound";
import { azkarData, getDueContext, useAzkarProgress } from "@/lib/azkar";

export const Route = createFileRoute("/adhkar")({
  head: () => ({
    meta: [{ title: "Adhkar — LifeHub" }],
  }),
  component: AdhkarPage,
});

type AzkarApi = ReturnType<typeof useAzkarProgress>;

/* ---------------------------------- Page ---------------------------------- */

function AdhkarPage() {
  const [activeCat, setActiveCat] = useState<number | null>(null);
  const [zekrIdx, setZekrIdx] = useState(0);
  const [query, setQuery] = useState("");
  const azkar = useAzkarProgress();

  const openCategory = (catIdx: number) => {
    sounds.playCardClick();
    setQuery("");
    setActiveCat(catIdx);
    // Resume at the day's first unfinished zikr — or the last one when the
    // whole category is already done.
    const items = azkarData[catIdx].items;
    const firstIncomplete = items.findIndex((item, i) => azkar.tapsFor(catIdx, i) < item.count);
    setZekrIdx(firstIncomplete === -1 ? items.length - 1 : firstIncomplete);
  };

  if (azkarData.length === 0) {
    return (
      <Screen>
        <ScreenHeader title="Adhkar" subtitle="Morning, evening & every situation" showBack />
        <div className="card-soft mt-3 border border-dashed border-black/10 bg-white p-6 text-center">
          <p className="text-sm font-bold text-[#12131A]">Zikr content isn&apos;t available.</p>
          <p className="mt-1 text-xs text-[#6B7280]">Please try again later.</p>
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
          azkar={azkar}
        />
      )}
    </Screen>
  );
}

/* --------------------------------- Browse --------------------------------- */

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
  const dueCat = azkarData[dueIdx];
  const dueTotal = dueCat.items.length;
  const dueDone = dueCat.items.filter((item, i) => azkar.tapsFor(dueIdx, i) >= item.count).length;
  const duePct = dueTotal > 0 ? Math.round((dueDone / dueTotal) * 100) : 0;
  const dueDoneAll = dueTotal > 0 && dueDone === dueTotal;

  const q = query.trim().toLowerCase();
  const filtered = azkarData
    .map((cat, idx) => ({ cat, idx }))
    .filter(({ cat }) => {
      if (!q) return true;
      if (cat.name.toLowerCase().includes(q)) return true;
      return cat.items.some(
        (it) => it.text.toLowerCase().includes(q) || it.reference.toLowerCase().includes(q),
      );
    });

  return (
    <div className="page-fade-enter">
      <ScreenHeader title="Adhkar" subtitle="Morning, evening & every situation" showBack />

      {/* Daily sections — the due one leads, the other waits below */}
      <section>
        <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#6B7280]">
          Today
        </p>
        <button
          type="button"
          onClick={() => onOpen(dueIdx)}
          className="card-soft tap relative w-full overflow-hidden bg-[#E8E2FF]/60 border border-[#E8E2FF] p-5 text-left shadow-xs active:scale-[0.985]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="inline-flex rounded-full bg-[#7C5CFC] px-2.5 py-0.5 text-[10px] font-extrabold text-white">
                Now
              </span>
              <h2
                dir="rtl"
                lang="ar"
                className="mt-2 font-arabic text-2xl font-bold leading-snug text-[#12131A]"
              >
                {dueCat.name}
              </h2>
              <p className="mt-1 text-xs font-medium text-[#6B7280]">
                {dueTotal} {dueTotal === 1 ? "zikr" : "zikrs"} today
              </p>
            </div>
            <span
              className={`flex size-9 shrink-0 items-center justify-center rounded-full text-white shadow-xs ${
                dueDoneAll ? "bg-emerald-500" : "border border-black/5 bg-white text-[#12131A]"
              }`}
            >
              {dueDoneAll ? (
                <Check className="size-4" strokeWidth={3} />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </span>
          </div>
          <Progress value={duePct} className="mt-3 h-1.5" />
          <p className="mt-1.5 text-[11px] font-bold text-[#6B7280]">
            Done {dueDone} of {dueTotal}
          </p>
        </button>

        <button
          type="button"
          onClick={() => onOpen(otherIdx)}
          className="tap mt-2.5 flex w-full items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white px-4 py-3 shadow-xs active:scale-[0.98]"
        >
          <span className="text-[11px] font-extrabold uppercase tracking-wide text-[#6B7280]">
            {otherLabel}
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              dir="rtl"
              lang="ar"
              className="truncate font-arabic text-sm font-bold text-[#12131A]"
            >
              {azkarData[otherIdx].name}
            </span>
            <span className="shrink-0 text-[11px] font-bold text-[#6B7280]">
              {azkarData[otherIdx].items.length}
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-[#6B7280]/50" />
          </span>
        </button>
      </section>

      {/* All categories */}
      <div className="mt-6 flex items-center gap-2 rounded-2xl border border-black/5 bg-white px-3.5 py-2 text-xs shadow-xs">
        <Search className="size-4 text-[#6B7280]" />
        <input
          type="text"
          dir="auto"
          placeholder="Search zikrs or categories…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          className="w-full bg-transparent outline-none"
          aria-label="Search zikrs or categories"
        />
      </div>
      <div className="mt-5 mb-2 flex items-center justify-between">
        <h2 className="text-lg font-extrabold text-[#12131A]">
          {q ? "Matches" : "All categories"}
        </h2>
        <span className="text-xs font-bold text-[#6B7280]">
          {filtered.length} {filtered.length === 1 ? "category" : "categories"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="card-soft mt-2 border border-dashed border-black/10 bg-white p-6 text-center">
          <p className="text-sm font-bold text-[#12131A]">No zikr found</p>
          <p className="mt-1 text-xs text-[#6B7280]">
            Try a word from the zikr, its reference, or the category name.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(({ cat, idx }) => {
            const doneInCat = cat.items.filter(
              (item, i) => azkar.tapsFor(idx, i) >= item.count,
            ).length;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onOpen(idx)}
                className="card-soft tap flex w-full items-center justify-between gap-3 border border-black/5 bg-white p-4 text-left shadow-xs active:scale-[0.98] hover:shadow-md"
              >
                <span
                  dir="rtl"
                  lang="ar"
                  className="min-w-0 flex-1 truncate font-arabic text-[15px] font-bold leading-snug text-[#12131A]"
                >
                  {cat.name}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {doneInCat > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-extrabold text-emerald-600">
                      <Check className="size-2.5" strokeWidth={3.5} />
                      {doneInCat}
                    </span>
                  )}
                  <span className="text-[11px] font-bold text-[#6B7280]">
                    {cat.items.length} {cat.items.length === 1 ? "zikr" : "zikrs"}
                  </span>
                  <ChevronRight className="size-4 text-[#6B7280]/50" />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- Reader --------------------------------- */

function Reader({
  catIdx,
  zekrIdx,
  onZekrIdxChange,
  onBack,
  azkar,
}: {
  catIdx: number;
  zekrIdx: number;
  onZekrIdxChange: Dispatch<SetStateAction<number>>;
  onBack: () => void;
  azkar: AzkarApi;
}) {
  const cat = azkarData[catIdx];
  const total = cat.items.length;
  const item = cat.items[zekrIdx];
  const taps = Math.min(azkar.tapsFor(catIdx, zekrIdx), item.count);
  const remaining = item.count - taps;
  const done = remaining === 0;
  const isLast = zekrIdx === total - 1;

  // Auto-advance shortly after the last tap completes a zikr — unless the
  // user has already moved on manually (guarded by the index it started at).
  const [pendingFrom, setPendingFrom] = useState<number | null>(null);
  useEffect(() => {
    if (pendingFrom === null) return;
    const id = setTimeout(() => {
      setPendingFrom(null);
      onZekrIdxChange((current) => (current === pendingFrom ? pendingFrom + 1 : current));
    }, 1100);
    return () => clearTimeout(id);
  }, [pendingFrom, onZekrIdxChange]);

  const handleTap = () => {
    if (done) {
      if (!isLast) {
        setPendingFrom(null);
        onZekrIdxChange(zekrIdx + 1);
      }
      return;
    }
    azkar.recordTap(catIdx, zekrIdx);
    if (taps + 1 >= item.count) {
      sounds.playSuccess();
      if (isLast) {
        toast.success(`All ${total} ${total === 1 ? "zikr" : "zikrs"} done today`);
      } else {
        setPendingFrom(zekrIdx);
      }
    } else {
      sounds.playActionClick();
    }
  };

  const caption = done
    ? `Completed — ${item.count > 1 ? `${item.count}×` : "once"}`
    : taps === 0
      ? item.count > 1
        ? `Tap the card to count ${item.count}×`
        : "Tap the card to recite"
      : "Keep tapping to count";

  return (
    <div className="page-fade-enter">
      <header className="mb-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to categories"
          className="tap flex size-9 shrink-0 items-center justify-center rounded-full border border-black/5 bg-white text-[#12131A] shadow-xs hover:bg-black/5"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <h1
            dir="rtl"
            lang="ar"
            className="truncate font-arabic text-lg font-bold leading-snug text-[#12131A]"
          >
            {cat.name}
          </h1>
          <p className="mt-0.5 text-[11px] font-bold text-[#6B7280]">
            zikr {zekrIdx + 1} of {total}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onZekrIdxChange(Math.max(0, zekrIdx - 1))}
            disabled={zekrIdx === 0}
            aria-label="Previous zikr"
            className="tap flex size-9 items-center justify-center rounded-full border border-black/5 bg-white text-[#12131A] shadow-xs disabled:opacity-30"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onZekrIdxChange(Math.min(total - 1, zekrIdx + 1))}
            disabled={isLast}
            aria-label="Next zikr"
            className="tap flex size-9 items-center justify-center rounded-full border border-black/5 bg-white text-[#12131A] shadow-xs disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </header>

      <Progress
        value={total > 1 ? Math.round(((zekrIdx + 1) / total) * 100) : 100}
        className="mb-4 h-1"
      />

      <div className="card-soft border border-black/5 bg-white p-5 text-center shadow-xs sm:p-6">
        {item.reference && (
          <div className="flex items-center justify-center gap-1.5">
            <BookOpenText className="size-3.5 shrink-0 text-[#6B7280]" />
            <span
              dir="rtl"
              lang="ar"
              className="font-arabic text-[13px] font-semibold text-[#6B7280]"
            >
              {item.reference}
            </span>
          </div>
        )}

        {/* The recitation itself is the counter: one tap, one repetition. */}
        <button
          type="button"
          onClick={handleTap}
          aria-label={done ? "Zikr completed" : `Count one repetition (${taps} of ${item.count})`}
          className="tap mt-4 w-full rounded-3xl text-center active:scale-[0.985]"
        >
          <p
            dir="rtl"
            lang="ar"
            className="font-arabic whitespace-pre-line text-[1.3rem] font-normal leading-[2.05] text-[#12131A]"
          >
            {item.text}
          </p>
          <div className="mt-6">
            <BeadRing count={item.count} taps={taps} />
          </div>
          <p className="mt-4 text-[11px] font-bold text-[#6B7280]">{caption}</p>
        </button>

        {item.description && (
          <p
            dir="rtl"
            lang="ar"
            className="mt-5 border-t border-black/5 pt-4 text-right font-arabic text-[13px] leading-[1.95] text-[#6B7280]"
          >
            {item.description}
          </p>
        )}

        {taps > 0 && !done && (
          <button
            type="button"
            onClick={() => azkar.resetZekr(catIdx, zekrIdx)}
            className="tap mx-auto mt-4 flex items-center gap-1 rounded-full bg-black/5 px-3.5 py-1.5 text-[11px] font-bold text-[#6B7280] hover:bg-black/10"
          >
            <RotateCcw className="size-3" /> Reset this zikr
          </button>
        )}

        {done && !isLast && (
          <button
            type="button"
            onClick={() => {
              setPendingFrom(null);
              onZekrIdxChange(zekrIdx + 1);
            }}
            className="tap mt-5 flex w-full items-center justify-center gap-1.5 rounded-full bg-[#12131A] py-3 text-xs font-extrabold text-white shadow-md active:scale-[0.97]"
          >
            Next zikr <ChevronRight className="size-4" />
          </button>
        )}

        {done && isLast && (
          <button
            type="button"
            onClick={onBack}
            className="tap mt-5 flex w-full items-center justify-center gap-1.5 rounded-full bg-[#12131A] py-3 text-xs font-extrabold text-white shadow-md active:scale-[0.97]"
          >
            All {total} {total === 1 ? "zikr" : "zikrs"} done — back to categories
          </button>
        )}
      </div>
    </div>
  );
}

/* -------------------------------- BeadRing ------------------------------- */

/**
 * The misbaha, drawn as a ring of beads that fill one tap at a time. The ring
 * caps at 99 beads; the center always shows the true remaining count.
 */
function BeadRing({ count, taps }: { count: number; taps: number }) {
  const beads = Math.max(1, Math.min(count, 99));
  const filled = Math.min(taps, beads);
  const done = taps >= count;
  const remaining = Math.max(0, count - filled);
  const radius = 76;
  const beadRadius = beads >= 40 ? 3.5 : beads >= 12 ? 5 : beads >= 4 ? 6.5 : 9;
  const size = 176;

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg viewBox="0 0 200 200" width={size} height={size} aria-hidden="true" focusable="false">
        <circle cx="100" cy="100" r={radius} fill="none" stroke="#F3EDFC" strokeWidth="8" />
        {Array.from({ length: beads }, (_, i) => {
          const angle = (i / beads) * Math.PI * 2 - Math.PI / 2;
          return (
            <circle
              key={i}
              cx={100 + radius * Math.cos(angle)}
              cy={100 + radius * Math.sin(angle)}
              r={beadRadius}
              fill={done ? "#10B981" : i < filled ? "#7C5CFC" : "#E8E2FF"}
              style={{ transition: "fill 0.25s ease" }}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {done ? (
          <CheckCircle2 className="size-11 text-[#10B981]" strokeWidth={2.5} />
        ) : (
          <>
            <span className="text-4xl font-black tabular-nums leading-none text-[#12131A]">
              {remaining}
            </span>
            <span className="mt-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#6B7280]">
              {remaining === 1 ? "tap left" : "taps left"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
