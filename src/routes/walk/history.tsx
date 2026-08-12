import { useState, useEffect, lazy, Suspense } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, MapPin, Clock, Footprints, TrendingUp, Calendar, Filter } from "lucide-react";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { useAuth } from "@/hooks/use-auth";
import { getWalkSummaries } from "@/lib/walk-storage";
import type { WalkSummary } from "@/lib/types";
import { formatPace, formatDuration, formatDistance } from "@/lib/walk-gps-utils";

const EnhancedWalkSummary = lazy(() => import("@/components/lifehub/EnhancedWalkSummary"));
const RouteMapGL = lazy(() => import("@/components/lifehub/RouteMapGL"));

export const Route = createFileRoute("/walk/history")({
  head: () => ({
    meta: [{ title: "Walk History — Past Activities" }],
  }),
  component: WalkHistoryPage,
});

function WalkHistoryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [summaries, setSummaries] = useState<WalkSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSummary, setSelectedSummary] = useState<WalkSummary | null>(null);
  const [filter, setFilter] = useState<"all" | "week" | "month">("all");

  useEffect(() => {
    if (user?.id) {
      loadHistory();
    }
  }, [user?.id]);

  async function loadHistory() {
    if (!user?.id) return;
    setLoading(true);
    try {
      const data = await getWalkSummaries(user.id, 100);
      setSummaries(data);
    } catch (error) {
      console.error("Failed to load walk history:", error);
    } finally {
      setLoading(false);
    }
  }

  const filteredSummaries = summaries.filter((s) => {
    if (filter === "all") return true;
    const walkDate = new Date(s.day);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - walkDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (filter === "week") return diffDays <= 7;
    if (filter === "month") return diffDays <= 30;
    return true;
  });

  return (
    <Screen>
      <ScreenHeader
        title="Walk History"
        showBack
      />

      <div className="px-4 py-4 space-y-4">
        {/* Filter tabs */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              filter === "all"
                ? "bg-[#7C5CFC] text-white"
                : "bg-white text-[#64748B] border border-slate-200 hover:bg-slate-50"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter("week")}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              filter === "week"
                ? "bg-[#7C5CFC] text-white"
                : "bg-white text-[#64748B] border border-slate-200 hover:bg-slate-50"
            }`}
          >
            This Week
          </button>
          <button
            onClick={() => setFilter("month")}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              filter === "month"
                ? "bg-[#7C5CFC] text-white"
                : "bg-white text-[#64748B] border border-slate-200 hover:bg-slate-50"
            }`}
          >
            This Month
          </button>
        </div>

        {/* Summary count */}
        <div className="text-sm font-bold text-[#64748B]">
          {filteredSummaries.length} {filteredSummaries.length === 1 ? "walk" : "walks"}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && filteredSummaries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <MapPin className="size-12 text-[#64748B]/40 mb-3" />
            <p className="text-sm font-black text-[#0A0E27]">No walks yet</p>
            <p className="text-xs font-semibold text-[#64748B] mt-1">
              Start your first walk to see your history here
            </p>
          </div>
        )}

        {/* Walk list */}
        {!loading && filteredSummaries.length > 0 && (
          <div className="space-y-3 pb-20">
            {filteredSummaries.map((summary) => (
              <WalkHistoryCard
                key={summary.id}
                summary={summary}
                onClick={() => setSelectedSummary(summary)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedSummary && (
        <Suspense fallback={null}>
          <EnhancedWalkSummary
            summary={selectedSummary}
            onClose={() => setSelectedSummary(null)}
          />
        </Suspense>
      )}
    </Screen>
  );
}

function WalkHistoryCard({
  summary,
  onClick,
}: {
  summary: WalkSummary;
  onClick: () => void;
}) {
  const hasRoute = !!summary.encoded_polyline || (summary.start_lat && summary.start_lng);
  const date = new Date(summary.finished_at || summary.started_at);
  const isToday = new Date().toDateString() === date.toDateString();

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl bg-white border border-slate-200 overflow-hidden hover:border-[#7C5CFC] hover:shadow-lg transition-all active:scale-[0.98]"
    >
      {/* Thumbnail map */}
      {hasRoute ? (
        <Suspense
          fallback={
            <div className="h-32 bg-slate-100 flex items-center justify-center">
              <MapPin className="size-5 text-[#64748B]/40" />
            </div>
          }
        >
          <div className="h-32 relative">
            <RouteMapGL
              encodedPolyline={summary.encoded_polyline || undefined}
              startLat={summary.start_lat}
              startLng={summary.start_lng}
              endLat={summary.end_lat}
              endLng={summary.end_lng}
              height={128}
              interactive={false}
              showMarkers={false}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent pointer-events-none" />
          </div>
        </Suspense>
      ) : (
        <div className="h-32 bg-slate-50 flex items-center justify-center border-b border-slate-200">
          <MapPin className="size-6 text-[#64748B]/40" />
        </div>
      )}

      {/* Metrics */}
      <div className="p-4">
        {/* Date */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Calendar className="size-3.5 text-[#64748B]" />
            <span className="text-xs font-bold text-[#64748B]">
              {isToday ? "Today" : date.toLocaleDateString([], { month: "short", day: "numeric" })}
            </span>
            <span className="text-xs font-semibold text-[#64748B]/60">
              {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          {summary.vehicle_flagged && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black text-amber-800">
              Vehicle
            </span>
          )}
        </div>

        {/* Primary metric */}
        <div className="flex items-end gap-1.5 mb-3">
          <span className="text-3xl font-black tabular-nums text-[#0A0E27]">
            {(summary.distance / 1000).toFixed(2)}
          </span>
          <span className="pb-1 text-sm font-bold text-[#64748B]">km</span>
        </div>

        {/* Secondary metrics grid */}
        <div className="grid grid-cols-3 gap-2">
          <div className="flex items-center gap-1.5">
            <Clock className="size-3.5 text-[#7C5CFC]" />
            <div>
              <p className="text-[10px] font-bold uppercase text-[#64748B]">Time</p>
              <p className="text-xs font-black tabular-nums text-[#0A0E27]">
                {formatDuration(summary.duration)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <TrendingUp className="size-3.5 text-[#22C55E]" />
            <div>
              <p className="text-[10px] font-bold uppercase text-[#64748B]">Pace</p>
              <p className="text-xs font-black tabular-nums text-[#0A0E27]">
                {summary.avg_pace ? formatPace(summary.avg_pace) : "--:--"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Footprints className="size-3.5 text-[#F97316]" />
            <div>
              <p className="text-[10px] font-bold uppercase text-[#64748B]">Steps</p>
              <p className="text-xs font-black tabular-nums text-[#0A0E27]">
                {summary.steps.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}
