import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from "recharts";
import { TrendingUp, Footprints, Clock, Zap, Award, Target } from "lucide-react";
import { getAggregatedStats, getWalkSummaries } from "@/lib/walk-storage";
import type { AggregatedWalkStats, WalkSummary } from "@/lib/types";
import { formatPace, formatDuration } from "@/lib/walk-gps-utils";

interface PersonalStatsProps {
  userId: string;
}

/**
 * Personal fitness stats view with weekly/monthly charts.
 * Clean, data-focused design—no social features.
 */
export default function PersonalStats({ userId }: PersonalStatsProps) {
  const [stats, setStats] = useState<AggregatedWalkStats | null>(null);
  const [weeklyData, setWeeklyData] = useState<{ day: string; distance: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userId) {
      loadStats();
    }
  }, [userId]);

  async function loadStats() {
    setLoading(true);
    try {
      const aggregated = await getAggregatedStats(userId);
      setStats(aggregated);

      // Get last 7 days of walks for chart
      const allSummaries = await getWalkSummaries(userId, 100);
      const last7Days = getLast7Days();
      
      const weeklyChart = last7Days.map((date) => {
        const dayWalks = allSummaries.filter(
          (s) => s.day === date && s.status === "finished"
        );
        const totalDistance = dayWalks.reduce((sum, w) => sum + w.distance, 0);
        
        return {
          day: new Date(date).toLocaleDateString("en-US", { weekday: "short" }),
          distance: totalDistance / 1000, // Convert to km
        };
      });

      setWeeklyData(weeklyChart);
    } catch (error) {
      console.error("Failed to load stats:", error);
    } finally {
      setLoading(false);
    }
  }

  function getLast7Days(): string[] {
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      days.push(date.toISOString().split("T")[0]);
    }
    return days;
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-32 rounded-xl bg-slate-100 animate-pulse" />
        <div className="h-48 rounded-xl bg-slate-100 animate-pulse" />
      </div>
    );
  }

  if (!stats || stats.total_walks === 0) {
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
      {/* Headline metrics */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={<Footprints className="size-5 text-[#7C5CFC]" />}
          label="Total Walks"
          value={stats.total_walks.toString()}
          color="purple"
        />
        <StatCard
          icon={<TrendingUp className="size-5 text-[#22C55E]" />}
          label="Total Distance"
          value={`${(stats.total_distance / 1000).toFixed(1)} km`}
          color="green"
        />
        <StatCard
          icon={<Clock className="size-5 text-[#F97316]" />}
          label="Total Time"
          value={formatDuration(stats.total_duration)}
          color="orange"
        />
        <StatCard
          icon={<Zap className="size-5 text-[#EAB308]" />}
          label="Total Steps"
          value={stats.total_steps.toLocaleString()}
          color="yellow"
        />
      </div>

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
            <RecordRow
              label="Average Speed"
              value={avgSpeedKmh.toFixed(1)}
              unit="km/h"
            />
          )}
          <RecordRow
            label="Longest Walk"
            value={
              stats.longest_distance
                ? (stats.longest_distance / 1000).toFixed(2)
                : "0"
            }
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
                <Cell
                  key={`cell-${index}`}
                  fill={entry.distance > 0 ? "#7C5CFC" : "#E2E8F0"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[10px] font-bold text-[#64748B] text-center mt-2">
          Daily distance (km)
        </p>
      </div>
    </div>
  );
}

function StatCard({
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
      <div className={`inline-flex rounded-lg p-2 ${bgColors[color]} mb-2`}>
        {icon}
      </div>
      <p className="text-xs font-bold uppercase tracking-wide text-[#64748B] mb-1">
        {label}
      </p>
      <p className="text-xl font-black tabular-nums text-[#0A0E27]">{value}</p>
    </div>
  );
}

function RecordRow({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
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
