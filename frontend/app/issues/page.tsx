"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { api, getEvidenceImageUrl } from "@/lib/api";
import { Card, Badge } from "@/components/ui/Card";
import Link from "next/link";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { Issue } from "@/types";

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "border-l-red-600",
  HIGH: "border-l-amber-600",
  MEDIUM: "border-l-amber-500",
  LOW: "border-l-slate-400",
};

export default function IssuesPage() {
  const [allIssues, setAllIssues] = useState<Issue[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [newCount, setNewCount] = useState(0);
  const prevIssueCount = useRef(0);

  const loadIssues = useCallback(() => {
    setError(null);
    return api
      .getIssues({ limit: "500" })
      .then((r) => {
        const incoming = (r?.issues || []) as Issue[];
        setAllIssues(incoming);
        setLastRefresh(new Date());

        // Detect newly added issues
        if (prevIssueCount.current > 0 && incoming.length > prevIssueCount.current) {
          setNewCount((prev) => prev + (incoming.length - prevIssueCount.current));
        }
        prevIssueCount.current = incoming.length;
      })
      .catch((err) => {
        console.error("Failed to load issues:", err);
        setError("Failed to connect to backend server. Retrying...");
      });
  }, []);

  // WebSocket for real-time updates
  useWebSocket("events", (latest) => {
    if (latest && typeof latest === "object" && "event_type" in latest) {
      loadIssues();
    }
  });

  useEffect(() => {
    loadIssues().finally(() => setLoading(false));
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

  const filteredIssues = useMemo(() => {
    if (filter === "all") return allIssues;
    return allIssues.filter((issue) => issue.status === filter);
  }, [allIssues, filter]);

  const stats = useMemo(() => {
    return {
      open: allIssues.filter((i) => i.status === "OPEN" || i.status === "DETECTED" || i.status === "CONFIRMED").length,
      assigned: allIssues.filter((i) => i.status === "ASSIGNED").length,
      inProgress: allIssues.filter((i) => i.status === "IN_PROGRESS").length,
      resolved: allIssues.filter((i) => i.status === "RESOLVED").length,
      critical: allIssues.filter((i) => i.severity === "CRITICAL").length,
      total: allIssues.length,
    };
  }, [allIssues]);

  const secondsSinceRefresh = Math.floor((new Date().getTime() - lastRefresh.getTime()) / 1000);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-3">
            Road Infrastructure Defects Registry
            {stats.critical > 0 && (
              <span className="text-xs bg-red-100 border border-red-300 text-red-800 px-2 py-0.5 rounded font-semibold">
                {stats.critical} Critical
              </span>
            )}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Automated mobile defect logs and municipal repair work orders
          </p>
        </div>
        <div className="flex items-center gap-3">
          {newCount > 0 && (
            <span className="text-xs bg-blue-100 border border-blue-300 text-blue-800 px-2 py-0.5 rounded font-medium">
              +{newCount} new
            </span>
          )}
          <div className="text-[11px] text-slate-500 font-mono">
            Synced {secondsSinceRefresh}s ago
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-xs px-3 py-1.5 bg-white border border-slate-300 rounded text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 font-medium"
          >
            {loading ? "Syncing..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Stats derived from allIssues */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: "Active / Open", value: stats.open },
          { label: "Assigned", value: stats.assigned },
          { label: "In Progress", value: stats.inProgress },
          { label: "Resolved", value: stats.resolved },
          { label: "Total Tracked", value: stats.total },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-slate-200 rounded p-3">
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{s.label}</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {[
          "all",
          "OPEN",
          "DETECTED",
          "CONFIRMED",
          "ASSIGNED",
          "IN_PROGRESS",
          "PENDING_VERIFICATION",
          "RESOLVED",
          "REOPENED",
        ].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded border transition-colors ${
              filter === f
                ? "bg-blue-50 text-blue-700 border-blue-300 font-semibold"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {f === "all" ? "ALL" : f.replace(/_/g, " ")} ({f === "all" ? allIssues.length : allIssues.filter((i) => i.status === f).length})
          </button>
        ))}
      </div>

      {/* Issue list */}
      <div className="space-y-2">
        {filteredIssues.map((issue) => {
          const sevClass = SEV_COLOR[issue.severity] || "border-l-slate-400";
          const ev = issue.evidence_urls || [];
          const thumbUrl = ev[0] ? getEvidenceImageUrl(ev[0]) : null;

          return (
            <Link key={issue.id} href={`/issues/${issue.id}`}>
              <div
                className={`flex items-center gap-4 p-3 rounded bg-white border border-slate-200 border-l-4 ${sevClass} hover:bg-slate-50 transition-colors cursor-pointer`}
              >
                {/* Thumbnail */}
                <div className="w-16 h-12 rounded overflow-hidden bg-slate-100 border border-slate-200 flex-shrink-0">
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
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400 font-mono">
                      NO SNAP
                    </div>
                  )}
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-900 font-mono">{issue.issue_id}</span>
                    <Badge text={issue.severity} variant={issue.severity.toLowerCase()} />
                    <span className="text-xs text-slate-700 font-medium">{issue.issue_type.replace(/_/g, " ")}</span>
                    <Badge text={issue.status} variant={issue.status.toLowerCase()} />
                    {issue.consensus_level && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-200 font-mono">
                        {issue.consensus_level}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-4 flex-wrap">
                    <span>Dept: <strong className="text-slate-700 font-medium">{issue.department || "Unassigned"}</strong></span>
                    <span>GPS: <span className="font-mono">{issue.latitude.toFixed(4)}, {issue.longitude.toFixed(4)}</span></span>
                    <span>Passes: <strong className="text-slate-700 font-medium">{issue.observation_count}</strong></span>
                    <span>Confidence: <strong className="text-slate-700 font-medium">{(issue.confidence * 100).toFixed(0)}%</strong></span>
                    <span>Last: {new Date(issue.last_seen).toLocaleDateString()}</span>
                  </div>
                </div>

                {/* Right side: view link */}
                <div className="text-right flex-shrink-0">
                  <span className="text-xs text-blue-600 font-medium hover:text-blue-800">
                    View →
                  </span>
                </div>
              </div>
            </Link>
          );
        })}

        {error && (
          <Card>
            <div className="p-6 text-center space-y-3">
              <p className="text-red-400 text-sm font-medium">{error}</p>
              <button
                onClick={refresh}
                className="px-4 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/40 rounded text-xs transition-colors"
              >
                ↻ Retry Loading
              </button>
            </div>
          </Card>
        )}
        {filteredIssues.length === 0 && !loading && !error && (
          <Card>
            <div className="p-8 text-center text-gray-600 text-xs">
              No issues found for current filter. Seed demo data:{" "}
              <code className="bg-gray-800 px-1.5 py-0.5 rounded">POST /api/demo/seed</code>
            </div>
          </Card>
        )}
        {loading && allIssues.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-8 animate-pulse">Loading road issues...</div>
        )}
      </div>
    </div>
  );
}
