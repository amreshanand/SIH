"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { Card, CardHeader, Badge } from "@/components/ui/Card";
import Link from "next/link";
import type { Issue } from "@/types";

interface VerificationRecord {
  detection_result: string;
  bus_id: string;
  confidence: number;
  timestamp: string;
}

interface Authority {
  id: string;
  username: string;
  department: string | null;
}

const TIMELINE_STEPS = ["OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_VERIFICATION", "RESOLVED"];

export default function IssueDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [issue, setIssue] = useState<Issue | null>(null);
  const [verifications, setVerifications] = useState<VerificationRecord[]>([]);
  const [authorities, setAuthorities] = useState<Authority[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [selectedAuth, setSelectedAuth] = useState("");
  const [notes, setNotes] = useState("");
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.getIssue(id).then(setIssue).catch((e) => { console.error(e); setError("Failed to load issue"); });
    api.getVerificationHistory(id).then((v) => setVerifications(Array.isArray(v) ? (v as VerificationRecord[]) : [])).catch(console.error);
    api.getAuthorities().then((r) => setAuthorities(r.authorities || [])).catch(console.error);
  }, [id]);

  const handleAssign = async () => {
    if (!selectedAuth || !issue) return;
    setAssigning(true);
    try {
      await api.assignIssue(issue.issue_id, { authority_id: selectedAuth, notes });
      const updated = await api.getIssue(id);
      setIssue(updated);
      setNotes("");
    } catch (e) { console.error(e); }
    setAssigning(false);
  };

  const handleStatusUpdate = async (newStatus: string) => {
    if (!issue) return;
    setUpdating(true);
    try {
      await api.updateIssue(issue.issue_id, { status: newStatus });
      const updated = await api.getIssue(id);
      setIssue(updated);
    } catch (e) { console.error(e); }
    setUpdating(false);
  };

  if (error) {
    return <div className="p-6 text-red-400">{error}</div>;
  }

  if (!issue) {
    return <div className="p-6 text-gray-500">Loading issue...</div>;
  }

  const currentStepIndex = TIMELINE_STEPS.indexOf(issue.status);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/issues" className="text-gray-500 hover:text-gray-300 text-sm">← Issues</Link>
        <h1 className="text-2xl font-bold text-white">{issue.issue_id}</h1>
        <Badge text={issue.severity} variant={issue.severity.toLowerCase()} />
        <Badge text={issue.status} variant={issue.status === "RESOLVED" ? "success" : "default"} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader><span className="text-xs text-gray-400">Details</span></CardHeader>
          <div className="p-4 space-y-3 text-[11px]">
            <div className="flex justify-between"><span className="text-gray-500">Type</span><span className="text-gray-200">{issue.issue_type}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Confidence</span><span className="text-gray-200">{(issue.confidence * 100).toFixed(0)}%</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Department</span><span className="text-gray-200">{issue.department || "Unassigned"}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Observations</span><span className="text-gray-200">{issue.observation_count}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">First Seen</span><span className="text-gray-200">{new Date(issue.first_seen).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Last Seen</span><span className="text-gray-200">{new Date(issue.last_seen).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">GPS</span><span className="text-gray-200">{issue.latitude?.toFixed(4)}, {issue.longitude?.toFixed(4)}</span></div>
          </div>
        </Card>

        <Card>
          <CardHeader><span className="text-xs text-gray-400">Timeline</span></CardHeader>
          <div className="p-4 space-y-2">
            {TIMELINE_STEPS.map((step, i) => {
              const isActive = i <= currentStepIndex;
              const isCurrent = step === issue.status;
              return (
                <div key={step} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full border-2 ${
                    isCurrent ? "bg-cyan-500 border-cyan-400" :
                    isActive ? "bg-emerald-500 border-emerald-400" :
                    "bg-gray-800 border-gray-700"
                  }`} />
                  <span className={`text-[11px] ${isCurrent ? "text-cyan-400 font-medium" : isActive ? "text-emerald-400" : "text-gray-600"}`}>{step}</span>
                  {isCurrent && <Badge text="CURRENT" variant="default" />}
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader><span className="text-xs text-gray-400">Actions</span></CardHeader>
          <div className="p-4 space-y-3">
            {issue.status === "OPEN" && (
              <>
                <div>
                  <label className="text-[10px] text-gray-500 block mb-1">Assign to Authority</label>
                  <select
                    value={selectedAuth}
                    onChange={(e) => setSelectedAuth(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200"
                  >
                    <option value="">Select authority...</option>
                    {authorities.map((a) => (
                      <option key={a.id} value={a.id}>{a.username} ({a.department || "General"})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block mb-1">Notes</label>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Assignment notes..."
                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200"
                  />
                </div>
                <button
                  onClick={handleAssign}
                  disabled={!selectedAuth || assigning}
                  className="w-full bg-cyan-600 hover:bg-cyan-500 text-white text-xs py-2 rounded disabled:opacity-50"
                >
                  {assigning ? "Assigning..." : "Assign Issue"}
                </button>
              </>
            )}

            {issue.status === "ASSIGNED" && (
              <button onClick={() => handleStatusUpdate("IN_PROGRESS")} disabled={updating} className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs py-2 rounded disabled:opacity-50">
                Start Work
              </button>
            )}

            {issue.status === "IN_PROGRESS" && (
              <button onClick={() => handleStatusUpdate("PENDING_VERIFICATION")} disabled={updating} className="w-full bg-purple-600 hover:bg-purple-500 text-white text-xs py-2 rounded disabled:opacity-50">
                Request Verification
              </button>
            )}

            <Link href={`/map`} className="block w-full bg-gray-700 hover:bg-gray-600 text-white text-xs py-2 rounded text-center">
              View on Map
            </Link>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <span className="text-xs text-gray-400">Verification History</span>
          <Badge text={`${verifications.length} records`} variant="default" />
        </CardHeader>
        <div className="p-4">
          {verifications.length === 0 ? (
            <p className="text-[10px] text-gray-600 text-center py-4">No verification records yet</p>
          ) : (
            <div className="space-y-2">
              {verifications.map((v, i) => (
                <div key={i} className="flex items-center justify-between p-2 bg-gray-800/50 rounded text-[10px]">
                  <div className="flex items-center gap-3">
                    <Badge text={v.detection_result} variant={v.detection_result === "CLEAR" ? "success" : "critical"} />
                    <span className="text-gray-300">Bus: {v.bus_id}</span>
                    <span className="text-gray-500">Confidence: {(v.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <span className="text-gray-500">{new Date(v.timestamp).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
