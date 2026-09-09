"use client";

import { useEffect, useState, useMemo } from "react";
import { api } from "@/lib/api";
import { Card, CardHeader, Badge, KpiCard } from "@/components/ui/Card";
import Link from "next/link";
import type { Issue } from "@/types";

interface TimelineStage {
  key: string;
  label: string;
  description: string;
  statusMatch: string[];
}

const CONSENSUS_STAGES: TimelineStage[] = [
  {
    key: "DETECTED",
    label: "Detected",
    description: "Initial automated anomaly detection captured by a mobile transit sensing bus. Single observation pending corroboration.",
    statusMatch: ["DETECTED", "OPEN"],
  },
  {
    key: "CONFIRMED",
    label: "Confirmed",
    description: "Corroborated by multiple buses or consecutive transit passes. Defect confidence verified and elevated to municipal registry.",
    statusMatch: ["CONFIRMED"],
  },
  {
    key: "ASSIGNED",
    label: "Assigned",
    description: "Dispatched to the designated municipal department (Road Maintenance PMC, Drainage, or Traffic Infrastructure) with assigned work order.",
    statusMatch: ["ASSIGNED"],
  },
  {
    key: "IN_PROGRESS",
    label: "In Progress",
    description: "Maintenance contractor or municipal crew actively on-site undertaking asphalt patching or infrastructure remediation.",
    statusMatch: ["IN_PROGRESS"],
  },
  {
    key: "VERIFICATION",
    label: "Verification",
    description: "Post-repair inspection scheduled. Mobile sensing buses re-traverse the GPS coordinates to visually verify defect clearance.",
    statusMatch: ["PENDING_VERIFICATION"],
  },
  {
    key: "RESOLVED",
    label: "Resolved",
    description: "Automated transit verification confirms defect eradicated (zero re-detections). Audit log stamped and work order closed.",
    statusMatch: ["RESOLVED"],
  },
];

export default function ConsensusTimelinePage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIssues = () => {
    setLoading(true);
    api
      .getIssues({ limit: "300" })
      .then((res) => {
        const list = (res?.issues || []) as Issue[];
        setIssues(list);
        if (list.length > 0 && !selectedIssueId) {
          setSelectedIssueId(list[0].id);
        }
      })
      .catch((err) => {
        console.error("Failed to load issues for consensus timeline:", err);
        setError("Unable to load municipal issue registry.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchIssues();
  }, []);

  const selectedIssue = useMemo(() => {
    return issues.find((i) => i.id === selectedIssueId) || issues[0] || null;
  }, [issues, selectedIssueId]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {
      Detected: 0,
      Confirmed: 0,
      Assigned: 0,
      "In Progress": 0,
      Verification: 0,
      Resolved: 0,
    };
    for (const issue of issues) {
      for (const stage of CONSENSUS_STAGES) {
        if (stage.statusMatch.includes(issue.status)) {
          counts[stage.label] = (counts[stage.label] || 0) + 1;
          break;
        }
      }
    }
    return counts;
  }, [issues]);

  const activeStageIndex = useMemo(() => {
    if (!selectedIssue) return 0;
    const status = selectedIssue.status;
    for (let idx = 0; idx < CONSENSUS_STAGES.length; idx++) {
      if (CONSENSUS_STAGES[idx].statusMatch.includes(status)) {
        return idx;
      }
    }
    if (status === "REOPENED") return 0;
    return 0;
  }, [selectedIssue]);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Consensus Lifecycle Timeline</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Multi-bus spatial corroboration, departmental triage, and automated transit closure pipeline
          </p>
        </div>
        <button
          onClick={fetchIssues}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-medium transition-colors"
        >
          {loading ? "Refreshing..." : "Refresh Registry"}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded">
          {error}
        </div>
      )}

      {/* KPI Overview */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {CONSENSUS_STAGES.map((stage) => (
          <div key={stage.label} className="bg-white border border-slate-200 rounded p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">{stage.label}</div>
            <div className="text-xl font-bold text-slate-900 mt-1">{stageCounts[stage.label] || 0}</div>
          </div>
        ))}
      </div>

      {/* Main Operational Split: Timeline on Left, Selected Issue Detail on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Vertical Timeline Card (7 cols) */}
        <div className="lg:col-span-7">
          <Card>
            <CardHeader>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Consensus Verification Flow
              </span>
              {selectedIssue && (
                <span className="text-xs font-mono text-slate-500">
                  Tracking: {selectedIssue.issue_id}
                </span>
              )}
            </CardHeader>
            <div className="p-6">
              <div className="relative border-l-2 border-slate-200 ml-4 space-y-8">
                {CONSENSUS_STAGES.map((stage, idx) => {
                  const isCompleted = idx < activeStageIndex;
                  const isCurrent = idx === activeStageIndex;
                  const isPending = idx > activeStageIndex;

                  return (
                    <div key={stage.key} className="relative pl-6">
                      {/* Node Bullet */}
                      <span
                        className={`absolute -left-[9px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${
                          isCurrent
                            ? "bg-blue-600 text-white ring-4 ring-blue-100"
                            : isCompleted
                            ? "bg-slate-700 text-white"
                            : "bg-white border-2 border-slate-300 text-slate-400"
                        }`}
                      >
                        {isCompleted ? "✓" : idx + 1}
                      </span>

                      {/* Stage Content */}
                      <div>
                        <div className="flex items-center gap-2">
                          <h3
                            className={`text-sm font-semibold tracking-tight ${
                              isCurrent
                                ? "text-blue-700 font-bold"
                                : isCompleted
                                ? "text-slate-800"
                                : "text-slate-400"
                            }`}
                          >
                            {stage.label}
                          </h3>
                          {isCurrent && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-100 text-blue-800 font-medium uppercase">
                              Current Status
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                          {stage.description}
                        </p>

                        {/* If this is the current stage, show contextual metadata from selected issue */}
                        {isCurrent && selectedIssue && (
                          <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded text-xs space-y-1.5">
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                              <div>
                                <span className="text-slate-500">Defect Type: </span>
                                <span className="font-semibold text-slate-800">{selectedIssue.issue_type}</span>
                              </div>
                              <div>
                                <span className="text-slate-500">Department: </span>
                                <span className="font-semibold text-slate-800">{selectedIssue.department || "Unassigned"}</span>
                              </div>
                              <div>
                                <span className="text-slate-500">Observation Count: </span>
                                <span className="font-mono text-slate-800">{selectedIssue.observation_count} passes</span>
                              </div>
                              <div>
                                <span className="text-slate-500">Confidence: </span>
                                <span className="font-mono text-slate-800">{(selectedIssue.confidence * 100).toFixed(1)}%</span>
                              </div>
                            </div>
                            <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200">
                              Registered: {new Date(selectedIssue.created_at).toLocaleString()} • Last Seen: {new Date(selectedIssue.last_seen).toLocaleString()}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        </div>

        {/* Selected Issue Inspector & Quick Selector (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <Card>
            <CardHeader>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Active Issue Inspector
              </span>
              {selectedIssue && (
                <Link
                  href={`/issues/${selectedIssue.id}`}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  Full View →
                </Link>
              )}
            </CardHeader>
            <div className="p-4 space-y-3">
              {selectedIssue ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                    <div>
                      <div className="text-xs text-slate-500">Issue ID</div>
                      <div className="text-sm font-bold font-mono text-slate-900">{selectedIssue.issue_id}</div>
                    </div>
                    <Badge text={selectedIssue.status} variant={selectedIssue.status.toLowerCase()} />
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Classification</span>
                      <span className="font-medium text-slate-800">{selectedIssue.issue_type}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Severity</span>
                      <Badge text={selectedIssue.severity} variant={selectedIssue.severity.toLowerCase()} />
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">GPS Coordinates</span>
                      <span className="font-mono text-slate-700">
                        {selectedIssue.latitude.toFixed(5)}, {selectedIssue.longitude.toFixed(5)}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Responsible Dept</span>
                      <span className="font-medium text-slate-800">{selectedIssue.department || "Awaiting Assignment"}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Multi-Bus Pass Count</span>
                      <span className="font-mono text-slate-800">{selectedIssue.observation_count} passes</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Sensor Fused Score</span>
                      <span className="font-mono text-slate-800">
                        {selectedIssue.fused_confidence_score != null
                          ? `${selectedIssue.fused_confidence_score.toFixed(1)} / 100`
                          : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-500 py-6 text-center">No issues in database.</div>
              )}
            </div>
          </Card>

          {/* Quick Select Table */}
          <Card>
            <CardHeader>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Select Anomaly to Trace
              </span>
              <span className="text-[11px] text-slate-500">
                {issues.length} Registered
              </span>
            </CardHeader>
            <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
              {issues.map((issue) => {
                const isSelected = issue.id === selectedIssue?.id;
                return (
                  <button
                    key={issue.id}
                    onClick={() => setSelectedIssueId(issue.id)}
                    className={`w-full text-left p-2.5 text-xs transition-colors flex items-center justify-between ${
                      isSelected ? "bg-blue-50 border-l-2 border-blue-600 font-semibold" : "hover:bg-slate-50"
                    }`}
                  >
                    <div>
                      <div className="text-slate-900 font-mono text-[11px]">{issue.issue_id}</div>
                      <div className="text-[10px] text-slate-500">{issue.issue_type} • {issue.department || "Unassigned"}</div>
                    </div>
                    <Badge text={issue.status} variant={issue.status.toLowerCase()} />
                  </button>
                );
              })}
              {issues.length === 0 && !loading && (
                <div className="p-4 text-center text-xs text-slate-500">No issues found.</div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Dense Municipal Status Table */}
      <Card>
        <CardHeader>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Municipal Consensus Ledger
          </span>
          <span className="text-xs text-slate-500">
            Showing all {issues.length} active city anomalies across lifecycle stages
          </span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                <th className="p-3">Issue ID</th>
                <th className="p-3">Defect Type</th>
                <th className="p-3">Lifecycle Phase</th>
                <th className="p-3">Severity</th>
                <th className="p-3">Department</th>
                <th className="p-3 text-right">Observations</th>
                <th className="p-3 text-right">Confidence</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {issues.slice(0, 15).map((issue) => (
                <tr key={issue.id} className="hover:bg-slate-50 transition-colors">
                  <td className="p-3 font-mono font-medium text-slate-900">{issue.issue_id}</td>
                  <td className="p-3">{issue.issue_type}</td>
                  <td className="p-3">
                    <Badge text={issue.status} variant={issue.status.toLowerCase()} />
                  </td>
                  <td className="p-3">
                    <Badge text={issue.severity} variant={issue.severity.toLowerCase()} />
                  </td>
                  <td className="p-3 text-slate-600">{issue.department || "Unassigned"}</td>
                  <td className="p-3 text-right font-mono">{issue.observation_count}</td>
                  <td className="p-3 text-right font-mono">{(issue.confidence * 100).toFixed(0)}%</td>
                  <td className="p-3">
                    <button
                      onClick={() => {
                        setSelectedIssueId(issue.id);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Inspect Timeline →
                    </button>
                  </td>
                </tr>
              ))}
              {issues.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-400">
                    No consensus records recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
