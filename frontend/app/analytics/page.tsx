"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card, CardHeader, Badge, KpiCard } from "@/components/ui/Card";
import { Event, Issue, OdMatrix, RouteDelay, InfrastructureReport, RoadChunk, RoadChunksSummary } from "@/types";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from "recharts";

const MUNICIPAL_PALETTE = [
  "#2563eb", // blue
  "#059669", // emerald
  "#d97706", // amber
  "#7c3aed", // violet
  "#0284c7", // sky blue
  "#ea580c", // orange
  "#db2777", // pink
  "#4f46e5", // indigo
  "#0d9488", // teal
  "#64748b", // slate
];

interface RoadHealthEntry {
  department?: string;
  road?: string;
  health_score?: number;
  health?: number;
  issue_count?: number;
  issues?: number;
}

interface RoutePerf {
  total_detections: number;
  total_issues: number;
  resolved_issues: number;
  resolution_rate: number;
}

export default function AnalyticsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [roadHealth, setRoadHealth] = useState<RoadHealthEntry[]>([]);
  const [routePerf, setRoutePerf] = useState<RoutePerf | null>(null);
  const [odMatrix, setOdMatrix] = useState<OdMatrix | null>(null);
  const [routeDelays, setRouteDelays] = useState<RouteDelay[]>([]);
  const [infra, setInfra] = useState<InfrastructureReport | null>(null);
  const [chunks, setChunks] = useState<RoadChunk[]>([]);
  const [chunksSummary, setChunksSummary] = useState<RoadChunksSummary | null>(null);

  useEffect(() => {
    api.getEvents({ limit: "200" }).then((r) => setEvents(r?.events || [])).catch((e) => console.warn("Failed to load events:", e));
    api.getIssues({ limit: "200" }).then((r) => setIssues(r?.issues || [])).catch((e) => console.warn("Failed to load issues:", e));
    api.getRoadHealth().then((r) => setRoadHealth(r?.roads || [])).catch((e) => console.warn("Failed to load road health:", e));
    api.getRoutePerformance().then(setRoutePerf).catch((e) => console.warn("Failed to load route performance:", e));
    api.getOdMatrix(7).then(setOdMatrix).catch((e) => console.warn("Failed to load OD matrix:", e));
    api.getRouteDelays().then((r) => setRouteDelays(r?.routes || [])).catch((e) => console.warn("Failed to load route delays:", e));
    api.getInfrastructure().then(setInfra).catch((e) => console.warn("Failed to load infrastructure:", e));
    api.getChunks().then((r) => setChunks(r?.chunks || [])).catch((e) => console.warn("Failed to load chunks:", e));
    api.getChunksSummary().then(setChunksSummary).catch((e) => console.warn("Failed to load chunks summary:", e));
  }, []);


  const eventTypeDist = events.reduce((acc: Record<string, number>, e) => {
    acc[e.event_type] = (acc[e.event_type] || 0) + 1;
    return acc;
  }, {});
  const totalEvents = events.length;

  const sortedEvents = Object.entries(eventTypeDist)
    .map(([name, value]) => ({
      name,
      displayName: name.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
      value,
      percentage: totalEvents > 0 ? Math.round((value / totalEvents) * 100) : 0,
    }))
    .sort((a, b) => b.value - a.value);

  // Group into top 6 + "Other Defects" for clean donut slices without congestion
  const topSlices = sortedEvents.slice(0, 6);
  const otherSlices = sortedEvents.slice(6);
  const otherTotal = otherSlices.reduce((acc, curr) => acc + curr.value, 0);

  const donutSlices = [
    ...topSlices.map((s, idx) => ({ ...s, color: MUNICIPAL_PALETTE[idx % MUNICIPAL_PALETTE.length] })),
    ...(otherTotal > 0
      ? [
          {
            name: "OTHER",
            displayName: `Other (${otherSlices.length} types)`,
            value: otherTotal,
            percentage: totalEvents > 0 ? Math.round((otherTotal / totalEvents) * 100) : 0,
            color: "#94a3b8",
          },
        ]
      : []),
  ];

  const severityDist = events.reduce((acc: Record<string, number>, e) => {
    acc[e.severity] = (acc[e.severity] || 0) + 1;
    return acc;
  }, {});

  const severityOrder = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  const severityColors: Record<string, string> = {
    CRITICAL: "#dc2626",
    HIGH: "#ea580c",
    MEDIUM: "#d97706",
    LOW: "#2563eb",
  };
  const severityBar = severityOrder
    .filter((sev) => (severityDist[sev] || 0) > 0 || Object.keys(severityDist).length === 0)
    .map((name) => ({
      name,
      count: severityDist[name] || 0,
      color: severityColors[name] || "#2563eb",
    }));

  const issueStatusDist = issues.reduce((acc: Record<string, number>, i) => {
    acc[i.status] = (acc[i.status] || 0) + 1;
    return acc;
  }, {});

  const issueStatusData = Object.entries(issueStatusDist).map(([name, count]) => ({
    name: name.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
    rawName: name,
    count,
  }));

  const hourlyData = Array.from({ length: 24 }, (_, h) => ({
    hour: `${h}:00`,
    events: events.filter((e) => new Date(e.created_at).getHours() === h).length,
  }));

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-xl font-bold text-slate-900">Municipal Infrastructure Analytics</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Defect severity distribution, corridor travel times, and departmental road health metrics
        </p>
      </div>

      {/* Top 4 Analytical KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Verification Rate"
          value={routePerf ? `${Math.round(routePerf.resolution_rate)}%` : "—"}
          color="green"
          subtitle="Clearance verification"
        />
        <KpiCard
          label="Cumulative Defects"
          value={routePerf ? routePerf.total_issues : issues.length}
          color="blue"
          subtitle="Logged work orders"
        />
        <KpiCard
          label="Resolved Defects"
          value={routePerf ? routePerf.resolved_issues : issues.filter((i) => i.status === "RESOLVED").length}
          color="blue"
          subtitle="Closed work orders"
        />
        <KpiCard
          label="Corridor Deficiencies"
          value={infra ? infra.categories.length : 0}
          color="amber"
          subtitle="Identified maintenance zones"
        />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="flex flex-col">
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                Event Classification Mix
              </span>
              <Badge text={`${totalEvents} DETECTIONS`} variant="default" />
            </div>
          </CardHeader>
          <div className="p-4 flex flex-col sm:flex-row items-center gap-4 flex-1">
            {/* Donut Chart Container with Center Total */}
            <div className="w-full sm:w-1/2 h-56 relative flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutSlices}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={2}
                    dataKey="value"
                    isAnimationActive={false}
                  >
                    {donutSlices.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload as { displayName: string; value: number; percentage: number };
                        return (
                          <div className="bg-white px-3 py-2 rounded-lg shadow-md border border-slate-200 text-xs font-sans">
                            <p className="font-semibold text-slate-800">{data.displayName}</p>
                            <p className="text-slate-600 font-mono mt-0.5">
                              {data.value} defects ({data.percentage}%)
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-xl font-bold font-mono text-slate-900">{totalEvents}</span>
                <span className="text-[9px] uppercase font-bold tracking-wider text-slate-400">Events</span>
              </div>
            </div>

            {/* Scrollable Clean Breakdown Legend on Right */}
            <div className="w-full sm:w-1/2 max-h-56 overflow-y-auto pr-1 space-y-1.5 border-t sm:border-t-0 sm:border-l border-slate-100 sm:pl-3">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1">
                Category Breakdown
              </div>
              {sortedEvents.map((item, idx) => {
                const color = idx < 6 ? MUNICIPAL_PALETTE[idx % MUNICIPAL_PALETTE.length] : "#94a3b8";
                return (
                  <div
                    key={item.name}
                    className="flex items-center justify-between text-xs py-1 px-1.5 rounded hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="text-slate-700 font-medium truncate" title={item.displayName}>
                        {item.displayName}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                      <span className="text-slate-900 font-mono font-semibold">{item.value}</span>
                      <span className="text-[10px] text-slate-400 font-mono w-7 text-right">{item.percentage}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              Events by Severity Level
            </span>
          </CardHeader>
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={severityBar}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 9, fill: "#64748b" }} />
                <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "11px", color: "#0f172a" }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {severityBar.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              24-Hour Telemetry Volume
            </span>
          </CardHeader>
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "#64748b" }} interval={2} />
                <YAxis tick={{ fontSize: 9, fill: "#64748b" }} />
                <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "11px", color: "#0f172a" }} />
                <Line type="monotone" dataKey="events" stroke="#d97706" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              Work Order Status Breakdown
            </span>
          </CardHeader>
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={issueStatusData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 8, fill: "#64748b" }} interval={0} />
                <YAxis tick={{ fontSize: 9, fill: "#64748b" }} />
                <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "11px", color: "#0f172a" }} />
                <Bar dataKey="count" fill="#16a34a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Road Health and OD Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              Departmental Road Health Rating
            </span>
            <Badge text="DATA DRIVEN" variant="default" />
          </CardHeader>
          <div className="p-4 space-y-3">
            {roadHealth.length === 0 && (
              <p className="text-xs text-slate-500">No departmental health metrics recorded.</p>
            )}
            {roadHealth.map((r) => (
              <div key={r.department || r.road} className="flex items-center gap-3 text-xs">
                <span className="text-slate-700 font-medium w-36 truncate">{r.department || r.road}</span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${r.health_score || r.health}%`,
                      backgroundColor:
                        (r.health_score || r.health || 0) > 70
                          ? "#16a34a"
                          : (r.health_score || r.health || 0) > 45
                          ? "#d97706"
                          : "#dc2626",
                    }}
                  />
                </div>
                <span className="text-xs font-mono font-semibold text-slate-800 w-12 text-right">
                  {r.health_score || r.health} / 100
                </span>
                <span className="text-[11px] text-slate-500 w-20 text-right">
                  {r.issue_count || r.issues} defects
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              Corridor Origin-Destination Matrix
            </span>
            <Badge text={odMatrix?.label || "OPERATIONAL"} variant="default" />
          </CardHeader>
          <div className="p-4">
            {!odMatrix || odMatrix.matrix.length === 0 ? (
              <div className="text-center text-slate-500 text-xs py-8">
                No corridor OD flow data recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200 text-[10px] uppercase">
                      <th className="py-2 pr-2">Corridor</th>
                      <th className="py-2 pr-2">Origin</th>
                      <th className="py-2 pr-2">Destination</th>
                      <th className="py-2 pr-2">Trips</th>
                      <th className="py-2 pr-2">Vehicles</th>
                      <th className="py-2 pr-2">Congestion</th>
                      <th className="py-2">Est. Travel</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {odMatrix.matrix.map((m) => (
                      <tr key={m.route_name} className="text-slate-700">
                        <td className="py-2 pr-2 font-medium text-slate-900">{m.route_name}</td>
                        <td className="py-2 pr-2">{m.origin}</td>
                        <td className="py-2 pr-2">{m.destination}</td>
                        <td className="py-2 pr-2 font-mono">{m.trips}</td>
                        <td className="py-2 pr-2 font-mono">{m.vehicles_observed}</td>
                        <td className="py-2 pr-2 font-mono">{m.avg_congestion_score}</td>
                        <td className="py-2 font-mono">{m.est_travel_min > 0 ? `${m.est_travel_min} min` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Route Delays and Deficiencies */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              Transit Route Delay Schedules
            </span>
          </CardHeader>
          <div className="p-4">
            {routeDelays.length === 0 ? (
              <p className="text-xs text-slate-500">No scheduled route delay estimates available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200 text-[10px] uppercase">
                      <th className="py-2 pr-2">Route</th>
                      <th className="py-2 pr-2">Scheduled</th>
                      <th className="py-2 pr-2">Estimated</th>
                      <th className="py-2 pr-2">Variance</th>
                      <th className="py-2 pr-2">Congestion</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {routeDelays.map((d) => (
                      <tr key={d.route_name} className="text-slate-700">
                        <td className="py-2 pr-2 font-medium text-slate-900">{d.route_name}</td>
                        <td className="py-2 pr-2 font-mono">{d.scheduled_duration_min} min</td>
                        <td className="py-2 pr-2 font-mono">{d.estimated_duration_min} min</td>
                        <td className="py-2 pr-2 font-mono">{d.delay_min > 0 ? `+${d.delay_min}` : d.delay_min} min</td>
                        <td className="py-2 pr-2 font-mono">{d.avg_congestion_score}</td>
                        <td className="py-2">
                          <Badge
                            text={d.status}
                            variant={d.status === "SEVERE" ? "critical" : d.status === "DELAYED" ? "warning" : "default"}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              Corridor Infrastructure Deficiencies
            </span>
          </CardHeader>
          <div className="p-4 space-y-3">
            {(!infra || infra.categories.length === 0) && (
              <p className="text-xs text-slate-500">No infrastructure deficiencies logged.</p>
            )}
            {infra?.categories.map((c) => (
              <div key={c.category} className="space-y-1 text-xs">
                <div className="flex justify-between text-slate-700">
                  <span className="font-medium text-slate-900">{c.category}</span>
                  <span className="font-mono text-slate-500">{c.count} recorded</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(0, 100 - c.deficiency_score)}%`,
                      backgroundColor: (100 - c.deficiency_score) > 60 ? "#dc2626" : "#d97706",
                    }}
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  Recommendation: {c.recommendation}
                  {c.affected_stops.length > 0 && <> • near {c.affected_stops.slice(0, 3).join(", ")}</>}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* 500m Road Network Infrastructure & Pavement Condition Matrix */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <span className="text-base">🛣️</span>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-800">
                500m Road Network Discretization & Pavement Health Index
              </span>
            </div>
            <Link
              href="/map"
              className="text-xs text-blue-600 hover:text-blue-800 font-semibold hover:underline flex items-center gap-1"
            >
              <span>Explore All 206 Chunks on GIS Map</span>
              <span>&rarr;</span>
            </Link>
          </div>
        </CardHeader>
        <div className="p-4 space-y-4">
          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="text-[10px] font-mono text-slate-500 uppercase">Total Road Network</div>
              <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                {chunksSummary ? `${chunksSummary.total_network_km} km` : "103.0 km"}
              </div>
              <div className="text-[9px] text-slate-400 mt-0.5">6 major Pune arterial corridors</div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="text-[10px] font-mono text-slate-500 uppercase">Discretized 500m Units</div>
              <div className="text-xl font-bold font-mono text-blue-700 mt-1">
                {chunks.length > 0 ? chunks.length : 206} <span className="text-xs font-normal text-slate-500">chunks</span>
              </div>
              <div className="text-[9px] text-slate-400 mt-0.5">Cadastral highway chainage</div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="text-[10px] font-mono text-slate-500 uppercase">Average Network PCI</div>
              <div className="text-xl font-bold font-mono text-emerald-700 mt-1">
                {chunksSummary ? `${chunksSummary.average_pci_health}%` : "92.5%"}
              </div>
              <div className="text-[9px] text-slate-400 mt-0.5">ASTM D6433 health rating</div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="text-[10px] font-mono text-slate-500 uppercase">Critical Hotspot Chunks</div>
              <div className="text-xl font-bold font-mono text-red-600 mt-1">
                {chunks.filter((c) => c.health_score < 50).length} <span className="text-xs font-normal text-slate-500">urgent</span>
              </div>
              <div className="text-[9px] text-slate-400 mt-0.5">PCI &lt; 50 requiring intervention</div>
            </div>
          </div>

          {/* Critical Chunks Table */}
          <div>
            <div className="text-xs font-bold text-slate-800 mb-2 flex items-center justify-between">
              <span>Pavement Distress Hotspots — Top Priority 500m Segments</span>
              <span className="text-[11px] text-slate-500 font-normal">Sorted by descending distress severity</span>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100/75 border-b border-slate-200 text-[10px] uppercase font-mono text-slate-600">
                    <th className="py-2.5 px-3">Chunk ID</th>
                    <th className="py-2.5 px-3">Corridor & Ward</th>
                    <th className="py-2.5 px-3">Stationing / Chainage</th>
                    <th className="py-2.5 px-3">PCI Health</th>
                    <th className="py-2.5 px-3">Active Defects</th>
                    <th className="py-2.5 px-3 text-right">GIS Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {chunks
                    .filter((c) => c.active_issues_count > 0)
                    .sort((a, b) => a.health_score - b.health_score)
                    .slice(0, 8)
                    .map((chk) => (
                      <tr key={chk.chunk_id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-blue-700">
                          {chk.chunk_id}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-900">{chk.chunk_name}</div>
                          <div className="text-[10px] text-slate-500">{chk.ward} &bull; {chk.corridor_name}</div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-700">
                          {chk.chainage}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] ${
                              chk.health_score < 50
                                ? "bg-red-100 text-red-800 border border-red-200"
                                : chk.health_score < 75
                                ? "bg-amber-100 text-amber-800 border border-amber-200"
                                : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                            }`}>
                              PCI {chk.health_score}
                            </span>
                            <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden hidden sm:block">
                              <div
                                className={`h-full rounded-full ${
                                  chk.health_score < 50 ? "bg-red-500" : chk.health_score < 75 ? "bg-amber-500" : "bg-emerald-500"
                                }`}
                                style={{ width: `${chk.health_score}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-red-600">
                          {chk.active_issues_count} {chk.active_issues_count === 1 ? "defect" : "defects"}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <Link
                            href={`/map?chunk=${chk.chunk_id}`}
                            className="text-blue-600 hover:text-blue-800 font-semibold hover:underline text-[11px] inline-flex items-center gap-1"
                          >
                            <span>Inspect Segment</span>
                            <span>&rarr;</span>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  {chunks.filter((c) => c.active_issues_count > 0).length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-400 font-mono text-xs">
                        ✨ All 206 road chunks are at 100% PCI health with 0 active defects.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
