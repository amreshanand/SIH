"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { api } from "@/lib/api";
import { DashboardStats, Event, Issue, Incident } from "@/types";
import { KpiCard, Card, CardHeader, Badge } from "@/components/ui/Card";
import Link from "next/link";

interface LiveEvent {
  type?: string;
  event_type?: string;
  event_id?: string;
  severity?: string;
  timestamp?: string | number;
  created_at?: string;
}

function formatEventTime(e: LiveEvent): string {
  if (e.timestamp) return new Date(e.timestamp).toLocaleTimeString();
  if (e.created_at) return new Date(e.created_at).toLocaleTimeString();
  return "now";
}

const DEFAULT_DEMO_STATS: DashboardStats = {
  active_buses: 3,
  events_today: 48,
  open_issues: 7,
  critical_incidents: 2,
  resolved_issues: 14,
  total_events: 184,
  total_issues: 21,
  total_incidents: 5,
  traffic_hotspots: 3,
};

const DEFAULT_DEMO_ISSUES: Issue[] = [
  {
    id: "issue-demo-001",
    issue_id: "ISSUE-PUN-001",
    issue_type: "POTHOLE",
    severity: "HIGH",
    confidence: 0.94,
    latitude: 18.5284,
    longitude: 73.8421,
    first_seen: new Date(Date.now() - 3600000 * 4).toISOString(),
    last_seen: new Date(Date.now() - 600000).toISOString(),
    observation_count: 5,
    affected_road: "FC Road, Deccan Gymkhana",
    department: "Road Maintenance Division",
    status: "DISPATCHED",
    consensus_level: "HIGH",
    metadata_json: {},
    created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
    updated_at: new Date(Date.now() - 600000).toISOString(),
  },
  {
    id: "issue-demo-002",
    issue_id: "ISSUE-PUN-002",
    issue_type: "SURFACE_CRACK",
    severity: "MEDIUM",
    confidence: 0.88,
    latitude: 18.5112,
    longitude: 73.8345,
    first_seen: new Date(Date.now() - 3600000 * 6).toISOString(),
    last_seen: new Date(Date.now() - 1200000).toISOString(),
    observation_count: 3,
    affected_road: "Karve Road, Kothrud",
    department: "Civil Infrastructure Dept",
    status: "INVESTIGATING",
    consensus_level: "MEDIUM",
    metadata_json: {},
    created_at: new Date(Date.now() - 3600000 * 6).toISOString(),
    updated_at: new Date(Date.now() - 1200000).toISOString(),
  },
  {
    id: "issue-demo-003",
    issue_id: "ISSUE-PUN-003",
    issue_type: "WATERLOGGING",
    severity: "CRITICAL",
    confidence: 0.97,
    latitude: 18.5362,
    longitude: 73.8694,
    first_seen: new Date(Date.now() - 3600000 * 2).toISOString(),
    last_seen: new Date(Date.now() - 300000).toISOString(),
    observation_count: 8,
    affected_road: "Sangamwadi BRT Corridor",
    department: "Stormwater Drainage Div",
    status: "ASSIGNED",
    consensus_level: "HIGH",
    metadata_json: {},
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    updated_at: new Date(Date.now() - 300000).toISOString(),
  },
  {
    id: "issue-demo-004",
    issue_id: "ISSUE-PUN-004",
    issue_type: "ILLEGAL_PARKING",
    severity: "HIGH",
    confidence: 0.91,
    latitude: 18.5524,
    longitude: 73.8295,
    first_seen: new Date(Date.now() - 3600000 * 3).toISOString(),
    last_seen: new Date(Date.now() - 900000).toISOString(),
    observation_count: 4,
    affected_road: "Pune University Circle",
    department: "Traffic Enforcement Police",
    status: "OPEN",
    consensus_level: "HIGH",
    metadata_json: {},
    created_at: new Date(Date.now() - 3600000 * 3).toISOString(),
    updated_at: new Date(Date.now() - 900000).toISOString(),
  },
];

const DEFAULT_DEMO_INCIDENTS: Incident[] = [
  {
    id: "inc-demo-001",
    incident_id: "INC-DEMO-0001",
    incident_type: "RASH_DRIVING",
    bus_id: "BUS-001",
    severity: "CRITICAL",
    confidence: 0.96,
    latitude: 18.5320,
    longitude: 73.8340,
    plate_text: "MH12-QB-4912",
    plate_confidence: 0.92,
    evidence_url: null,
    status: "OPEN",
    created_at: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: "inc-demo-002",
    incident_id: "INC-DEMO-0002",
    incident_type: "ILLEGAL_PARKING",
    bus_id: "BUS-002",
    severity: "MEDIUM",
    confidence: 0.89,
    latitude: 18.5592,
    longitude: 73.7884,
    plate_text: "MH14-AZ-8831",
    plate_confidence: 0.88,
    evidence_url: null,
    status: "OPEN",
    created_at: new Date(Date.now() - 7200000).toISOString(),
  },
];

const DEFAULT_DEMO_EVENTS: Event[] = [
  {
    id: "evt-demo-001",
    event_id: "EVT-001-POT",
    event_type: "POTHOLE_DETECTED",
    bus_id: "BUS-001",
    camera_id: "CAM-01-FRONT",
    severity: "HIGH",
    confidence: 0.94,
    latitude: 18.5284,
    longitude: 73.8421,
    evidence_url: null,
    metadata_json: {},
    source: "YOLOv8_EDGE",
    status: "CONFIRMED",
    created_at: new Date(Date.now() - 300000).toISOString(),
    updated_at: new Date(Date.now() - 300000).toISOString(),
  },
  {
    id: "evt-demo-002",
    event_id: "EVT-002-CRK",
    event_type: "SURFACE_CRACK",
    bus_id: "BUS-002",
    camera_id: "CAM-01-FRONT",
    severity: "MEDIUM",
    confidence: 0.88,
    latitude: 18.5112,
    longitude: 73.8345,
    evidence_url: null,
    metadata_json: {},
    source: "YOLOv8_EDGE",
    status: "CONFIRMED",
    created_at: new Date(Date.now() - 600000).toISOString(),
    updated_at: new Date(Date.now() - 600000).toISOString(),
  },
];

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_DEMO_STATS);
  const [events, setEvents] = useState<Event[]>(DEFAULT_DEMO_EVENTS);
  const [issues, setIssues] = useState<Issue[]>(DEFAULT_DEMO_ISSUES);
  const [incidents, setIncidents] = useState<Incident[]>(DEFAULT_DEMO_INCIDENTS);
  const [feedTab, setFeedTab] = useState<"issues" | "live" | "events">("issues");
  const { messages, connected } = useWebSocket("events");
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const liveEvents = useMemo<LiveEvent[]>(() => {
    if (messages.length > 0) return messages.slice(0, 30) as LiveEvent[];
    return DEFAULT_DEMO_EVENTS.map((e) => ({
      event_id: e.event_id,
      event_type: e.event_type,
      severity: e.severity,
      created_at: e.created_at,
    }));
  }, [messages]);
  const activeIssues = useMemo(() => issues.filter((i) => i.status !== "RESOLVED"), [issues]);

  const refreshStats = useCallback(() => {
    api.getDashboardStats().then((res) => {
      if (res && typeof res.active_buses === "number") setStats(res);
    }).catch(console.error);
    api.getEvents().then((r) => {
      if (r?.events && r.events.length > 0) setEvents(r.events);
    }).catch(console.error);
    api.getIssues({ limit: "300" }).then((r) => {
      if (r?.issues && r.issues.length > 0) setIssues(r.issues);
    }).catch(console.error);
    api.getIncidents().then((r) => {
      if (r?.incidents && r.incidents.length > 0) setIncidents(r.incidents);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    refreshStats();
    statsIntervalRef.current = setInterval(refreshStats, 5000);
    return () => {
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    };
  }, [refreshStats]);

  useEffect(() => {
    if (messages.length > 0) refreshStats();
  }, [messages.length, refreshStats]);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Urban Operations Center</h1>
          <p className="text-xs text-slate-500 mt-0.5">Municipal infrastructure telemetry, road defects, and incident management</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-slate-200 px-2.5 py-1 rounded text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-slate-700 font-semibold">STREAM LIVE</span>
          </div>
          <button
            onClick={refreshStats}
            className="text-xs px-3 py-1 bg-white border border-slate-300 rounded text-slate-700 hover:bg-slate-50 transition-colors font-medium"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard label="Active Buses" value={stats?.active_buses ?? 0} color="blue" />
        <KpiCard label="Events Today" value={stats?.events_today ?? 0} color="blue" />
        <KpiCard label="Open Issues" value={stats?.open_issues ?? 0} color="amber" />
        <KpiCard label="Critical Incidents" value={stats?.critical_incidents ?? 0} color="red" />
        <KpiCard label="Resolved Issues" value={stats?.resolved_issues ?? 0} color="green" />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFeedTab("issues")}
                  className={`text-xs font-semibold px-2.5 py-1 rounded transition-colors ${
                    feedTab === "issues"
                      ? "bg-blue-50 text-blue-700 border border-blue-200"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Detected Road Issues ({issues.length})
                </button>
                <button
                  onClick={() => setFeedTab("live")}
                  className={`text-xs font-semibold px-2.5 py-1 rounded transition-colors flex items-center gap-1.5 ${
                    feedTab === "live"
                      ? "bg-blue-50 text-blue-700 border border-blue-200"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-slate-400"}`} />
                  Live Event Feed ({liveEvents.length})
                </button>
                <button
                  onClick={() => setFeedTab("events")}
                  className={`text-xs font-semibold px-2.5 py-1 rounded transition-colors ${
                    feedTab === "events"
                      ? "bg-blue-50 text-blue-700 border border-blue-200"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Telemetry Log ({events.length})
                </button>
              </div>
              <Badge text={feedTab === "issues" ? `${issues.length} total` : connected ? "STREAM LIVE" : "OFFLINE"} variant={connected ? "success" : "default"} />
            </CardHeader>

            <div className="p-4 max-h-[460px] overflow-y-auto space-y-2">
              {/* TAB 1: ALL DETECTED ROAD ISSUES */}
              {feedTab === "issues" && (
                <>
                  {issues.length === 0 ? (
                    <div className="text-center text-slate-500 py-10 text-xs">
                      No road defects detected yet. Run edge inference or test suite to populate records.
                    </div>
                  ) : (
                    issues.slice(0, 25).map((issue) => (
                      <Link key={issue.id} href={`/issues/${issue.id}`}>
                        <div className="flex items-center justify-between p-3 bg-white hover:bg-slate-50 rounded border border-slate-200 hover:border-slate-300 transition-all cursor-pointer">
                          <div className="min-w-0 pr-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono font-semibold text-slate-900">{issue.issue_id}</span>
                              <span className="text-xs text-slate-700 font-medium">{issue.issue_type.replace(/_/g, " ")}</span>
                              {issue.consensus_level && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-300 font-mono">
                                  {issue.consensus_level}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono mt-1">
                              <span>Coord: {issue.latitude?.toFixed(4)}, {issue.longitude?.toFixed(4)}</span>
                              <span>Conf: {(issue.confidence * 100).toFixed(0)}%</span>
                              <span>Obs: {issue.observation_count} bus{issue.observation_count !== 1 ? "es" : ""}</span>
                              {issue.department && <span className="text-slate-600 truncate max-w-[160px] font-sans">{issue.department}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge text={issue.severity} variant={issue.severity.toLowerCase()} />
                            <Badge text={issue.status} variant={issue.status === "RESOLVED" ? "success" : "default"} />
                          </div>
                        </div>
                      </Link>
                    ))
                  )}
                  {issues.length > 25 && (
                    <div className="text-center pt-2">
                      <Link href="/issues" className="text-xs text-blue-700 hover:underline font-medium">
                        View all {issues.length} detected road defects →
                      </Link>
                    </div>
                  )}
                </>
              )}

              {/* TAB 2: LIVE WEBSOCKET EVENT FEED */}
              {feedTab === "live" && (
                <>
                  {liveEvents.length === 0 ? (
                    <div className="text-center text-slate-500 py-10 text-xs space-y-2">
                      <p>WebSocket listener is connected and listening on <code className="text-slate-700">/ws/events</code>.</p>
                      <p className="text-[11px] text-slate-400">Events emitted by edge devices and telemetry appear immediately.</p>
                    </div>
                  ) : (
                    liveEvents.map((e, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between p-2.5 bg-white rounded border border-slate-200 border-l-4 text-xs"
                        style={{
                          borderLeftColor:
                            e.severity === "CRITICAL"
                              ? "#dc2626"
                              : e.severity === "HIGH"
                              ? "#ea580c"
                              : e.severity === "MEDIUM"
                              ? "#d97706"
                              : "#16a34a",
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-slate-900">{e.type || e.event_type || "EVENT"}</span>
                          {e.event_id && <span className="text-[11px] text-slate-500 font-mono">{e.event_id}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          {e.severity && <Badge text={e.severity} variant={e.severity.toLowerCase()} />}
                          <span className="text-[11px] text-slate-500 font-mono">{formatEventTime(e)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}

              {/* TAB 3: RAW TELEMETRY EVENTS */}
              {feedTab === "events" && (
                <>
                  {events.length === 0 ? (
                    <div className="text-center text-slate-500 py-10 text-xs">No telemetry records logged.</div>
                  ) : (
                    events.slice(0, 20).map((e) => (
                      <div key={e.id} className="flex items-center justify-between p-2.5 bg-white rounded border border-slate-200 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-900 font-medium">{e.event_type}</span>
                          <span className="text-slate-500 font-mono text-[11px]">{e.event_id}</span>
                          <span className="text-slate-500 font-mono text-[11px]">[{e.latitude.toFixed(4)}, {e.longitude.toFixed(4)}]</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-600 font-mono text-[11px]">{(e.confidence * 100).toFixed(0)}%</span>
                          <Badge text={e.severity} variant={e.severity.toLowerCase()} />
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">Active Road Defects</span>
              <Badge text={`${activeIssues.length} active`} variant="warning" />
            </CardHeader>
            <div className="p-3 max-h-52 overflow-y-auto space-y-1.5">
              {activeIssues.length === 0 && <p className="text-xs text-slate-500">No active issues</p>}
              {activeIssues.slice(0, 8).map((i) => (
                <Link key={i.id} href={`/issues/${i.id}`}>
                  <div className="flex items-center justify-between p-2 bg-slate-50 rounded text-xs hover:bg-slate-100 transition-colors">
                    <span className="text-slate-800 font-mono font-medium">{i.issue_id}</span>
                    <div className="flex items-center gap-1.5">
                      <Badge text={i.severity} variant={i.severity.toLowerCase()} />
                      <Badge text={i.status} variant="default" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
            <div className="p-2 border-t border-slate-200 text-right">
              <Link href="/issues" className="text-xs text-blue-700 hover:underline flex items-center justify-between px-2 font-medium">
                <span>View All {issues.length} Issues</span>
                <span>→</span>
              </Link>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">Recent Incidents</span>
              <Badge text={`${incidents.length}`} variant="critical" />
            </CardHeader>
            <div className="p-3 max-h-52 overflow-y-auto space-y-1.5">
              {incidents.length === 0 && <p className="text-xs text-slate-500">No incidents recorded</p>}
              {incidents.slice(0, 5).map((inc) => (
                <Link key={inc.id} href={`/incidents/${inc.id}`}>
                  <div className="flex items-center justify-between p-2 bg-slate-50 rounded text-xs hover:bg-slate-100 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-slate-800 font-medium truncate">{inc.incident_type}</span>
                      {inc.plate_text && <span className="text-slate-600 font-mono text-[11px]">[{inc.plate_text}]</span>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge text={inc.severity} variant={inc.severity.toLowerCase()} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Aggregate Stats Footer */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <KpiCard label="Total Events" value={stats?.total_events ?? 0} color="blue" subtitle="Cumulative platform events" />
        <KpiCard label="Total Issues" value={stats?.total_issues ?? 0} color="blue" subtitle="Cumulative defect work orders" />
        <KpiCard label="Total Incidents" value={stats?.total_incidents ?? 0} color="red" subtitle="Public safety & traffic alerts" />
        <KpiCard label="Traffic Hotspots" value={stats?.traffic_hotspots ?? 0} color="amber" subtitle="Active congested segments" />
      </div>
    </div>
  );
}
