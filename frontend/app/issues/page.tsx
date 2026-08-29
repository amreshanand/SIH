"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { Card, Badge } from "@/components/ui/Card";
import Link from "next/link";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { Issue } from "@/types";

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "border-l-red-500 bg-red-500/5",
  HIGH: "border-l-orange-500 bg-orange-500/5",
  MEDIUM: "border-l-yellow-500 bg-yellow-500/5",
  LOW: "border-l-green-500 bg-green-500/5",
};

const ISSUE_ICONS: Record<string, string> = {
  POTHOLE: "🕳️",
  ROAD_CRACK: "🔍",
  DAMAGED_ROAD: "🛣️",
  WATERLOGGING: "🌊",
  MISSING_SIGN: "🚫",
  DAMAGED_SIGN: "🪧",
  MISSING_CROSSING: "🚶",
  MISSING_DIVIDER: "🏗️",
  STREET_LIGHT: "💡",
};

export default function IssuesPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [newCount, setNewCount] = useState(0);
  const prevIssueCount = useRef(0);

  const loadIssues = useCallback(() => {
    const params: Record<string, string> = { limit: "300" };
    if (filter !== "all") {
      params.status = filter;
    }
    return api
      .getIssues(params)
      .then((r) => {
        const incoming = r.issues as Issue[];
        setIssues(incoming);
        setLastRefresh(new Date());

        // Detect newly added issues
        if (prevIssueCount.current > 0 && incoming.length > prevIssueCount.current) {
          setNewCount((prev) => prev + (incoming.length - prevIssueCount.current));
        }
        prevIssueCount.current = incoming.length;
      })
      .catch(() => {});
  }, [filter]);

  // WebSocket for real-time updates
  useWebSocket("events", (latest) => {
    if (latest.type === "new_issue" || latest.type === "issue_updated") {
      // Trigger load after a short delay so DB has committed
      setTimeout(() => loadIssues(), 800);
    }
  });

  // Initial load and filter change
  useEffect(() => {
    loadIssues().finally(() => setLoading(false));
  }, [loadIssues]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadIssues();
    }, 10000);
    return () => clearInterval(interval);
  }, [loadIssues]);

  const refresh = () => {
    setLoading(true);
    setNewCount(0);
    loadIssues().finally(() => setLoading(false));
  };

  const stats = {
    open: issues.filter((i) => i.status === "OPEN").length,
    assigned: issues.filter((i) => i.status === "ASSIGNED").length,
    inProgress: issues.filter((i) => i.status === "IN_PROGRESS").length,
    resolved: issues.filter((i) => i.status === "RESOLVED").length,
    critical: issues.filter((i) => i.severity === "CRITICAL").length,
  };

  const secondsSinceRefresh = Math.floor((new Date().getTime() - lastRefresh.getTime()) / 1000);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            Road Issues
            {stats.critical > 0 && (
              <span className="text-xs bg-red-600/20 border border-red-500/30 text-red-400 px-2 py-0.5 rounded-full animate-pulse font-medium">
                ⚠ {stats.critical} CRITICAL
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-500">
            Detected road defects and infrastructure issues — Auto-refreshing every 10s
          </p>
        </div>
        <div className="flex items-center gap-3">
          {newCount > 0 && (
            <span className="text-xs bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 px-2 py-1 rounded animate-bounce">
              +{newCount} new detected
            </span>
          )}
          <div className="text-[10px] text-gray-600 font-mono">
            Updated: {secondsSinceRefresh}s ago
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-[10px] px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-400 hover:text-white hover:border-gray-500 transition-colors disabled:opacity-50"
          >
            {loading ? "Loading..." : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Open", value: stats.open, colorClass: "border-red-500/30 text-red-400" },
          { label: "Assigned", value: stats.assigned, colorClass: "border-orange-500/30 text-orange-400" },
          { label: "In Progress", value: stats.inProgress, colorClass: "border-blue-500/30 text-blue-400" },
          { label: "Resolved", value: stats.resolved, colorClass: "border-green-500/30 text-green-400" },
          { label: "Total", value: issues.length, colorClass: "border-gray-500/30 text-gray-300" },
        ].map((s) => (
          <div key={s.label} className={`bg-gray-900 border ${s.colorClass} rounded-lg p-3 border-l-2`}>
            <div className="text-[10px] uppercase tracking-widest text-gray-500">{s.label}</div>
            <div className={`text-xl font-bold mt-1 ${s.colorClass.split(" ")[1]}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Live indicator */}
      <div className="flex items-center gap-2 text-[11px] text-gray-500">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span>Live AI detection active — new issues appear automatically</span>
        <span className="text-gray-700">|</span>
        <span className="font-mono">{issues.length} issues loaded</span>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {["all", "OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_VERIFICATION", "RESOLVED"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[10px] px-3 py-1.5 rounded border transition-colors ${
              filter === f
                ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
                : "bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-600"
            }`}
          >
            {f === "all" ? "ALL" : f.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {/* Issue list */}
      <div className="space-y-2">
        {issues.map((issue) => {
          const icon = ISSUE_ICONS[issue.issue_type] || "📋";
          const sevClass = SEV_COLOR[issue.severity] || "border-l-gray-500";
          const ev = issue.evidence_urls || [];
          const thumbUrl = ev[0]
            ? (ev[0].startsWith("http") ? ev[0] : `http://localhost:8000/${ev[0]}`)
            : null;

          return (
            <Link key={issue.id} href={`/issues/${issue.id}`}>
              <div
                className={`group flex items-center gap-4 p-3 rounded-lg border border-gray-800 border-l-4 ${sevClass} hover:border-gray-600 hover:bg-gray-900/80 transition-all cursor-pointer`}
              >
                {/* Thumbnail */}
                <div className="w-14 h-10 rounded overflow-hidden bg-gray-950 border border-gray-800 flex-shrink-0">
                  {thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbUrl}
                      alt="Evidence thumbnail"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-lg">{icon}</div>
                  )}
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white font-mono">{issue.issue_id}</span>
                    <Badge text={issue.severity} variant={issue.severity.toLowerCase()} />
                    <span className="text-xs text-gray-400">{icon} {issue.issue_type.replace(/_/g, " ")}</span>
                    <Badge text={issue.status} variant={issue.status === "RESOLVED" ? "success" : "default"} />
                    {issue.department && (
                      <span className="text-[9px] text-gray-600 bg-gray-800/80 px-1.5 py-0.5 rounded">
                        {issue.department}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-[10px] text-gray-500 font-mono">
                    <span>📍 {issue.latitude?.toFixed(5)}, {issue.longitude?.toFixed(5)}</span>
                    <span>Conf: {(issue.confidence * 100).toFixed(0)}%</span>
                    <span>Obs: {issue.observation_count}</span>
                    {ev.length > 0 && (
                      <span className="text-cyan-600">📸 {ev.length} frame{ev.length !== 1 ? "s" : ""}</span>
                    )}
                  </div>
                </div>

                {/* Right side: time + arrow */}
                <div className="text-right flex-shrink-0">
                  <div className="text-[10px] text-gray-500">
                    {new Date(issue.created_at).toLocaleDateString()}
                  </div>
                  <div className="text-[10px] text-gray-600">
                    {new Date(issue.created_at).toLocaleTimeString()}
                  </div>
                  <span className="text-[11px] text-cyan-500 group-hover:text-cyan-300 transition-colors">
                    View →
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
        {issues.length === 0 && !loading && (
          <Card>
            <div className="p-8 text-center text-gray-600 text-xs">
              No issues found. Seed demo data:{" "}
              <code className="bg-gray-800 px-1.5 py-0.5 rounded">POST /api/demo/seed</code>
            </div>
          </Card>
        )}
        {loading && issues.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-8 animate-pulse">Loading road issues...</div>
        )}
      </div>
    </div>
  );
}
