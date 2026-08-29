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
    api.getIssue(id)
      .then((issue) => {
        setIssue(issue);
        api.getVerificationHistory(issue.id)
          .then((v) => setVerifications(Array.isArray(v) ? (v as VerificationRecord[]) : []))
          .catch(console.error);
      })
      .catch((e) => { console.error(e); setError("Failed to load issue"); });
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

  const DEFECT_DESCRIPTIONS: Record<string, { desc: string; icon: string; action: string }> = {
    POTHOLE: { icon: "⚠️", desc: "A road surface depression (pothole) detected by the bus camera. Requires urgent patch repair to prevent vehicle damage and accidents.", action: "Schedule road patch repair team" },
    WATERLOGGING: { icon: "🌊", desc: "Standing water accumulation on road surface detected. Indicates blocked drainage or inadequate road gradient.", action: "Dispatch drainage clearance team" },
    DAMAGED_ROAD: { icon: "🛣️", desc: "Significant road surface damage detected including cracking, rutting or structural failure requiring resurfacing.", action: "Assess and schedule resurfacing" },
    ROAD_CRACK: { icon: "🔍", desc: "Linear or alligator cracking on road surface detected. Early intervention can prevent full pothole formation.", action: "Schedule crack sealing treatment" },
    MISSING_SIGN: { icon: "🚫", desc: "A required traffic signboard is absent at this location. Risk of driver confusion or accidents without signage.", action: "Install missing traffic signage" },
    DAMAGED_SIGN: { icon: "🪧", desc: "An existing traffic signboard is damaged, faded, or illegible, reducing road safety for drivers.", action: "Replace or repair damaged signage" },
    MISSING_CROSSING: { icon: "🚶", desc: "A pedestrian zebra crossing is absent or not marked at this intersection, creating pedestrian safety risk.", action: "Re-paint or install crossing" },
    MISSING_DIVIDER: { icon: "🏗️", desc: "Road median divider or safety barrier is missing on a section where one is required for traffic segregation.", action: "Install median dividers or barriers" },
    STREET_LIGHT: { icon: "💡", desc: "A street light is non-functional or missing, creating dangerous low-visibility conditions at night.", action: "Dispatch electrical maintenance team" },
  };

  const defectInfo = DEFECT_DESCRIPTIONS[issue.issue_type] || { icon: "📋", desc: "Road infrastructure issue detected by fleet AI camera.", action: "Inspect and assess on site" };
  const mapsUrl = `https://www.google.com/maps?q=${issue.latitude},${issue.longitude}`;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/issues" className="text-gray-500 hover:text-gray-300 text-sm">← Issues</Link>
        <h1 className="text-2xl font-bold text-white">{issue.issue_id}</h1>
        <Badge text={issue.severity} variant={issue.severity.toLowerCase()} />
        <Badge text={issue.status} variant={issue.status === "RESOLVED" ? "success" : "default"} />
        <Badge text={issue.issue_type.replace(/_/g, " ")} variant="default" />
      </div>

      {/* Description banner */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 flex gap-4 items-start">
        <span className="text-3xl mt-0.5">{defectInfo.icon}</span>
        <div className="space-y-1 flex-1">
          <h2 className="text-sm font-semibold text-white">{issue.issue_type.replace(/_/g, " ")} — Detected by Fleet AI Camera</h2>
          <p className="text-xs text-gray-400">{defectInfo.desc}</p>
          <div className="flex flex-wrap gap-4 pt-2 text-[11px] text-gray-500">
            <span>📍 <span className="text-cyan-400 font-mono">{issue.latitude.toFixed(6)}, {issue.longitude.toFixed(6)}</span></span>
            <span>🏢 Dept: <span className="text-gray-300">{issue.department || "Unassigned"}</span></span>
            <span>🎯 Confidence: <span className="text-emerald-400">{(issue.confidence * 100).toFixed(0)}%</span></span>
            <span>👁️ Observations: <span className="text-gray-300">{issue.observation_count}</span></span>
          </div>
          <div className="pt-2 flex items-center gap-3">
            <span className="text-[11px] text-amber-400 font-medium">⚡ Recommended Action: {defectInfo.action}</span>
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-[10px] px-2 py-0.5 rounded bg-blue-600/30 border border-blue-500/30 text-blue-300 hover:bg-blue-600/50 transition-colors">
              📍 Open in Google Maps
            </a>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader><span className="text-xs text-gray-400">Details</span></CardHeader>
          <div className="p-4 space-y-3 text-[11px]">
            <div className="flex justify-between"><span className="text-gray-500">Type</span><span className="text-gray-200">{issue.issue_type}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Confidence</span><span className="text-emerald-400">{(issue.confidence * 100).toFixed(0)}%</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Department</span><span className="text-gray-200">{issue.department || "Unassigned"}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Observations</span><span className="text-gray-200">{issue.observation_count}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">First Seen</span><span className="text-gray-200">{new Date(issue.first_seen).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Last Seen</span><span className="text-gray-200">{new Date(issue.last_seen).toLocaleString()}</span></div>
            <div className="pt-1 border-t border-gray-800">
              <div className="text-gray-500 mb-1">GPS Coordinates</div>
              <div className="font-mono text-cyan-400 text-[10px] bg-gray-900 p-1.5 rounded">
                <div>Lat: {issue.latitude.toFixed(6)}°</div>
                <div>Lon: {issue.longitude.toFixed(6)}°</div>
              </div>
            </div>
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

      {/* Evidence Section — 3-image grid with coordinates */}
      {issue.evidence_urls && issue.evidence_urls.length > 0 && (() => {
        // Show up to 3 images
        const displayEvidence = issue.evidence_urls.slice(0, 3);
        return (
          <div className="space-y-3">
            {/* Section header */}
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-white">📸 AI Detection Evidence</h2>
              <Badge text={`${displayEvidence.length} of ${issue.evidence_urls.length} frames`} variant="default" />
              <span className="text-[10px] text-gray-500">Captured by Fleet Camera at detection moment</span>
            </div>

            {/* 3-column image grid */}
            <div className="grid grid-cols-3 gap-4">
              {displayEvidence.map((url, index) => {
                const isFullUrl = url.startsWith("http://") || url.startsWith("https://");
                const imageUrl = isFullUrl ? url : `http://localhost:8000/${url}`;
                const frameId = url.split("/").pop() || url;
                const camLabels = ["CAM-01 FRONT", "CAM-01 FRONT", "CAM-01 FRONT"];

                return (
                  <div key={index} className="space-y-2">
                    {/* Image with overlay */}
                    <div className="relative rounded-xl overflow-hidden bg-gray-950 border border-gray-800 group shadow-xl">
                      <div className="aspect-video">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imageUrl}
                          alt={`Evidence ${index + 1} — ${issue.issue_type}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='225' viewBox='0 0 400 225'><rect fill='%23111' width='400' height='225'/><text fill='%23555' font-family='monospace' font-size='12' x='50%25' y='50%25' text-anchor='middle' dy='.3em'>Frame Unavailable</text></svg>`;
                          }}
                        />
                      </div>

                      {/* Top-left: camera badge */}
                      <div className="absolute top-2 left-2 bg-black/85 backdrop-blur px-2 py-1 rounded text-[8px] text-cyan-300 font-mono border border-cyan-500/25 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                        {camLabels[index]}
                      </div>

                      {/* Top-right: frame number */}
                      <div className="absolute top-2 right-2 bg-black/85 px-2 py-1 rounded text-[8px] text-gray-300 font-mono border border-gray-700">
                        Frame #{index + 1}
                      </div>

                      {/* Bottom: detection label */}
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 to-transparent px-3 py-2">
                        <div className="flex justify-between items-center">
                          <div>
                            <div className="text-[9px] font-bold text-white uppercase tracking-wide">{issue.issue_type.replace(/_/g, " ")} DETECTED</div>
                            <div className="text-[8px] text-gray-400 font-mono">{frameId}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[8px] text-emerald-400 font-mono">{(issue.confidence * 100).toFixed(0)}% conf</div>
                            <div className="text-[7px] text-gray-500 font-mono">{issue.severity}</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* GPS card below each image */}
                    <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-[9px] text-gray-500 font-semibold uppercase tracking-wider">
                        <span>📍</span> Detection Location
                      </div>
                      <div className="font-mono text-[10px] space-y-1">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Latitude</span>
                          <span className="text-cyan-400">{issue.latitude.toFixed(6)}°N</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Longitude</span>
                          <span className="text-cyan-400">{issue.longitude.toFixed(6)}°E</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Accuracy</span>
                          <span className="text-gray-400">±3m GPS</span>
                        </div>
                      </div>
                      <a
                        href={`https://www.google.com/maps?q=${issue.latitude},${issue.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-center gap-1 w-full py-1.5 bg-blue-600/20 border border-blue-500/25 rounded text-[9px] text-blue-300 hover:bg-blue-600/35 transition-colors font-medium"
                      >
                        🗺 Open in Google Maps
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* No evidence fallback */}
      {(!issue.evidence_urls || issue.evidence_urls.length === 0) && (
        <Card>
          <CardHeader><span className="text-xs text-gray-400">Evidence Frames</span></CardHeader>
          <div className="p-6 text-center text-[11px] text-gray-500">
            <div className="text-3xl mb-2">📷</div>
            <div>Evidence frames are being captured by the AI pipeline.</div>
            <div className="text-gray-600 mt-1">Check back after the next bus detection cycle.</div>
          </div>
        </Card>
      )}

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
