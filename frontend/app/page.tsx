"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { api } from "@/lib/api";
import { DashboardStats, Event, Issue } from "@/types";
import { KpiCard, Card, CardHeader, Badge } from "@/components/ui/Card";

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

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const { messages, connected } = useWebSocket("events");
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const liveEvents = useMemo<LiveEvent[]>(() => messages.slice(0, 20) as LiveEvent[], [messages]);

  const refreshStats = useCallback(() => {
    api.getDashboardStats().then(setStats).catch(console.error);
    api.getEvents().then((r) => setEvents(r.events)).catch(console.error);
    api.getIssues().then((r) => setIssues(r.issues)).catch(console.error);
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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Urban Command Center</h1>
          <p className="text-sm text-gray-500">UrbanSense AI — Real-time monitoring</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
          <span className="text-[10px] text-gray-500">{connected ? "LIVE" : "DISCONNECTED"}</span>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <KpiCard label="Active Buses" value={stats?.active_buses ?? 0} color="cyan" />
        <KpiCard label="Events Today" value={stats?.events_today ?? 0} color="blue" />
        <KpiCard label="Open Issues" value={stats?.open_issues ?? 0} color="orange" />
        <KpiCard label="Critical Incidents" value={stats?.critical_incidents ?? 0} color="red" />
        <KpiCard label="Resolved Issues" value={stats?.resolved_issues ?? 0} color="green" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Card>
            <CardHeader>
              <span className="text-sm font-medium text-gray-300">Live Event Feed</span>
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-gray-600"}`} />
                <Badge text={`${liveEvents.length} live`} variant={connected ? "success" : "default"} />
              </div>
            </CardHeader>
            <div className="p-4 max-h-[400px] overflow-y-auto space-y-1.5">
              {liveEvents.length === 0 && (
                <div className="text-center text-gray-600 py-8 text-xs">
                  Waiting for live events...<br/>
                  <span className="text-[10px] text-gray-700">Start the edge AI pipeline to see real-time detections</span>
                </div>
              )}
              {liveEvents.map((e, i) => (
                <div key={i} className="flex items-center justify-between p-2 bg-gray-800/50 rounded border-l-2" style={{borderLeftColor: e.severity === "CRITICAL" ? "#ef4444" : e.severity === "HIGH" ? "#f97316" : e.severity === "MEDIUM" ? "#eab308" : "#22c55e"}}>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-white">{e.type || e.event_type || "EVENT"}</span>
                    {e.event_id && <span className="text-[10px] text-gray-500">{e.event_id}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {e.severity && <Badge text={e.severity} variant={e.severity.toLowerCase()} />}
                    <span className="text-[10px] text-gray-500">{formatEventTime(e)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <span className="text-sm font-medium text-gray-300">Recent Events</span>
            </CardHeader>
            <div className="p-4 max-h-48 overflow-y-auto space-y-1.5">
              {events.length === 0 && <p className="text-[10px] text-gray-600">No events yet</p>}
              {events.slice(0, 8).map((e) => (
                <div key={e.id} className="flex items-center justify-between p-1.5 bg-gray-800/30 rounded text-[10px]">
                  <span className="text-gray-300">{e.event_type}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">{(e.confidence * 100).toFixed(0)}%</span>
                    <Badge text={e.severity} variant={e.severity.toLowerCase()} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <span className="text-sm font-medium text-gray-300">Open Issues</span>
            </CardHeader>
            <div className="p-4 max-h-48 overflow-y-auto space-y-1.5">
              {issues.length === 0 && <p className="text-[10px] text-gray-600">No open issues</p>}
              {issues.slice(0, 8).map((i) => (
                <div key={i.id} className="flex items-center justify-between p-1.5 bg-gray-800/30 rounded text-[10px]">
                  <span className="text-gray-300">{i.issue_id}</span>
                  <div className="flex items-center gap-1.5">
                    <Badge text={i.severity} variant={i.severity.toLowerCase()} />
                    <Badge text={i.status} variant={i.status === "RESOLVED" ? "success" : "default"} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <KpiCard label="Total Events" value={stats?.total_events ?? 0} color="purple" subtitle="All time" />
        <KpiCard label="Total Issues" value={stats?.total_issues ?? 0} color="blue" subtitle="All time" />
        <KpiCard label="Total Incidents" value={stats?.total_incidents ?? 0} color="red" subtitle="All time" />
        <KpiCard label="Traffic Hotspots" value={stats?.traffic_hotspots ?? 0} color="orange" subtitle="Active" />
        <KpiCard label="WS Status" value={connected ? "LIVE" : "OFF"} color={connected ? "green" : "red"} subtitle="WebSocket" />
      </div>
    </div>
  );
}
