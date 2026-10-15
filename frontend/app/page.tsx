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
  bus_number?: string;
  road_name?: string;
}

function formatEventTime(e: LiveEvent): string {
  if (e.timestamp) return new Date(e.timestamp).toLocaleTimeString();
  if (e.created_at) return new Date(e.created_at).toLocaleTimeString();
  return "just now";
}

const DEFAULT_DEMO_STATS: DashboardStats = {
  active_buses: 6,
  events_today: 48,
  open_issues: 12,
  critical_incidents: 2,
  resolved_issues: 18,
  total_events: 184,
  total_issues: 31,
  total_incidents: 5,
  traffic_hotspots: 4,
};

const DEFAULT_DEMO_ISSUES: Issue[] = [
  {
    id: "issue-demo-001",
    issue_id: "RS-2026-039101",
    issue_type: "POTHOLE",
    severity: "HIGH",
    confidence: 0.94,
    latitude: 18.5318,
    longitude: 73.8428,
    first_seen: new Date(Date.now() - 3600000 * 2).toISOString(),
    last_seen: new Date(Date.now() - 300000).toISOString(),
    observation_count: 5,
    affected_road: "FC Road BRT Corridor, Shivaji Nagar",
    department: "ROAD_MAINTENANCE",
    status: "OPEN",
    consensus_level: "CONFIRMED",
    metadata_json: {},
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    updated_at: new Date(Date.now() - 300000).toISOString(),
  },
  {
    id: "issue-demo-002",
    issue_id: "RS-2026-039102",
    issue_type: "ALLIGATOR_CRACK",
    severity: "HIGH",
    confidence: 0.88,
    latitude: 18.5284,
    longitude: 73.8465,
    first_seen: new Date(Date.now() - 3600000 * 4).toISOString(),
    last_seen: new Date(Date.now() - 600000).toISOString(),
    observation_count: 4,
    affected_road: "JM Road Near Sambhaji Park",
    department: "ROAD_MAINTENANCE",
    status: "ASSIGNED",
    consensus_level: "CONFIRMED",
    metadata_json: {},
    created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
    updated_at: new Date(Date.now() - 600000).toISOString(),
  },
  {
    id: "issue-demo-003",
    issue_id: "RS-2026-039103",
    issue_type: "UTILITY_COVER_DAMAGE",
    severity: "CRITICAL",
    confidence: 0.96,
    latitude: 18.5520,
    longitude: 73.8820,
    first_seen: new Date(Date.now() - 3600000 * 1).toISOString(),
    last_seen: new Date(Date.now() - 150000).toISOString(),
    observation_count: 6,
    affected_road: "Yerawada Bridge / Gunjan Chowk",
    department: "DRAINAGE",
    status: "IN_PROGRESS",
    consensus_level: "CONFIRMED",
    metadata_json: {},
    created_at: new Date(Date.now() - 3600000 * 1).toISOString(),
    updated_at: new Date(Date.now() - 150000).toISOString(),
  },
];

const DEFAULT_DEMO_INCIDENTS: Incident[] = [
  {
    id: "inc-demo-001",
    incident_id: "INC-2026-0091",
    incident_type: "RASH_DRIVING",
    bus_id: "BUS-002",
    severity: "CRITICAL",
    confidence: 0.94,
    latitude: 18.5679,
    longitude: 73.9143,
    plate_text: "MH-12-XY-9044",
    plate_confidence: 0.91,
    evidence_url: "/evidence/pothole_detected_2.jpg",
    status: "OPEN",
    created_at: new Date(Date.now() - 900000).toISOString(),
  },
  {
    id: "inc-demo-002",
    incident_id: "INC-2026-0092",
    incident_type: "PEDESTRIAN_RISK",
    bus_id: "BUS-004",
    severity: "HIGH",
    confidence: 0.89,
    latitude: 18.5360,
    longitude: 73.8340,
    plate_text: "MH-14-CD-7890",
    plate_confidence: 0.88,
    evidence_url: null,
    status: "OPEN",
    created_at: new Date(Date.now() - 2400000).toISOString(),
  },
];

const DEFAULT_DEMO_EVENTS: Event[] = [
  {
    id: "evt-demo-001",
    event_id: "EVT-LIVE-39828",
    event_type: "POTHOLE",
    bus_id: "BUS-001",
    camera_id: "CAM-FRONT",
    severity: "HIGH",
    confidence: 0.94,
    latitude: 18.5318,
    longitude: 73.8428,
    evidence_url: "/evidence/pothole_detected_2.jpg",
    metadata_json: { road_name: "FC Road BRT Corridor, Shivaji Nagar" },
    source: "EDGE_AI",
    status: "ACTIVE",
    created_at: new Date(Date.now() - 120000).toISOString(),
    updated_at: new Date(Date.now() - 120000).toISOString(),
  },
];

const FLEET_STATUS = [
  { id: "BUS-001", corridor: "FC Road - University Corridor", speed: "34 km/h", status: "ONLINE", cam: "FRONT+CABIN" },
  { id: "BUS-002", corridor: "JM Road - Deccan Gymkhana", speed: "28 km/h", status: "ONLINE", cam: "FRONT+REAR" },
  { id: "BUS-003", corridor: "Yerawada - Viman Nagar BRT", speed: "42 km/h", status: "ONLINE", cam: "FRONT" },
  { id: "BUS-004", corridor: "Swargate - Tilak Road Hub", speed: "21 km/h", status: "ONLINE", cam: "FRONT+CABIN" },
  { id: "BUS-005", corridor: "Karve Road - Kothrud Express", speed: "38 km/h", status: "ONLINE", cam: "FRONT" },
  { id: "BUS-006", corridor: "Hadapsar - Magarpatta Link", speed: "31 km/h", status: "ONLINE", cam: "FRONT" },
];

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_DEMO_STATS);
  const [events, setEvents] = useState<Event[]>(DEFAULT_DEMO_EVENTS);
  const [issues, setIssues] = useState<Issue[]>(DEFAULT_DEMO_ISSUES);
  const [incidents, setIncidents] = useState<Incident[]>(DEFAULT_DEMO_INCIDENTS);
  const [feedTab, setFeedTab] = useState<"issues" | "live" | "events">("issues");
  const [searchTerm, setSearchTerm] = useState("");
  const { messages, connected } = useWebSocket("events");
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const liveEvents = useMemo<LiveEvent[]>(() => {
    if (messages.length > 0) return messages.slice(0, 30) as LiveEvent[];
    return DEFAULT_DEMO_EVENTS.map((e) => ({
      event_id: e.event_id,
      event_type: e.event_type,
      severity: e.severity,
      created_at: e.created_at,
      road_name: (e.metadata_json as Record<string, unknown>)?.road_name as string | undefined,
    }));
  }, [messages]);

  const activeIssues = useMemo(() => issues.filter((i) => i.status !== "RESOLVED"), [issues]);

  const refreshStats = useCallback(() => {
    api.getDashboardStats().then((res) => {
      if (res && typeof res.active_buses === "number") setStats(res);
    }).catch((e) => console.warn("Failed to refresh stats:", e));

    api.getEvents({ limit: "25" }).then((r) => {
      if (r?.events && r.events.length > 0) setEvents(r.events);
    }).catch((e) => console.warn("Failed to refresh events:", e));

    api.getIssues({ limit: "150" }).then((r) => {
      if (r?.issues && r.issues.length > 0) setIssues(r.issues);
    }).catch((e) => console.warn("Failed to refresh issues:", e));

    api.getIncidents().then((r) => {
      if (r?.incidents && r.incidents.length > 0) setIncidents(r.incidents);
    }).catch((e) => console.warn("Failed to refresh incidents:", e));
  }, []);


  useEffect(() => {
    refreshStats();
    statsIntervalRef.current = setInterval(refreshStats, 4000);
    return () => {
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    };
  }, [refreshStats]);

  useEffect(() => {
    if (messages.length > 0) refreshStats();
  }, [messages.length, refreshStats]);

  const filteredIssues = useMemo(() => {
    if (!searchTerm.trim()) return issues;
    const term = searchTerm.toLowerCase();
    return issues.filter(
      (i) =>
        i.issue_id.toLowerCase().includes(term) ||
        i.issue_type.toLowerCase().includes(term) ||
        (i.affected_road && i.affected_road.toLowerCase().includes(term)) ||
        (i.department && i.department.toLowerCase().includes(term))
    );
  }, [issues, searchTerm]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Operations Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-slate-950 to-blue-950 border border-slate-800 text-white p-6 shadow-xl">
        {/* Background mesh lighting */}
        <div className="absolute -right-10 -top-10 w-80 h-80 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute right-40 -bottom-10 w-60 h-60 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-radar" />
                EDGE SENSING FLEET ACTIVE
              </span>
              <span className="text-xs text-slate-400 font-mono">
                PMPML Transit Corridor Network · Pune City
              </span>
            </div>
            <h1 className="text-2xl lg:text-3xl font-black tracking-tight text-white font-sans">
              Urban Mobility Intelligence Center
            </h1>
            <p className="text-xs text-slate-300 max-w-2xl font-medium">
              Autonomous mobile optical sensing converting transit buses into high-precision road defect scanners, traffic flow monitors, and automated municipal work order generators.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            <Link
              href="/live"
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/20 border border-white/20 text-white transition-all backdrop-blur-sm flex items-center gap-2 shadow-xs"
            >
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span>Live Dashcam</span>
            </Link>
            <Link
              href="/map"
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-md shadow-blue-600/30 flex items-center gap-1.5"
            >
              <span>GIS Spatial Map</span>
              <span className="font-mono text-xs">→</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <KpiCard
          label="Active Buses"
          value={stats?.active_buses ?? 6}
          color="blue"
          trend="100% ONLINE"
          subtitle="Pune transit mobile units"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          }
        />
        <KpiCard
          label="Events Ingested"
          value={stats?.events_today ?? 0}
          color="cyan"
          trend="LIVE STREAM"
          subtitle="Temporally confirmed"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
        <KpiCard
          label="Open Defects"
          value={stats?.open_issues ?? 0}
          color="amber"
          trend="AUTO-ROUTED"
          subtitle="Municipal action required"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />
        <KpiCard
          label="Critical Incidents"
          value={stats?.critical_incidents ?? 0}
          color="red"
          trend="POLICE ALERTS"
          subtitle="Rash driving & hazards"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <KpiCard
          label="Verified Resolved"
          value={stats?.resolved_issues ?? 0}
          color="green"
          trend="MULTI-BUS"
          subtitle="3 distinct bus clear"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* Main Content Grid: Feeds & Fleet Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Tabs for Issues / Live Event Stream / Raw Telemetry */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200/70">
                <button
                  onClick={() => setFeedTab("issues")}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    feedTab === "issues"
                      ? "bg-white text-slate-900 shadow-xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Detected Road Issues ({issues.length})
                </button>
                <button
                  onClick={() => setFeedTab("live")}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                    feedTab === "live"
                      ? "bg-white text-slate-900 shadow-xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`} />
                  Live Event Feed ({liveEvents.length})
                </button>
                <button
                  onClick={() => setFeedTab("events")}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    feedTab === "events"
                      ? "bg-white text-slate-900 shadow-xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Telemetry Log ({events.length})
                </button>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                <input
                  type="text"
                  placeholder="Filter issues..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="text-xs px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 w-36"
                />
                <Badge text={feedTab === "issues" ? `${filteredIssues.length} found` : "STREAM ACTIVE"} variant="success" />
              </div>
            </CardHeader>

            <div className="p-4 max-h-[500px] overflow-y-auto space-y-2.5">
              {/* TAB 1: ALL DETECTED ROAD ISSUES */}
              {feedTab === "issues" && (
                <>
                  {filteredIssues.length === 0 ? (
                    <div className="text-center text-slate-500 py-16 text-xs">
                      No road defects matching your search criteria.
                    </div>
                  ) : (
                    filteredIssues.slice(0, 30).map((issue) => (
                      <Link key={issue.id} href={`/issues/${issue.id}`} className="block">
                        <div className="group flex items-center justify-between p-3.5 bg-white hover:bg-slate-50/90 rounded-xl border border-slate-200/80 hover:border-slate-300 transition-all cursor-pointer shadow-2xs hover:shadow-xs">
                          <div className="min-w-0 pr-3 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-mono font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                                {issue.issue_id}
                              </span>
                              <span className="text-xs text-slate-800 font-semibold">
                                {issue.issue_type.replace(/_/g, " ")}
                              </span>
                              {issue.consensus_level && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200/60">
                                  {issue.consensus_level}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono mt-1.5 flex-wrap">
                              <span className="text-slate-700 font-sans font-medium truncate max-w-[200px]">
                                {issue.affected_road || "Transit Corridor Road"}
                              </span>
                              <span>Coord: {issue.latitude?.toFixed(4)}, {issue.longitude?.toFixed(4)}</span>
                              <span>Conf: {(issue.confidence * 100).toFixed(0)}%</span>
                              <span>Obs: {issue.observation_count} bus{issue.observation_count !== 1 ? "es" : ""}</span>
                              {issue.department && (
                                <span className="text-slate-600 font-sans truncate max-w-[140px] px-1.5 py-0.2 bg-slate-100 rounded text-[10px]">
                                  {issue.department}
                                </span>
                              )}
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
                  {filteredIssues.length > 30 && (
                    <div className="text-center pt-3">
                      <Link href="/issues" className="text-xs text-blue-600 hover:text-blue-700 font-semibold inline-flex items-center gap-1">
                        <span>View all {issues.length} detected road defects</span>
                        <span>→</span>
                      </Link>
                    </div>
                  )}
                </>
              )}

              {/* TAB 2: LIVE WEBSOCKET EVENT FEED */}
              {feedTab === "live" && (
                <>
                  {liveEvents.length === 0 ? (
                    <div className="text-center text-slate-500 py-16 text-xs space-y-2">
                      <p>WebSocket listener is connected and listening on <code className="text-slate-700 font-mono">/ws/events</code>.</p>
                      <p className="text-[11px] text-slate-400">Continuous events emitted by edge devices and telemetry stream automatically.</p>
                    </div>
                  ) : (
                    liveEvents.map((e, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-200/90 text-xs shadow-2xs hover:bg-slate-50/80 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900">{e.type || e.event_type || "EVENT"}</span>
                              {e.bus_number && (
                                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-200">
                                  {e.bus_number}
                                </span>
                              )}
                            </div>
                            {e.road_name && (
                              <p className="text-[11px] text-slate-500 truncate max-w-sm mt-0.5">{e.road_name}</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">
                          {e.severity && <Badge text={e.severity} variant={e.severity.toLowerCase()} />}
                          <span className="text-[11px] text-slate-500 font-mono font-medium">{formatEventTime(e)}</span>
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
                    <div className="text-center text-slate-500 py-16 text-xs">No telemetry records logged yet.</div>
                  ) : (
                    events.slice(0, 25).map((e) => (
                      <div key={e.id} className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-200/90 text-xs hover:bg-slate-50 transition-colors shadow-2xs">
                        <div className="flex items-center gap-2.5">
                          <span className="text-slate-900 font-bold">{e.event_type}</span>
                          <span className="text-slate-500 font-mono text-[11px]">{e.event_id}</span>
                          <span className="text-slate-400 font-mono text-[11px]">
                            [{e.latitude.toFixed(4)}, {e.longitude.toFixed(4)}]
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-600 font-mono text-[11px] font-semibold">{(e.confidence * 100).toFixed(0)}%</span>
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

        {/* Right Column: Fleet Radar & Live Incident Alerts */}
        <div className="space-y-4">
          {/* Active Fleet Transit Radar */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-radar" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-800 font-mono">
                  Transit Bus Fleet Radar
                </span>
              </div>
              <Badge text="6 BUSES SENSING" variant="online" />
            </CardHeader>
            <div className="p-3.5 space-y-2 max-h-60 overflow-y-auto">
              {FLEET_STATUS.map((bus) => (
                <div key={bus.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 hover:bg-slate-100/80 border border-slate-200/60 transition-all text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-slate-900">{bus.id}</span>
                      <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-blue-50 text-blue-700 font-semibold border border-blue-200/50">
                        {bus.cam}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 truncate max-w-[170px] mt-0.5">{bus.corridor}</p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono font-bold text-slate-800">{bus.speed}</span>
                    <span className="block text-[10px] text-emerald-600 font-semibold font-mono">ACTIVE</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-2.5 border-t border-slate-100 text-center bg-slate-50/50 rounded-b-xl">
              <Link href="/fleet" className="text-xs text-blue-600 hover:text-blue-700 font-semibold inline-flex items-center gap-1">
                <span>Open Full Fleet Telemetry</span>
                <span>→</span>
              </Link>
            </div>
          </Card>

          {/* Critical Emergency Incidents */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-800 font-mono">
                  Emergency Incidents
                </span>
              </div>
              <Badge text={`${incidents.length} active`} variant="critical" />
            </CardHeader>
            <div className="p-3.5 space-y-2 max-h-60 overflow-y-auto">
              {incidents.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">No critical incidents recorded</p>
              ) : (
                incidents.slice(0, 5).map((inc) => (
                  <Link key={inc.id} href={`/incidents/${inc.id}`} className="block">
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-rose-50/40 hover:bg-rose-50/80 border border-rose-200/60 transition-all text-xs">
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-900 font-bold truncate">{inc.incident_type}</span>
                          {inc.plate_text && (
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white text-rose-700 font-bold border border-rose-200">
                              {inc.plate_text}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">
                          ID: {inc.incident_id}
                        </span>
                      </div>
                      <Badge text={inc.severity} variant="critical" />
                    </div>
                  </Link>
                ))
              )}
            </div>
            <div className="p-2.5 border-t border-slate-100 text-center bg-slate-50/50 rounded-b-xl">
              <Link href="/incidents" className="text-xs text-rose-600 hover:text-rose-700 font-semibold inline-flex items-center gap-1">
                <span>View Command Alerts</span>
                <span>→</span>
              </Link>
            </div>
          </Card>
        </div>
      </div>

      {/* Aggregate Stats Footer */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5">
        <KpiCard
          label="Total Events Logged"
          value={stats?.total_events ?? 0}
          color="blue"
          subtitle="Cumulative sensor points"
          trend="EDGE AI"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          }
        />
        <KpiCard
          label="Total Work Orders"
          value={stats?.total_issues ?? 0}
          color="cyan"
          subtitle="Municipal defect tasks"
          trend="AUTO-ROUTED"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
          }
        />
        <KpiCard
          label="Safety Incidents"
          value={stats?.total_incidents ?? 0}
          color="red"
          subtitle="Public hazard records"
          trend="HIGH ACCURACY"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />
        <KpiCard
          label="Congestion Hotspots"
          value={stats?.traffic_hotspots ?? 0}
          color="amber"
          subtitle="Real-time transit bottlenecks"
          trend="PMRDA MONITORED"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />
      </div>
    </div>
  );
}
