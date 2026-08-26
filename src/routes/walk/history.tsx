import { useState, lazy, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MapPin, Clock, Footprints, Calendar, Filter } from "lucide-react";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { useAuth } from "@/hooks/use-auth";
import { useData } from "@/lib/data-context";
import { getWalkSummary } from "@/lib/walk-storage";
import { WalkSummaryModal } from "@/routes/walk";
import type { WalkSession, WalkSummary } from "@/lib/types";
import { formatPace, formatDuration } from "@/lib/walk-gps-utils";
import { parseLocalDate } from "@/lib/date-utils";

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
  const { walkSessions } = useData();
  const [selectedSummary, setSelectedSummary] = useState<WalkSummary | null>(null);
  const [selectedSession, setSelectedSession] = useState<WalkSession | null>(null);
  const [filter, setFilter] = useState<"all" | "week" | "month">("all");

  // Same Firestore source as the Walking page's history section, so "View All"
  // always lists exactly what the main screen counts (never diverged by a
  // wiped local SQLite database).
  const sessions = walkSessions
    .filter((s) => s.status === "finished")
    .sort((a, b) =>
      (b.finished_at || b.started_at || b.created_at).localeCompare(
        a.finished_at || a.started_at || a.created_at,
      ),
    );

  const filteredSessions = sessions.filter((s) => {
    if (filter === "all") return true;
    const walkDay =
      s.day ||
      (s.started_at ? s.started_at.slice(0, 10) : s.created_at ? s.created_at.slice(0, 10) : "");
    if (!walkDay) return true;
    // Parse as LOCAL midnight (new Date("YYYY-MM-DD") is UTC midnight, which
    // shifts the day boundary for non-UTC users and skews the week/month diff).
    const walkDate = parseLocalDate(walkDay);
    walkDate.setHours(0, 0, 0, 0);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diffDays = Math.round((now.getTime() - walkDate.getTime()) / (1000 * 60 * 60 * 24));

    if (filter === "week") return diffDays <= 7;
    if (filter === "month") return diffDays <= 30;
    return true;
  });

  // Single completion experience: prefer the full local summary (splits,
  // elevation, route map) but fall back to the session itself when the
  // local SQLite summary is missing (e.g. right after a reinstall).
  const handleSelect = async (session: WalkSession) => {
    try {
      const summary = await getWalkSummary(session.id);
      if (summary) {
        setSelectedSummary(summary);
      } else {
        setSelectedSession(session);
      }
    } catch (error) {
      console.error("Failed to load walk summary:", error);
      setSelectedSession(session);
    }
  };

  return (
    <Screen>
      <ScreenHeader title="Walk History" showBack />

      <div className="py-4 space-y-4">
        {/* Filter tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            onClick={() => setFilter("all")}
            className={`tap px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC] ${
              filter === "all"
                ? "bg-[#7C5CFC] text-white shadow-sm"
                : "bg-white text-[#64748B] border border-slate-200 hover:bg-slate-50"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter("week")}
            className={`tap px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC] ${
              filter === "week"
                ? "bg-[#7C5CFC] text-white shadow-sm"
                : "bg-white text-[#64748B] border border-slate-200 hover:bg-slate-50"
            }`}
          >
            This Week
          </button>
          <button
            onClick={() => setFilter("month")}
            className={`tap px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC] ${
              filter === "month"
                ? "bg-[#7C5CFC] text-white shadow-sm"
                : "bg-white text-[#64748B] border border-slate-200 hover:bg-slate-50"
            }`}
          >
            This Month
          </button>
        </div>

        {/* Summary count */}
        <div className="text-sm font-bold text-[#64748B]">
          {filteredSessions.length} {filteredSessions.length === 1 ? "walk" : "walks"}
        </div>

        {/* Empty state */}
        {filteredSessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <MapPin className="size-12 text-[#64748B]/40 mb-3" />
            <p className="text-sm font-black text-[#0A0E27]">No walks yet</p>
            <p className="text-xs font-semibold text-[#64748B] mt-1">
              Start your first walk to see your history here
            </p>
          </div>
        )}

        {/* Walk list */}
        {filteredSessions.length > 0 && (
          <div className="space-y-3 pb-20">
            {filteredSessions.map((session) => (
              <WalkHistoryCard
                key={session.id}
                session={session}
                onClick={() => handleSelect(session)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail modal — full Strava summary */}
      {(selectedSummary || selectedSession) && (
        <Suspense fallback={null}>
          <EnhancedWalkSummary
            summary={selectedSummary}
            session={selectedSession}
            onClose={() => {
              setSelectedSummary(null);
              setSelectedSession(null);
            }}
          />
        </Suspense>
      )}
    </Screen>
  );
}

function WalkHistoryCard({ session, onClick }: { session: WalkSession; onClick: () => void }) {
  const path = session.path && session.path.length >= 2 ? session.path : null;
  const hasRoute = !!path;
  const first = path ? path[0] : null;
  const last = path ? path[path.length - 1] : null;
  const date = new Date(session.finished_at || session.started_at || session.created_at);
  const isToday = new Date().toDateString() === date.toDateString();

  const avgPace =
    (session.distance || 0) >= 100 && (session.duration || 0) > 0
      ? (session.duration || 0) / ((session.distance || 0) / 1000)
      : null;

  return (
    <button
      onClick={onClick}
      className="tap w-full text-left rounded-xl bg-white border border-slate-200 overflow-hidden hover:border-[#7C5CFC] hover:shadow-lg transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC] focus-visible:ring-offset-2"
    >
      {/* Thumbnail map */}
      {hasRoute && first && last ? (
        <Suspense
          fallback={
            <div className="h-32 bg-slate-100 flex items-center justify-center">
              <MapPin className="size-5 text-[#64748B]/40" />
            </div>
          }
        >
          <div className="h-32 relative">
            <RouteMapGL
              points={path}
              startLat={first.lat}
              startLng={first.lng}
              endLat={last.lat}
              endLng={last.lng}
              height={128}
              interactive={false}
              showMarkers={true}
              showKmMarkers={false}
              allowFullscreen={false}
              allowLayerToggle={false}
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
          {session.vehicle && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-800">
              Vehicle
            </span>
          )}
        </div>

        {/* Primary metric */}
        <div className="flex items-end gap-1.5 mb-3">
          <span className="text-3xl font-black tabular-nums text-[#0A0E27]">
            {((session.distance || 0) / 1000).toFixed(2)}
          </span>
          <span className="pb-1 text-sm font-bold text-[#64748B]">km</span>
        </div>

        {/* Secondary metrics grid */}
        <div className="grid grid-cols-3 gap-2">
          <div className="flex items-center gap-1.5">
            <Clock className="size-3.5 text-[#7C5CFC]" />
            <div>
              <p className="text-[11px] font-bold uppercase text-[#64748B]">Time</p>
              <p className="text-xs font-black tabular-nums text-[#0A0E27]">
                {formatDuration(session.duration || 0)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="size-3.5 text-[#22C55E]" />
            <div>
              <p className="text-[11px] font-bold uppercase text-[#64748B]">Pace</p>
              <p className="text-xs font-black tabular-nums text-[#0A0E27]">
                {avgPace ? formatPace(avgPace) : "--:--"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Footprints className="size-3.5 text-[#F97316]" />
            <div>
              <p className="text-[11px] font-bold uppercase text-[#64748B]">Steps</p>
              <p className="text-xs font-black tabular-nums text-[#0A0E27]">
                {(session.steps || 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}
