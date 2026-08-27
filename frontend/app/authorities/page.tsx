"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, Badge } from "@/components/ui/Card";
import Link from "next/link";
import type { Issue } from "@/types";

export default function AuthoritiesPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [filter, setFilter] = useState("OPEN");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getIssues({ status: filter }).then((r) => setIssues(r.issues)).catch(console.error).finally(() => setLoading(false));
  }, [filter]);

  const stats = {
    new: issues.filter((i) => i.status === "OPEN").length,
    high: issues.filter((i) => i.severity === "HIGH" || i.severity === "CRITICAL").length,
    inProgress: issues.filter((i) => i.status === "IN_PROGRESS").length,
    resolved: issues.filter((i) => i.status === "RESOLVED").length,
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Authority Portal</h1>
          <p className="text-sm text-gray-500">Issue assignment and management for city authorities</p>
        </div>
      </div>

      {loading && <div className="text-gray-500 text-sm">Loading...</div>}

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "New Issues", count: stats.new, color: "red" },
          { label: "High Priority", count: stats.high, color: "orange" },
          { label: "In Progress", count: stats.inProgress, color: "blue" },
          { label: "Resolved", count: stats.resolved, color: "green" },
        ].map((s) => (
          <KpiCard key={s.label} label={s.label} value={s.count} color={s.color} />
        ))}
      </div>

      <div className="flex gap-2">
        {["OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_VERIFICATION", "RESOLVED"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[10px] px-3 py-1.5 rounded border transition-colors ${
              filter === f
                ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
                : "bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-600"
            }`}
          >
            {f} ({f === filter ? issues.length : "—"})
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {issues.map((issue) => (
          <Link key={issue.id} href={`/issues/${issue.id}`}>
            <Card className="hover:border-gray-600 transition-colors cursor-pointer">
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge text={issue.severity} variant={issue.severity.toLowerCase()} />
                    <span className="text-sm font-medium text-white">{issue.issue_id}</span>
                    <span className="text-xs text-gray-400">{issue.issue_type}</span>
                    <Badge text={issue.status} variant={issue.status === "RESOLVED" ? "success" : "default"} />
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-gray-500">
                    <span>{issue.department || "Unassigned"}</span>
                    <span>Obs: {issue.observation_count}</span>
                    <span>{(issue.confidence * 100).toFixed(0)}%</span>
                    <span>{new Date(issue.created_at).toLocaleDateString()}</span>
                    <span className="text-cyan-400">View →</span>
                  </div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
        {issues.length === 0 && (
          <Card><div className="p-8 text-center text-gray-600 text-xs">No issues with status: {filter}</div></Card>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    red: "border-red-500/30 text-red-400",
    orange: "border-orange-500/30 text-orange-400",
    blue: "border-blue-500/30 text-blue-400",
    green: "border-green-500/30 text-green-400",
  };
  return (
    <div className={`bg-gray-900 border ${colors[color] || colors.red} rounded-lg p-4`}>
      <div className="text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${colors[color]?.split(" ")[1]}`}>{value}</div>
    </div>
  );
}
