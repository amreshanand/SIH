"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardHeader, Badge, KpiCard } from "@/components/ui/Card";
import { Event, Issue, OdMatrix, RouteDelay, InfrastructureReport } from "@/types";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from "recharts";

const MUNICIPAL_PALETTE = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#475569", "#0284c7"];

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

  useEffect(() => {
    api.getEvents({ limit: "200" }).then((r) => setEvents(r?.events || [])).catch(console.error);
    api.getIssues({ limit: "200" }).then((r) => setIssues(r?.issues || [])).catch(console.error);
    api.getRoadHealth().then((r) => setRoadHealth(r?.roads || [])).catch(console.error);
    api.getRoutePerformance().then(setRoutePerf).catch(console.error);
    api.getOdMatrix(7).then(setOdMatrix).catch(console.error);
    api.getRouteDelays().then((r) => setRouteDelays(r?.routes || [])).catch(console.error);
    api.getInfrastructure().then(setInfra).catch(console.error);
  }, []);

  const eventTypeDist = events.reduce((acc: Record<string, number>, e) => {
    acc[e.event_type] = (acc[e.event_type] || 0) + 1;
    return acc;
  }, {});
  const pieData = Object.entries(eventTypeDist).map(([name, value]) => ({ name, value }));

  const severityDist = events.reduce((acc: Record<string, number>, e) => {
    acc[e.severity] = (acc[e.severity] || 0) + 1;
    return acc;
  }, {});
  const severityBar = Object.entries(severityDist).map(([name, count]) => ({ name, count }));

  const issueStatusDist = issues.reduce((acc: Record<string, number>, i) => {
    acc[i.status] = (acc[i.status] || 0) + 1;
    return acc;
  }, {});
  const issueStatusData = Object.entries(issueStatusDist).map(([name, count]) => ({ name, count }));

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
        <Card>
          <CardHeader>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              Event Classification Mix
            </span>
          </CardHeader>
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  outerRadius={75}
                  dataKey="value"
                  label={(props: { name?: string; percent?: number }) => `${props.name?.replace(/_/g, " ") || ""} ${((props.percent || 0) * 100).toFixed(0)}%`}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={MUNICIPAL_PALETTE[i % MUNICIPAL_PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "4px", fontSize: "11px", color: "#0f172a" }} />
              </PieChart>
            </ResponsiveContainer>
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
                <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "4px", fontSize: "11px", color: "#0f172a" }} />
                <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} />
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
                <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "4px", fontSize: "11px", color: "#0f172a" }} />
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
                <XAxis dataKey="name" tick={{ fontSize: 8, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 9, fill: "#64748b" }} />
                <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "4px", fontSize: "11px", color: "#0f172a" }} />
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
    </div>
  );
}
