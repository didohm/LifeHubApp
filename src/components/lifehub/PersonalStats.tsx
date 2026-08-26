import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from "recharts";
import { Award, Target } from "lucide-react";
import type { WalkSession, AggregatedWalkStats } from "@/lib/types";
import { formatPace } from "@/lib/walk-gps-utils";
import { todayLocalDate } from "@/lib/api";

interface PersonalStatsProps {
  userId: string;
  /**
   * Finished walk sessions loaded from Firestore — the SAME source used by
   * Walk History. Previously this component aggregated the local SQLite
   * walk_summaries table, which diverged from Firestore (e.g. after an
   * app reinstall wiped SQLite): History showed 18 walks while Analytics
   * reported "No walks recorded yet".
   */
  walkSessions: WalkSession[];
}

/**
 * Personal records + last-7-days trend card.
 * Clean, data-focused design—no social features.
 *
 * All aggregates are computed from the Firestore walk sessions (status
 * "finished" only, matching the Walk History filter), so the records and
 * the history list always show identical numbers.
 */
export default function PersonalStats({ userId, walkSessions }: PersonalStatsProps) {
  const finished = useMemo(
    () => walkSessions.filter((s) => s.status === "finished"),
    [walkSessions],
  );

  // Mirrors the SQL aggregation previously done in WalkDatabaseHelper:
  // total_walks / total_distance / total_duration / total_steps over all
  // finished sessions, plus avg pace (average of per-walk pace, sec/km),
  // longest distance and fastest pace.
  const stats: AggregatedWalkStats = useMemo(() => {
    const totalDistance = finished.reduce((sum, w) => sum + (w.distance || 0), 0);
    const totalDuration = finished.reduce((sum, w) => sum + (w.duration || 0), 0);
    const totalSteps = finished.reduce((sum, w) => sum + (w.steps || 0), 0);
    const totalCalories = finished.reduce((sum, w) => sum + (w.calories || 0), 0);

    const paces = finished
      .map((w) => {
        const km = (w.distance || 0) / 1000;
        return km >= 0.1 && (w.duration || 0) > 0 ? (w.duration || 0) / km : null;
      })
      .filter((p): p is number => p !== null);

    return {
      total_walks: finished.length,
      total_distance: totalDistance,
      total_duration: totalDuration,
      total_steps: totalSteps,
      total_calories: totalCalories,
      avg_pace: paces.length > 0 ? paces.reduce((a, b) => a + b, 0) / paces.length : null,
      longest_distance:
        finished.length > 0 ? Math.max(...finished.map((w) => w.distance || 0)) : null,
      fastest_pace: paces.length > 0 ? Math.min(...paces) : null,
    };
  }, [finished]);

  // Last 7 days of walks for chart (local calendar days)
  const weeklyData = useMemo(() => {
    const dates: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(todayLocalDate(d));
    }
    return dates.map((date) => {
      const dayWalks = finished.filter((s) => {
        const walkDay =
          s.day ||
          (s.started_at
            ? s.started_at.slice(0, 10)
            : s.created_at
              ? s.created_at.slice(0, 10)
              : "");
        return walkDay === date;
      });
      const totalDistance = dayWalks.reduce((sum, w) => sum + (w.distance || 0), 0);
      return {
        day: new Date(date).toLocaleDateString("en-US", { weekday: "short" }),
        distance: totalDistance / 1000, // Convert to km
      };
    });
  }, [finished]);

  if (stats.total_walks === 0) {
    return (
      <div className="rounded-xl bg-white border border-slate-200 p-6 text-center">
        <Target className="size-8 text-[#64748B]/40 mx-auto mb-2" />
        <p className="text-sm font-black text-[#0A0E27]">No walks recorded yet</p>
        <p className="text-xs font-semibold text-[#64748B] mt-1">
          Start walking to see your stats here
        </p>
      </div>
    );
  }

  const avgSpeedKmh = stats.avg_pace ? 3600 / stats.avg_pace : null;

  return (
    <div className="space-y-4">
      {/* Records */}
      <div className="rounded-xl bg-white border border-slate-200 p-4">
        <h3 className="text-xs font-black uppercase tracking-wide text-[#64748B] mb-3 flex items-center gap-2">
          <Award className="size-4" />
          Personal Records
        </h3>
        <div className="space-y-3">
          <RecordRow
            label="Average Pace"
            value={stats.avg_pace ? formatPace(stats.avg_pace) : "--:--"}
            unit="per km"
          />
          {avgSpeedKmh && (
            <RecordRow label="Average Speed" value={avgSpeedKmh.toFixed(1)} unit="km/h" />
          )}
          <RecordRow
            label="Longest Walk"
            value={stats.longest_distance ? (stats.longest_distance / 1000).toFixed(2) : "0"}
            unit="km"
          />
          <RecordRow
            label="Fastest Pace"
            value={stats.fastest_pace ? formatPace(stats.fastest_pace) : "--:--"}
            unit="per km"
          />
        </div>
      </div>

      {/* Weekly distance chart */}
      <div className="rounded-xl bg-white border border-slate-200 p-4">
        <h3 className="text-xs font-black uppercase tracking-wide text-[#64748B] mb-3">
          Last 7 Days
        </h3>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={weeklyData}>
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fontWeight: 700, fill: "#64748B" }}
            />
            <YAxis hide />
            <Bar dataKey="distance" radius={[6, 6, 0, 0]}>
              {weeklyData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.distance > 0 ? "#7C5CFC" : "#E2E8F0"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[11px] font-bold text-[#64748B] text-center mt-2">Daily distance (km)</p>
      </div>
    </div>
  );
}

export function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: "purple" | "green" | "orange" | "yellow";
}) {
  const bgColors = {
    purple: "bg-[#7C5CFC]/10",
    green: "bg-[#22C55E]/10",
    orange: "bg-[#F97316]/10",
    yellow: "bg-[#EAB308]/10",
  };

  return (
    <div className="rounded-xl bg-white border border-slate-200 p-4">
      <div className={`inline-flex rounded-lg p-2 ${bgColors[color]} mb-2`}>{icon}</div>
      <p className="text-xs font-bold uppercase tracking-wide text-[#64748B] mb-1">{label}</p>
      <p className="text-xl font-black tabular-nums text-[#0A0E27]">{value}</p>
    </div>
  );
}

function RecordRow({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm font-bold text-[#64748B]">{label}</span>
      <div className="flex items-baseline gap-1">
        <span className="text-lg font-black tabular-nums text-[#0A0E27]">{value}</span>
        <span className="text-xs font-bold text-[#64748B]">{unit}</span>
      </div>
    </div>
  );
}
