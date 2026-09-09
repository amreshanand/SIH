"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardHeader, KpiCard } from "@/components/ui/Card";
import { Event, TrafficRecord } from "@/types";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area, Cell,
} from "recharts";

interface HeatmapEntry {
  road_segment: string;
  avg_congestion: number;
  record_count: number;
  latitude: number;
  longitude: number;
}

export default function TrafficPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [trafficRecords, setTrafficRecords] = useState<TrafficRecord[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getEvents({ event_type: "TRAFFIC_CONGESTION" }).then((r) => setEvents(r.events)).catch(() => {}),
      api.getTraffic().then((r) => setTrafficRecords(r.traffic)).catch(() => {}),
      api.getTrafficHeatmap().then((r) => setHeatmap(r.heatmap)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const hourlyTraffic = Array.from({ length: 24 }, (_, h) => {
    const hourEvents = events.filter((e) => new Date(e.created_at).getHours() === h);
    return {
      hour: `${h}:00`,
      events: hourEvents.length,
      avgConfidence: hourEvents.length
        ? Math.round((hourEvents.reduce((s, e) => s + e.confidence, 0) / hourEvents.length) * 100)
        : 0,
    };
  });

  const congestionByType = heatmap.map((h) => ({
    type: h.road_segment || "Unknown",
    score: Math.round(h.avg_congestion),
    count: h.record_count,
  }));

  const avgSpeed = trafficRecords.length
    ? (trafficRecords.reduce((s, r) => s + (r.average_speed || 0), 0) / trafficRecords.length).toFixed(1)
    : "0";
  const avgCongestion = trafficRecords.length
    ? Math.round(trafficRecords.reduce((s, r) => s + (r.congestion_score || 0), 0) / trafficRecords.length)
    : 0;
  const totalVolume = trafficRecords.reduce((s, r) => s + (r.vehicle_count || 0), 0);

  if (loading) {
    return <div className="p-6 text-slate-500 text-xs font-mono">Loading traffic telemetry...</div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-xl font-bold text-slate-900">Traffic Density & Corridor Analytics</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Real-time vehicular counts, corridor speeds, and automated bottleneck detection
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Average Speed" value={`${avgSpeed} km/h`} color="blue" subtitle="Corridor transit telemetry" />
        <KpiCard label="Vehicle Volume" value={`${totalVolume}`} color="blue" subtitle="Observed vehicle count" />
        <KpiCard label="Congestion Index" value={`${avgCongestion} / 100`} color="amber" subtitle="Network friction rating" />
        <KpiCard label="Active Bottlenecks" value={`${congestionByType.length}`} color="red" subtitle="Congested road segments" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              Congestion Events by Hour (24h Profile)
            </span>
          </CardHeader>
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourlyTraffic}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "#64748b" }} interval={2} />
                <YAxis tick={{ fontSize: 9, fill: "#64748b" }} />
                <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "4px", fontSize: "11px", color: "#0f172a" }} />
                <Area type="monotone" dataKey="events" stroke="#2563eb" fill="#2563eb" fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              Corridor Congestion Index
            </span>
          </CardHeader>
          <div className="p-4 h-64">
            {congestionByType.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-400 text-xs">
                No corridor telemetry logged yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={congestionByType} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fontSize: 9, fill: "#64748b" }} />
                  <YAxis dataKey="type" type="category" tick={{ fontSize: 9, fill: "#64748b" }} width={110} />
                  <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "4px", fontSize: "11px", color: "#0f172a" }} />
                  <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                    {congestionByType.map((entry, i) => (
                      <Cell key={i} fill={entry.score > 70 ? "#dc2626" : entry.score > 40 ? "#d97706" : "#16a34a"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              Hourly Event Frequency
            </span>
          </CardHeader>
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hourlyTraffic}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "#64748b" }} interval={2} />
                <YAxis tick={{ fontSize: 9, fill: "#64748b" }} />
                <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "4px", fontSize: "11px", color: "#0f172a" }} />
                <Line type="monotone" dataKey="events" stroke="#16a34a" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              Mean Detection Confidence Trend
            </span>
          </CardHeader>
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hourlyTraffic}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "#64748b" }} interval={2} />
                <YAxis tick={{ fontSize: 9, fill: "#64748b" }} />
                <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "4px", fontSize: "11px", color: "#0f172a" }} />
                <Line type="monotone" dataKey="avgConfidence" stroke="#d97706" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Corridor Breakdown */}
      <Card>
        <CardHeader>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
            High Congestion Corridors
          </span>
        </CardHeader>
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          {congestionByType.filter((c) => c.score > 40).length === 0 && (
            <div className="text-slate-500 text-xs col-span-3 text-center py-4">
              All monitored corridors operating within normal flow parameters (index ≤ 40).
            </div>
          )}
          {congestionByType.filter((c) => c.score > 40).map((zone) => (
            <div key={zone.type} className="p-3 bg-slate-50 rounded border border-slate-200">
              <div className="text-xs font-bold text-slate-900">{zone.type}</div>
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${zone.score}%`,
                      backgroundColor: zone.score > 70 ? "#dc2626" : "#d97706",
                    }}
                  />
                </div>
                <span className="text-xs font-mono font-semibold text-slate-700">{zone.score}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
