"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
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
    return <div className="p-6 text-gray-500 text-sm">Loading traffic data...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Traffic Analytics</h1>
        <p className="text-sm text-gray-500">Real-time traffic density and congestion monitoring</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Avg Speed", value: `${avgSpeed} km/h`, color: "text-cyan-400" },
          { label: "Vehicle Volume", value: `${totalVolume}`, color: "text-blue-400" },
          { label: "Congestion Index", value: `${avgCongestion}/100`, color: "text-orange-400" },
          { label: "Hotspots", value: `${congestionByType.length}`, color: "text-purple-400" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <div className="p-4">
              <div className="text-[10px] uppercase tracking-widest text-gray-500">{kpi.label}</div>
              <div className={`text-xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader><span className="text-sm font-medium text-gray-300">Event Distribution by Hour</span></CardHeader>
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourlyTraffic}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="hour" tick={{ fontSize: 8, fill: "#9ca3af" }} interval={2} />
                <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} />
                <Tooltip contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: "6px", fontSize: "11px" }} />
                <Area type="monotone" dataKey="events" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader><span className="text-sm font-medium text-gray-300">Congestion by Zone (from heatmap)</span></CardHeader>
          <div className="p-4 h-64">
            {congestionByType.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-600 text-xs">
                No heatmap data — run demo seed first
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={congestionByType} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "#9ca3af" }} />
                  <YAxis dataKey="type" type="category" tick={{ fontSize: 9, fill: "#9ca3af" }} width={90} />
                  <Tooltip contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: "6px", fontSize: "11px" }} />
                  <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                    {congestionByType.map((entry, i) => (
                      <Cell key={i} fill={entry.score > 70 ? "#ef4444" : entry.score > 40 ? "#eab308" : "#22c55e"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader><span className="text-sm font-medium text-gray-300">Events by Hour</span></CardHeader>
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hourlyTraffic}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="hour" tick={{ fontSize: 8, fill: "#9ca3af" }} interval={2} />
                <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} />
                <Tooltip contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: "6px", fontSize: "11px" }} />
                <Line type="monotone" dataKey="events" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader><span className="text-sm font-medium text-gray-300">Confidence Trend</span></CardHeader>
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hourlyTraffic}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="hour" tick={{ fontSize: 8, fill: "#9ca3af" }} interval={2} />
                <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} />
                <Tooltip contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: "6px", fontSize: "11px" }} />
                <Line type="monotone" dataKey="avgConfidence" stroke="#f97316" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader><span className="text-xs text-gray-400">Traffic Hotspots</span></CardHeader>
        <div className="p-4 grid grid-cols-3 gap-3">
          {congestionByType.filter((c) => c.score > 40).length === 0 && (
            <div className="text-gray-600 text-xs">No hotspots detected — run demo seed to populate</div>
          )}
          {congestionByType.filter((c) => c.score > 40).map((zone) => (
            <div key={zone.type} className="p-3 bg-gray-800/50 rounded">
              <div className="text-xs font-medium text-white">{zone.type}</div>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${zone.score}%`, backgroundColor: zone.score > 70 ? "#ef4444" : "#eab308" }} />
                </div>
                <span className="text-[10px] text-gray-400">{zone.score}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

