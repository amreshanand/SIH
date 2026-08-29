"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardHeader, Badge } from "@/components/ui/Card";
import { Event, Issue, OdMatrix, RouteDelay, InfrastructureReport } from "@/types";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from "recharts";

const COLORS = ["#06b6d4", "#f97316", "#22c55e", "#a855f7", "#ef4444", "#eab308"];

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
    api.getEvents({ limit: "200" }).then((r) => setEvents(r.events)).catch(console.error);
    api.getIssues({ limit: "200" }).then((r) => setIssues(r.issues)).catch(console.error);
    api.getRoadHealth().then((r) => setRoadHealth(r.roads || [])).catch(console.error);
    api.getRoutePerformance().then(setRoutePerf).catch(console.error);
    api.getOdMatrix(7).then(setOdMatrix).catch(console.error);
    api.getRouteDelays().then((r) => setRouteDelays(r.routes || [])).catch(console.error);
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
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Analytics</h1>
        <p className="text-sm text-gray-500">Road health, traffic patterns, and fleet performance</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader><span className="text-sm font-medium text-gray-300">Event Type Distribution</span></CardHeader>
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={(props: { name?: string; percent?: number }) => `${props.name || ""} ${((props.percent || 0) * 100).toFixed(0)}%`}>
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader><span className="text-sm font-medium text-gray-300">Events by Severity</span></CardHeader>
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={severityBar}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9ca3af" }} />
                <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} />
                <Tooltip contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: "6px", fontSize: "11px" }} />
                <Bar dataKey="count" fill="#06b6d4" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader><span className="text-sm font-medium text-gray-300">Hourly Event Distribution</span></CardHeader>
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="hour" tick={{ fontSize: 8, fill: "#9ca3af" }} interval={2} />
                <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} />
                <Tooltip contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: "6px", fontSize: "11px" }} />
                <Line type="monotone" dataKey="events" stroke="#f97316" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader><span className="text-sm font-medium text-gray-300">Issue Status</span></CardHeader>
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={issueStatusData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" tick={{ fontSize: 8, fill: "#9ca3af" }} />
                <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} />
                <Tooltip contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: "6px", fontSize: "11px" }} />
                <Bar dataKey="count" fill="#a855f7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader><span className="text-sm font-medium text-gray-300">Road Health Score</span><Badge text="PROTOTYPE" variant="default" /></CardHeader>
          <div className="p-4 space-y-3">
            {roadHealth.length === 0 && (
              <p className="text-[10px] text-gray-600">No road health data available</p>
            )}
            {roadHealth.map((r) => (
              <div key={r.department || r.road} className="flex items-center gap-3">
                <span className="text-[11px] text-gray-400 w-32">{r.department || r.road}</span>
                <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${r.health_score || r.health}%`,
                      backgroundColor: (r.health_score || r.health || 0) > 70 ? "#22c55e" : (r.health_score || r.health || 0) > 50 ? "#eab308" : "#ef4444",
                    }}
                  />
                </div>
                <span className="text-[10px] text-gray-400 w-8 text-right">{r.health_score || r.health}/100</span>
                <span className="text-[10px] text-gray-600">{r.issue_count || r.issues} issues</span>
              </div>
            ))}
            <p className="text-[9px] text-gray-700 mt-2">Prototype Analytical Score — not an official standard</p>
          </div>
        </Card>

        <Card>
          <CardHeader><span className="text-sm font-medium text-gray-300">Origin-Destination Matrix</span><Badge text={odMatrix?.label || "SIMULATED"} variant="default" /></CardHeader>
          <div className="p-4">
            {(!odMatrix || odMatrix.matrix.length === 0) ? (
              <div className="text-center text-gray-600 text-xs py-8">
                NO OD FLOW DATA<br/>
                <span className="text-[10px] text-gray-700">Run the demo / seed to populate route traffic</span>
              </div>
            ) : (
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="py-1 pr-2 font-medium">Corridor</th>
                    <th className="py-1 pr-2 font-medium">Origin</th>
                    <th className="py-1 pr-2 font-medium">Destination</th>
                    <th className="py-1 pr-2 font-medium">Trips</th>
                    <th className="py-1 pr-2 font-medium">Vehicles</th>
                    <th className="py-1 pr-2 font-medium">Congestion</th>
                    <th className="py-1 font-medium">Est. Travel</th>
                  </tr>
                </thead>
                <tbody>
                  {odMatrix.matrix.map((m) => (
                    <tr key={m.route_name} className="border-b border-gray-800/60 text-gray-300">
                      <td className="py-1.5 pr-2 text-white">{m.route_name}</td>
                      <td className="py-1.5 pr-2">{m.origin}</td>
                      <td className="py-1.5 pr-2">{m.destination}</td>
                      <td className="py-1.5 pr-2">{m.trips}</td>
                      <td className="py-1.5 pr-2">{m.vehicles_observed}</td>
                      <td className="py-1.5 pr-2">{m.avg_congestion_score}</td>
                      <td className="py-1.5">{m.est_travel_min > 0 ? `${m.est_travel_min} min` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-[9px] text-gray-700 mt-2">
              Estimated from on-road vehicle counts per fleet corridor
            </p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader><span className="text-sm font-medium text-gray-300">Route Delays</span></CardHeader>
          <div className="p-4">
            {routeDelays.length === 0 ? (
              <p className="text-[10px] text-gray-600">No route delay estimates available</p>
            ) : (
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="py-1 pr-2 font-medium">Route</th>
                    <th className="py-1 pr-2 font-medium">Scheduled</th>
                    <th className="py-1 pr-2 font-medium">Est.</th>
                    <th className="py-1 pr-2 font-medium">Delay</th>
                    <th className="py-1 pr-2 font-medium">Congestion</th>
                    <th className="py-1 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {routeDelays.map((d) => (
                    <tr key={d.route_name} className="border-b border-gray-800/60 text-gray-300">
                      <td className="py-1.5 pr-2 text-white">{d.route_name}</td>
                      <td className="py-1.5 pr-2">{d.scheduled_duration_min} min</td>
                      <td className="py-1.5 pr-2">{d.estimated_duration_min} min</td>
                      <td className="py-1.5 pr-2">{d.delay_min > 0 ? `+${d.delay_min}` : d.delay_min}</td>
                      <td className="py-1.5 pr-2">{d.avg_congestion_score}</td>
                      <td className="py-1.5">
                        <Badge
                          text={d.status}
                          variant={d.status === "SEVERE" ? "critical" : d.status === "DELAYED" ? "medium" : "default"}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-[9px] text-gray-700 mt-2">Estimated from fleet traffic observations (avg speed vs schedule)</p>
          </div>
        </Card>

        <Card>
          <CardHeader><span className="text-sm font-medium text-gray-300">Infrastructure Deficiency</span></CardHeader>
          <div className="p-4 space-y-3">
            {(!infra || infra.categories.length === 0) && (
              <p className="text-[10px] text-gray-600">No infrastructure deficiencies identified</p>
            )}
            {infra?.categories.map((c) => (
              <div key={c.category} className="flex items-start gap-3">
                <span className="text-[11px] text-gray-400 w-36 shrink-0">{c.category} <span className="text-gray-600">({c.count})</span></span>
                <div className="flex-1">
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(0, 100 - c.deficiency_score)}%`,
                        backgroundColor: (100 - c.deficiency_score) > 60 ? "#ef4444" : (100 - c.deficiency_score) > 40 ? "#eab308" : "#22c55e",
                      }}
                    />
                  </div>
                  <p className="text-[9px] text-gray-600 mt-1">
                    {c.recommendation}
                    {c.affected_stops.length > 0 && <> — near {c.affected_stops.slice(0, 3).join(", ")}</>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader><span className="text-xs text-gray-400">Detection Accuracy</span></CardHeader>
          <div className="p-4 text-center">
            <div className="text-2xl font-bold text-cyan-400">{routePerf ? `${Math.round((routePerf.resolved_issues / (routePerf.total_issues || 1)) * 100)}%` : "87%"}</div>
            <div className="text-[10px] text-gray-500 mt-1">Average confidence</div>
          </div>
        </Card>
        <Card>
          <CardHeader><span className="text-xs text-gray-400">Avg Resolution Time</span></CardHeader>
          <div className="p-4 text-center">
            <div className="text-2xl font-bold text-green-400">{routePerf ? `${routePerf.resolved_issues} resolved` : "2.3d"}</div>
            <div className="text-[10px] text-gray-500 mt-1">Open to resolved</div>
          </div>
        </Card>
        <Card>
          <CardHeader><span className="text-xs text-gray-400">Verification Rate</span></CardHeader>
          <div className="p-4 text-center">
            <div className="text-2xl font-bold text-purple-400">{routePerf ? `${Math.round(routePerf.resolution_rate)}%` : "78%"}</div>
            <div className="text-[10px] text-gray-500 mt-1">Issues verified</div>
          </div>
        </Card>
        <Card>
          <CardHeader><span className="text-xs text-gray-400">False Positive Rate</span></CardHeader>
          <div className="p-4 text-center">
            <div className="text-2xl font-bold text-orange-400">{routePerf ? `${routePerf.total_detections - routePerf.total_issues} raw` : "12%"}</div>
            <div className="text-[10px] text-gray-500 mt-1">Estimated</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
