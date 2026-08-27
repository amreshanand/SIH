"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Card, Badge } from "@/components/ui/Card";
import Link from "next/link";
import type { Issue } from "@/types";

export default function IssuesPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    const params = filter !== "all" ? { status: filter } : undefined;
    return api
      .getIssues(params)
      .then((r) => setIssues(r.issues))
      .catch(() => {});
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = () => {
    setLoading(true);
    load().finally(() => setLoading(false));
  };

  const stats = {
    open: issues.filter((i) => i.status === "OPEN").length,
    assigned: issues.filter((i) => i.status === "ASSIGNED").length,
    inProgress: issues.filter((i) => i.status === "IN_PROGRESS").length,
    resolved: issues.filter((i) => i.status === "RESOLVED").length,
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Road Issues</h1>
          <p className="text-sm text-gray-500">Detected road defects and infrastructure issues</p>
        </div>
        <button onClick={refresh} className="text-[10px] px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-gray-400 hover:text-white">
          ↻ Refresh
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Open", value: stats.open, colorClass: "border-red-500/20" },
          { label: "Assigned", value: stats.assigned, colorClass: "border-orange-500/20" },
          { label: "In Progress", value: stats.inProgress, colorClass: "border-blue-500/20" },
          { label: "Resolved", value: stats.resolved, colorClass: "border-green-500/20" },
        ].map((s) => (
          <div key={s.label} className={`bg-gray-900 border ${s.colorClass} rounded-lg p-3`}>
            <div className="text-[10px] uppercase tracking-widest text-gray-500">{s.label}</div>
            <div className="text-xl font-bold mt-1 text-gray-200">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
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
            {f === "all" ? "ALL" : f}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-2">
        {issues.map((issue) => (
          <Link key={issue.id} href={`/issues/${issue.id}`}>
            <Card className="hover:border-gray-600 transition-colors cursor-pointer">
              <div className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge text={issue.severity} variant={issue.severity.toLowerCase()} />
                  <span className="text-sm font-medium text-white">{issue.issue_id}</span>
                  <span className="text-xs text-gray-400">{issue.issue_type}</span>
                  <Badge text={issue.status} variant={issue.status === "RESOLVED" ? "success" : "default"} />
                  {issue.department && <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{issue.department}</span>}
                </div>
                <div className="flex items-center gap-4 text-[10px] text-gray-500">
                  <span>Obs: {issue.observation_count}</span>
                  <span>{(issue.confidence * 100).toFixed(0)}%</span>
                  <span>{issue.latitude?.toFixed(4)}, {issue.longitude?.toFixed(4)}</span>
                  <span>{new Date(issue.created_at).toLocaleDateString()}</span>
                  <span className="text-cyan-400">View →</span>
                </div>
              </div>
            </Card>
          </Link>
        ))}
        {issues.length === 0 && !loading && (
          <Card><div className="p-8 text-center text-gray-600 text-xs">No issues found. Seed demo data: <code className="bg-gray-800 px-1.5 py-0.5 rounded">POST /api/demo/seed</code></div></Card>
        )}
      </div>
    </div>
  );
}
