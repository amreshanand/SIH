"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { api, getEvidenceImageUrl } from "@/lib/api";
import { Card, Badge } from "@/components/ui/Card";
import Link from "next/link";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { Issue } from "@/types";

const SEV_CONFIG: Record<string, { border: string; glow: string; text: string; bg: string }> = {
  CRITICAL: {
    border: "border-l-rose-500",
    glow: "hover:shadow-rose-500/10",
    text: "text-rose-600",
    bg: "bg-rose-50",
  },
  HIGH: {
    border: "border-l-amber-500",
    glow: "hover:shadow-amber-500/10",
    text: "text-amber-600",
    bg: "bg-amber-50",
  },
  MEDIUM: {
    border: "border-l-blue-500",
    glow: "hover:shadow-blue-500/10",
    text: "text-blue-600",
    bg: "bg-blue-50",
  },
  LOW: {
    border: "border-l-slate-400",
    glow: "",
    text: "text-slate-600",
    bg: "bg-slate-50",
  },
};

export default function IssuesPage() {
  const [allIssues, setAllIssues] = useState<Issue[]>([]);
  const [filter, setFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
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
    if (latest && typeof latest === "object") {
      loadIssues();
    }
  });

  useEffect(() => {
    loadIssues().finally(() => setLoading(false));
    const interval = setInterval(() => {
      loadIssues();
    }, 8000);
    return () => clearInterval(interval);
  }, [loadIssues]);

  const refresh = () => {
    setLoading(true);
    setNewCount(0);
    loadIssues().finally(() => setLoading(false));
  };

  const [selectedChunk, setSelectedChunk] = useState<string>("all");
  const [dispatchingChunk, setDispatchingChunk] = useState<boolean>(false);
  const [dispatchMsg, setDispatchMsg] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const chunk = params.get("chunk");
      if (chunk) {
        setSelectedChunk(chunk);
      }
    }
  }, []);

  const filteredIssues = useMemo(() => {
    return allIssues.filter((issue) => {
      const matchesFilter = filter === "all" || issue.status === filter;
      if (!matchesFilter) return false;

      const matchesChunk = selectedChunk === "all" || (issue.chunk_id || "").toUpperCase() === selectedChunk.toUpperCase();
      if (!matchesChunk) return false;

      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        issue.issue_id?.toLowerCase().includes(q) ||
        issue.issue_type?.toLowerCase().includes(q) ||
        issue.department?.toLowerCase().includes(q) ||
        issue.severity?.toLowerCase().includes(q) ||
        issue.chunk_id?.toLowerCase().includes(q) ||
        issue.chunk_name?.toLowerCase().includes(q) ||
        issue.affected_road?.toLowerCase().includes(q)
      );
    });
  }, [allIssues, filter, selectedChunk, searchQuery]);

  const uniqueChunks = useMemo(() => {
    const map = new Map<string, { id: string; count: number; name?: string }>();
    allIssues.forEach((i) => {
      if (i.chunk_id) {
        const existing = map.get(i.chunk_id);
        if (existing) {
          existing.count += 1;
        } else {
          map.set(i.chunk_id, { id: i.chunk_id, count: 1, name: i.chunk_name || i.affected_road || undefined });
        }
      }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [allIssues]);

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
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Banner / Header */}
      <Card className="p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-pulse" />
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Road Infrastructure Defects Registry
              </h1>
              {stats.critical > 0 && (
                <span className="text-xs bg-rose-50 border border-rose-200 text-rose-700 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1.5 shadow-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                  {stats.critical} Critical
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Automated Pune transit sensor defect logs &bull; Multi-pass consensus verification &bull; Municipal work orders
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {newCount > 0 && (
              <span className="text-xs bg-blue-50 border border-blue-200 text-blue-700 px-2.5 py-1 rounded-full font-mono font-bold animate-pulse">
                +{newCount} new defects
              </span>
            )}
            <div className="text-xs text-slate-600 font-mono bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Synced {secondsSinceRefresh}s ago
            </div>
            <button
              onClick={refresh}
              disabled={loading}
              className="text-xs px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all disabled:opacity-50 font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <span className={loading ? "animate-spin" : ""}>↻</span>
              {loading ? "Syncing..." : "Refresh"}
            </button>
          </div>
        </div>
      </Card>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {[
          { label: "Active / Open", value: stats.open, color: "text-amber-600", border: "border-l-4 border-l-amber-500" },
          { label: "Assigned Work Orders", value: stats.assigned, color: "text-blue-600", border: "border-l-4 border-l-blue-500" },
          { label: "Repair In Progress", value: stats.inProgress, color: "text-purple-600", border: "border-l-4 border-l-purple-500" },
          { label: "Resolved Defects", value: stats.resolved, color: "text-emerald-600", border: "border-l-4 border-l-emerald-500" },
          { label: "Total Logged", value: stats.total, color: "text-slate-900", border: "border-l-4 border-l-slate-400" },
        ].map((s) => (
          <Card
            key={s.label}
            className={`p-3.5 ${s.border} hover:shadow-sm transition-all`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono">{s.label}</div>
            <div className={`text-2xl font-bold font-mono ${s.color} mt-1.5 tracking-tight`}>{s.value}</div>
          </Card>
        ))}
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Filter Pills */}
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
          ].map((f) => {
            const count = f === "all" ? allIssues.length : allIssues.filter((i) => i.status === f).length;
            const active = filter === f;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-all cursor-pointer font-semibold flex items-center gap-1.5 shadow-xs ${
                  active
                    ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <span>{f === "all" ? "ALL DEFECTS" : f.replace(/_/g, " ")}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                    active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Road Chunk Filter Dropdown & Search */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 shadow-xs text-xs font-mono">
            <span className="text-slate-500 font-semibold">500M CHUNK:</span>
            <select
              value={selectedChunk}
              onChange={(e) => setSelectedChunk(e.target.value)}
              className="bg-transparent text-xs font-semibold text-blue-700 border-0 focus:ring-0 cursor-pointer max-w-[210px]"
            >
              <option value="all">All Chunks ({uniqueChunks.length} active)</option>
              {uniqueChunks.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} ({c.count} {c.count === 1 ? 'defect' : 'defects'})
                </option>
              ))}
            </select>
          </div>

          {/* Search Input */}
          <div className="relative min-w-[220px]">
            <input
              type="text"
              placeholder="Search ID, chunk, type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs bg-white border border-slate-300 rounded-lg pl-3 pr-8 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-colors font-medium shadow-xs"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Chunk Remediation & Dispatch Banner (when a specific chunk is filtered) */}
      {selectedChunk !== "all" && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between flex-wrap gap-3 shadow-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <span className="text-xl">🛣️</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-blue-900 bg-blue-200/70 border border-blue-300 px-2 py-0.5 rounded">
                  {selectedChunk}
                </span>
                <span className="text-xs font-bold text-slate-900">
                  {filteredIssues[0]?.chunk_name || "500m Road Segment"}
                </span>
                {filteredIssues[0]?.chunk_chainage && (
                  <span className="text-xs font-mono text-slate-600 font-medium">
                    ({filteredIssues[0].chunk_chainage})
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Filtering <strong className="text-slate-900">{filteredIssues.length}</strong> active pavement defect(s) on this station.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/map?chunk=${selectedChunk}`}
              className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5 shadow-2xs"
            >
              <span>🗺️</span>
              <span>Inspect on GIS Map</span>
            </Link>
            <button
              onClick={() => {
                const headers = ["Issue ID", "Type", "Severity", "Status", "Chunk ID", "Road", "Chainage", "Latitude", "Longitude", "Confidence", "Department"];
                const rows = filteredIssues.map((i) => [
                  i.issue_id,
                  i.issue_type,
                  i.severity,
                  i.status,
                  i.chunk_id || "",
                  `"${(i.chunk_name || i.affected_road || "").replace(/"/g, '""')}"`,
                  i.chunk_chainage || "",
                  i.latitude,
                  i.longitude,
                  Math.round(i.confidence * 100) + "%",
                  i.department || "Unassigned",
                ]);
                const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
                const link = document.createElement("a");
                link.setAttribute("href", encodeURI(csvContent));
                link.setAttribute("download", `work_order_${selectedChunk}.csv`);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
              className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <span>📥</span>
              <span>Export CSV</span>
            </button>
            <button
              disabled={dispatchingChunk || filteredIssues.length === 0}
              onClick={async () => {
                setDispatchingChunk(true);
                try {
                  const res = await api.dispatchChunk(selectedChunk);
                  setDispatchMsg(`✅ ${res.message} (Work Order: ${res.work_order_id})`);
                  loadIssues();
                  setTimeout(() => setDispatchMsg(null), 6000);
                } catch (e: any) {
                  alert(`Dispatch failed: ${e?.message || e}`);
                } finally {
                  setDispatchingChunk(false);
                }
              }}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <span>⚡</span>
              <span>{dispatchingChunk ? "Dispatching..." : "Dispatch Remediation"}</span>
            </button>
            <button
              onClick={() => setSelectedChunk("all")}
              className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1 font-semibold cursor-pointer"
            >
              ✕ Clear Filter
            </button>
          </div>
        </div>
      )}

      {/* Dispatch Success Alert */}
      {dispatchMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-4 py-2.5 rounded-lg flex items-center justify-between shadow-xs font-semibold">
          <span>{dispatchMsg}</span>
          <button onClick={() => setDispatchMsg(null)} className="text-emerald-700 font-bold cursor-pointer">✕</button>
        </div>
      )}

      {/* Defects List */}
      <div className="space-y-2.5">
        {filteredIssues.map((issue) => {
          const cfg = SEV_CONFIG[issue.severity] || SEV_CONFIG.LOW;
          const ev = issue.evidence_urls || [];
          const thumbUrl = ev[0] ? getEvidenceImageUrl(ev[0]) : null;

          return (
            <Link key={issue.id} href={`/issues/${issue.id}`} className="block group">
              <div
                className={`flex items-center gap-4 p-3.5 rounded-xl bg-white border border-slate-200/90 border-l-4 ${cfg.border} hover:border-slate-300 hover:shadow-md transition-all duration-200 cursor-pointer shadow-xs group-hover:translate-x-0.5`}
              >
                {/* Evidence Thumbnail */}
                <div className="w-20 h-14 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 flex-shrink-0 relative group-hover:border-blue-400 transition-colors">
                  {thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbUrl}
                      alt="Defect Snapshot"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-[9px] text-slate-400 font-mono font-bold">
                      <span>RAD-SNAP</span>
                    </div>
                  )}
                  <div className="absolute bottom-0 inset-x-0 bg-slate-900/80 text-[8px] font-mono text-center text-slate-200 py-0.5">
                    CAM-01
                  </div>
                </div>

                {/* Main Defect Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-xs font-bold text-slate-900 font-mono tracking-wider">{issue.issue_id}</span>
                    <Badge text={issue.severity} variant={issue.severity.toLowerCase()} />
                    <span className="text-xs text-slate-800 font-bold uppercase tracking-wide">
                      {issue.issue_type.replace(/_/g, " ")}
                    </span>
                    <Badge text={issue.status} variant={issue.status.toLowerCase()} />
                    {issue.consensus_level && (
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 font-mono font-semibold">
                        {issue.consensus_level}
                      </span>
                    )}
                    {issue.chunk_id && (
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200 font-mono font-bold flex items-center gap-1 shadow-xs">
                        <span>📍</span>
                        <span>{issue.chunk_id}</span>
                        <span className="text-blue-500 font-normal">({issue.chunk_chainage || "500m"})</span>
                      </span>
                    )}
                  </div>

                  <div className="text-[11px] text-slate-600 mt-1.5 flex items-center gap-x-4 gap-y-1 flex-wrap">
                    {issue.chunk_name && (
                      <span className="flex items-center gap-1">
                        <span className="text-slate-400">Road Stretch:</span>
                        <strong className="text-slate-900 font-semibold truncate max-w-[260px]" title={issue.chunk_name}>
                          {issue.chunk_name}
                        </strong>
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <span className="text-slate-400">Dept:</span>
                      <strong className="text-slate-700 font-semibold">{issue.department || "Municipal Road Dept"}</strong>
                    </span>
                    <span className="flex items-center gap-1 font-mono">
                      <span className="text-slate-400">GPS:</span>
                      <span className="text-slate-700 font-medium">{issue.latitude.toFixed(4)}, {issue.longitude.toFixed(4)}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="text-slate-400">Consensus Passes:</span>
                      <strong className="text-emerald-700 font-mono font-bold">{issue.observation_count}</strong>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="text-slate-400">Confidence:</span>
                      <strong className="text-blue-700 font-mono font-bold">{(issue.confidence * 100).toFixed(0)}%</strong>
                    </span>
                    <span className="text-slate-400 text-[10px] font-mono">
                      {new Date(issue.last_seen).toLocaleDateString()} {new Date(issue.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>

                {/* Right Action */}
                <div className="text-right flex-shrink-0 pr-2">
                  <span className="text-xs text-blue-600 group-hover:text-blue-700 font-bold flex items-center gap-1 transition-colors">
                    <span>Inspect</span>
                    <span className="group-hover:translate-x-1 transition-transform">→</span>
                  </span>
                </div>
              </div>
            </Link>
          );
        })}

        {error && (
          <Card>
            <div className="p-8 text-center space-y-3">
              <p className="text-rose-400 text-sm font-medium">{error}</p>
              <button
                onClick={refresh}
                className="px-4 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 rounded-lg text-xs transition-colors cursor-pointer"
              >
                ↻ Retry Loading
              </button>
            </div>
          </Card>
        )}

        {filteredIssues.length === 0 && !loading && !error && (
          <Card>
            <div className="p-12 text-center text-slate-400 text-xs space-y-2">
              <div className="text-slate-500 text-sm">No defects found for current filter.</div>
              <p className="text-slate-500 font-mono">
                Continuous sensing worker is broadcasting real-time Pune transit issues.
              </p>
            </div>
          </Card>
        )}

        {loading && allIssues.length === 0 && (
          <div className="text-center text-slate-400 text-xs py-12 flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span className="font-mono">Synchronizing defects registry...</span>
          </div>
        )}
      </div>
    </div>
  );
}
