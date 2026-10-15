"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import { Card, Badge, KpiCard } from "@/components/ui/Card";
import Link from "next/link";
import type { Issue } from "@/types";

const FILTER_TABS = [
  "ALL",
  "OPEN",
  "DETECTED",
  "CONFIRMED",
  "ASSIGNED",
  "IN_PROGRESS",
  "PENDING_VERIFICATION",
  "RESOLVED",
  "REOPENED",
] as const;

export default function AuthoritiesPage() {
  const [allIssues, setAllIssues] = useState<Issue[]>([]);
  const [filter, setFilter] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);

  const fetchIssues = useCallback(() => {
    setLoading(true);
    api
      .getIssues({ limit: "500" })
      .then((r) => setAllIssues((r?.issues || []) as Issue[]))
      .catch((e) => console.warn("Failed to fetch issues:", e))
      .finally(() => setLoading(false));

  }, []);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  // City-wide KPIs computed strictly from allIssues (unfiltered)
  const stats = useMemo(() => ({
    new: allIssues.filter((i) => ["OPEN", "DETECTED", "CONFIRMED"].includes(i.status)).length,
    high: allIssues.filter((i) => i.severity === "HIGH" || i.severity === "CRITICAL").length,
    inProgress: allIssues.filter((i) => ["IN_PROGRESS", "ASSIGNED"].includes(i.status)).length,
    resolved: allIssues.filter((i) => i.status === "RESOLVED").length,
  }), [allIssues]);

  // Tabular issue list filtered by active tab
  const filteredIssues = useMemo(() => {
    if (filter === "ALL") return allIssues;
    return allIssues.filter((i) => i.status === filter);
  }, [allIssues, filter]);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Municipal Authority Dispatch</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Inter-agency defect work orders, contractor assignments, and department routing
          </p>
        </div>
        <button
          onClick={fetchIssues}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-medium transition-colors"
        >
          {loading ? "Refreshing..." : "Refresh Records"}
        </button>
      </div>

      {/* City-wide Unfiltered KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Pending / Detected" value={stats.new} color="amber" subtitle="Awaiting departmental triage" />
        <KpiCard label="High Priority" value={stats.high} color="red" subtitle="Critical & high severity" />
        <KpiCard label="In Progress / Assigned" value={stats.inProgress} color="blue" subtitle="Active field crew orders" />
        <KpiCard label="Remediated / Resolved" value={stats.resolved} color="green" subtitle="Transit-verified clearance" />
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {FILTER_TABS.map((f) => {
          const count = f === "ALL" ? allIssues.length : allIssues.filter((i) => i.status === f).length;
          const isCurrent = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1 rounded border transition-colors ${
                isCurrent
                  ? "bg-blue-50 text-blue-700 border-blue-300 font-semibold"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {f.replace(/_/g, " ")} <span className="text-[11px] font-mono text-slate-500">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Tabular Issues Display */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px] tracking-wider">
                <th className="py-2.5 px-4">Work Order</th>
                <th className="py-2.5 px-4">Defect Type</th>
                <th className="py-2.5 px-4">Severity</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Assigned Department</th>
                <th className="py-2.5 px-4">Transit Passes</th>
                <th className="py-2.5 px-4">Confidence</th>
                <th className="py-2.5 px-4">Reported</th>
                <th className="py-2.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredIssues.map((issue) => (
                <tr key={issue.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-2.5 px-4 font-mono font-medium text-slate-900">
                    <Link href={`/issues/${issue.id}`} className="hover:text-blue-700 hover:underline">
                      {issue.issue_id}
                    </Link>
                  </td>
                  <td className="py-2.5 px-4 font-medium text-slate-800">
                    {issue.issue_type.replace(/_/g, " ")}
                  </td>
                  <td className="py-2.5 px-4">
                    <Badge text={issue.severity} variant={issue.severity.toLowerCase()} />
                  </td>
                  <td className="py-2.5 px-4">
                    <Badge
                      text={issue.status}
                      variant={
                        issue.status === "RESOLVED"
                          ? "success"
                          : issue.status === "CONFIRMED"
                          ? "confirmed"
                          : issue.status === "DETECTED"
                          ? "detected"
                          : issue.status === "REOPENED"
                          ? "reopened"
                          : "default"
                      }
                    />
                  </td>
                  <td className="py-2.5 px-4 text-slate-600">
                    {issue.department || <span className="text-slate-400 italic">Unassigned</span>}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-700">
                    {issue.observation_count}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-700">
                    {(issue.confidence * 100).toFixed(0)}%
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-500 text-[11px]">
                    {new Date(issue.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <Link
                      href={`/issues/${issue.id}`}
                      className="text-blue-700 hover:underline font-medium text-xs"
                    >
                      View Details →
                    </Link>
                  </td>
                </tr>
              ))}
              {filteredIssues.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500 text-xs">
                    No work orders found matching status: <strong>{filter}</strong>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
