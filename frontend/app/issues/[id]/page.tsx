"use client";

import { useEffect, useState, useCallback, use } from "react";
import { api, getEvidenceImageUrl } from "@/lib/api";
import { Issue, Verification } from "@/types";
import { Card, CardHeader, Badge } from "@/components/ui/Card";
import Link from "next/link";

interface AuthorityItem {
  id: string;
  username: string;
  department: string | null;
}

const TIMELINE_STEPS = ["OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_VERIFICATION", "RESOLVED"];

export default function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [authorities, setAuthorities] = useState<AuthorityItem[]>([]);
  const [selectedAuth, setSelectedAuth] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const loadData = useCallback(() => {
    Promise.all([
      api.getIssue(id).catch(() => null),
      api.getVerificationHistory(id).catch(() => [] as Verification[]),
      api.getAuthorities().then((r) => r.authorities || []).catch(() => [] as AuthorityItem[]),
    ])
      .then(([issueData, verifData, authData]) => {
        if (!issueData) {
          setError("Issue record not found.");
        } else {
          setIssue(issueData);
        }
        setVerifications(verifData);
        setAuthorities(authData);
      })
      .catch((err) => {
        console.error(err);
        setError("Error communicating with server.");
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleStatusUpdate = async (status: string) => {
    if (!issue) return;
    setUpdating(true);
    try {
      await api.updateIssue(issue.id, { status });
      loadData();
    } catch (e) {
      console.error(e);
      alert("Failed to update status. Operator authorization required.");
    } finally {
      setUpdating(false);
    }
  };

  const handleAssign = async () => {
    if (!issue || !selectedAuth) return;
    setAssigning(true);
    try {
      await api.assignIssue(issue.id, { authority_id: selectedAuth, notes });
      loadData();
    } catch (e) {
      console.error(e);
      alert("Failed to assign issue.");
    } finally {
      setAssigning(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-slate-500 text-xs font-mono">Loading issue record...</div>;
  }

  if (error || !issue) {
    return (
      <div className="p-6 max-w-4xl space-y-3">
        <Link href="/issues" className="text-xs text-blue-700 hover:underline">← Back to Issues Registry</Link>
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded text-xs">
          {error || "Issue not found"}
        </div>
      </div>
    );
  }

  const currentStepIndex = TIMELINE_STEPS.indexOf(issue.status);

  const DEFECT_DESCRIPTIONS: Record<string, { desc: string; action: string }> = {
    POTHOLE: { desc: "Road surface cavity detected by mobile transit optical sensor. Requires rapid patch repair to eliminate vehicular hazards.", action: "Dispatch asphalt patching crew" },
    WATERLOGGING: { desc: "Standing water accumulation on road surface. Indicates drainage blockage or adverse cross-slope grading.", action: "Dispatch stormwater drainage clearance team" },
    DAMAGED_ROAD: { desc: "Substantial structural pavement degradation, rutting, or raveling requiring surface layer restoration.", action: "Schedule road milling and resurfacing" },
    ROAD_CRACK: { desc: "Linear or pattern pavement cracking detected. Timely crack sealing halts water infiltration and sub-base degradation.", action: "Schedule hot-pour crack sealant application" },
    MISSING_SIGN: { desc: "Mandatory regulatory or warning signage missing at this road node.", action: "Install replacement traffic signage" },
    DAMAGED_SIGN: { desc: "Traffic signage illegible, rotated, or physically damaged.", action: "Repair or replace damaged sign plate" },
    MISSING_CROSSING: { desc: "Pedestrian zebra crossing absent or excessively worn at roadway intersection.", action: "Repaint thermoplastic pedestrian crossing" },
    MISSING_DIVIDER: { desc: "Median divider or safety barrier missing on segregated corridor.", action: "Install physical median barriers" },
    STREET_LIGHT: { desc: "Street lighting luminaire reported inactive, resulting in deficient nocturnal illumination.", action: "Dispatch municipal electrical repair unit" },
  };

  const defectInfo = DEFECT_DESCRIPTIONS[issue.issue_type] || {
    desc: "Municipal infrastructure defect identified by automated fleet inspection.",
    action: "On-site engineering inspection and assessment",
  };
  const mapsUrl = `https://www.google.com/maps?q=${issue.latitude},${issue.longitude}`;

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/issues" className="text-slate-500 hover:text-slate-800 text-xs font-medium">
            ← Issues Registry
          </Link>
          <span className="text-slate-300">/</span>
          <h1 className="text-xl font-bold font-mono text-slate-900">{issue.issue_id}</h1>
          <Badge text={issue.severity} variant={issue.severity.toLowerCase()} />
          <Badge text={issue.status} variant={issue.status === "RESOLVED" ? "success" : "default"} />
          <span className="text-xs px-2 py-0.5 rounded bg-slate-100 border border-slate-300 text-slate-700 font-mono">
            {issue.issue_type.replace(/_/g, " ")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs px-3 py-1.5 bg-white border border-slate-300 rounded text-slate-700 hover:bg-slate-50 transition-colors font-medium"
          >
            Open in Google Maps
          </a>
        </div>
      </div>

      {/* Description Banner */}
      <div className="bg-white border border-slate-200 rounded p-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">
              {issue.issue_type.replace(/_/g, " ")} — Municipal Work Order Summary
            </h2>
            {issue.consensus_level && (
              <span className="text-xs px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 font-mono font-medium">
                Consensus: {issue.consensus_level}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">{defectInfo.desc}</p>
          <div className="flex flex-wrap gap-4 pt-2 border-t border-slate-100 text-xs text-slate-500 font-mono">
            <span>Coordinates: <strong className="text-slate-800 font-semibold">{issue.latitude.toFixed(6)}, {issue.longitude.toFixed(6)}</strong></span>
            <span>Department: <strong className="text-slate-800 font-semibold">{issue.department || "Unassigned"}</strong></span>
            <span>Confidence: <strong className="text-slate-800 font-semibold">{(issue.confidence * 100).toFixed(1)}%</strong></span>
            <span>Transit Passes: <strong className="text-slate-800 font-semibold">{issue.observation_count}</strong></span>
          </div>
          {issue.chunk_id && (
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100 flex-wrap text-xs">
              <span className="text-slate-500 font-semibold">Assigned 500m Chunk:</span>
              <span className="px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-800 font-mono font-bold flex items-center gap-1.5 shadow-xs">
                <span>📍</span>
                <span>{issue.chunk_id}</span>
                {issue.chunk_chainage && <span className="text-blue-600 font-normal">({issue.chunk_chainage})</span>}
              </span>
              {issue.chunk_name && (
                <span className="text-slate-700 font-medium">
                  {issue.chunk_name}
                </span>
              )}
              <Link
                href={`/map?chunk=${issue.chunk_id}`}
                className="ml-auto text-blue-600 hover:text-blue-800 font-semibold hover:underline flex items-center gap-1"
              >
                <span>View Chunk on GIS Map</span>
                <span>→</span>
              </Link>
            </div>
          )}
          <div className="pt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 p-2.5 rounded font-medium">
            Standard Remediation Action: {defectInfo.action}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Details Card */}
        <Card>
          <CardHeader><span className="text-xs font-semibold uppercase tracking-wider text-slate-700">Metadata</span></CardHeader>
          <div className="p-4 space-y-2.5 text-xs">
            <div className="flex justify-between border-b border-slate-100 pb-1.5"><span className="text-slate-500">Defect Code</span><span className="font-mono text-slate-800">{issue.issue_type}</span></div>
            {issue.chunk_id && (
              <div className="flex justify-between border-b border-slate-100 pb-1.5">
                <span className="text-slate-500">500m Road Chunk</span>
                <Link href={`/issues?chunk=${issue.chunk_id}`} className="font-mono text-blue-600 hover:text-blue-800 font-bold hover:underline">
                  {issue.chunk_id}
                </Link>
              </div>
            )}
            <div className="flex justify-between border-b border-slate-100 pb-1.5"><span className="text-slate-500">Confidence</span><span className="font-mono text-slate-800">{(issue.confidence * 100).toFixed(1)}%</span></div>
            <div className="flex justify-between border-b border-slate-100 pb-1.5"><span className="text-slate-500">Department</span><span className="text-slate-800">{issue.department || "Unassigned"}</span></div>
            <div className="flex justify-between border-b border-slate-100 pb-1.5"><span className="text-slate-500">Observations</span><span className="font-mono text-slate-800">{issue.observation_count}</span></div>
            <div className="flex justify-between border-b border-slate-100 pb-1.5"><span className="text-slate-500">First Detected</span><span className="font-mono text-slate-800">{new Date(issue.first_seen).toLocaleString()}</span></div>
            <div className="flex justify-between border-b border-slate-100 pb-1.5"><span className="text-slate-500">Last Corroborated</span><span className="font-mono text-slate-800">{new Date(issue.last_seen).toLocaleString()}</span></div>
            <div className="pt-1">
              <div className="text-slate-500 text-[11px] mb-1">GPS Fix</div>
              <div className="font-mono text-slate-700 text-xs bg-slate-50 p-2 rounded border border-slate-200">
                <div>Lat: {issue.latitude.toFixed(6)}°</div>
                <div>Lon: {issue.longitude.toFixed(6)}°</div>
              </div>
            </div>
          </div>
        </Card>

        {/* Timeline Card */}
        <Card>
          <CardHeader><span className="text-xs font-semibold uppercase tracking-wider text-slate-700">Lifecycle State Machine</span></CardHeader>
          <div className="p-4 space-y-3">
            {TIMELINE_STEPS.map((step, i) => {
              const isActive = i <= currentStepIndex;
              const isCurrent = step === issue.status;
              return (
                <div key={step} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${
                      isCurrent ? "bg-blue-600" :
                      isActive ? "bg-slate-700" :
                      "bg-slate-200"
                    }`} />
                    <span className={`font-mono ${isCurrent ? "text-blue-700 font-bold" : isActive ? "text-slate-800" : "text-slate-400"}`}>
                      {step}
                    </span>
                  </div>
                  {isCurrent && <Badge text="ACTIVE" variant="info" />}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Actions Card */}
        <Card>
          <CardHeader><span className="text-xs font-semibold uppercase tracking-wider text-slate-700">Operational Actions</span></CardHeader>
          <div className="p-4 space-y-3">
            {issue.status === "OPEN" && (
              <>
                <div>
                  <label className="text-xs text-slate-600 block mb-1 font-medium">Assign Department Authority</label>
                  <select
                    value={selectedAuth}
                    onChange={(e) => setSelectedAuth(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-600"
                  >
                    <option value="">Select authority...</option>
                    {authorities.map((a) => (
                      <option key={a.id} value={a.id}>{a.username} ({a.department || "General"})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-600 block mb-1 font-medium">Work Order Notes</label>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Enter dispatch notes..."
                    className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-600"
                  />
                </div>
                <button
                  onClick={handleAssign}
                  disabled={!selectedAuth || assigning}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium py-2 rounded transition-colors disabled:opacity-50"
                >
                  {assigning ? "Assigning..." : "Assign Work Order"}
                </button>
              </>
            )}

            {issue.status === "ASSIGNED" && (
              <button
                onClick={() => handleStatusUpdate("IN_PROGRESS")}
                disabled={updating}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium py-2 rounded transition-colors disabled:opacity-50"
              >
                Mark In Progress
              </button>
            )}

            {issue.status === "IN_PROGRESS" && (
              <button
                onClick={() => handleStatusUpdate("PENDING_VERIFICATION")}
                disabled={updating}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium py-2 rounded transition-colors disabled:opacity-50"
              >
                Submit for Transit Verification
              </button>
            )}

            <Link
              href="/map"
              className="block w-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium py-2 rounded text-center transition-colors border border-slate-300"
            >
              View in GIS Map
            </Link>
          </div>
        </Card>
      </div>

      {/* Evidence Frames */}
      {issue.evidence_urls && issue.evidence_urls.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">Mobile Optical Sensor Evidence</h2>
            <span className="text-xs text-slate-500 font-mono">{issue.evidence_urls.length} capture frame(s) recorded</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {issue.evidence_urls.slice(0, 3).map((url, index) => {
              const imageUrl = getEvidenceImageUrl(url);
              const frameId = url.split("/").pop() || url;
              return (
                <div key={index} className="bg-white border border-slate-200 rounded overflow-hidden">
                  <div className="aspect-video bg-slate-100 border-b border-slate-200 relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageUrl}
                      alt={`Evidence capture ${index + 1}`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='225' viewBox='0 0 400 225'><rect fill='%23f1f5f9' width='400' height='225'/><text fill='%2394a3b8' font-family='sans-serif' font-size='12' x='50%25' y='50%25' text-anchor='middle' dy='.3em'>Frame Unavailable</text></svg>`;
                      }}
                    />
                    <div className="absolute top-2 left-2 bg-slate-900/80 text-white font-mono text-[10px] px-2 py-0.5 rounded">
                      CAM-01 FRONT
                    </div>
                  </div>
                  <div className="p-3 text-xs space-y-1">
                    <div className="flex justify-between text-slate-700 font-medium">
                      <span>Frame #{index + 1}</span>
                      <span className="font-mono">{(issue.confidence * 100).toFixed(0)}% conf</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono truncate">{frameId}</div>
                    <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-600 font-mono">
                      Coord: {issue.latitude.toFixed(5)}°N, {issue.longitude.toFixed(5)}°E
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Verification History */}
      <Card>
        <CardHeader>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">Transit Verification Records</span>
          <Badge text={`${verifications.length} records`} variant="default" />
        </CardHeader>
        <div className="p-4">
          {verifications.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">No re-verification transit passes recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {verifications.map((v, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 bg-slate-50 rounded border border-slate-200 text-xs">
                  <div className="flex items-center gap-3">
                    <Badge text={v.detection_result} variant={v.detection_result === "CLEAR" ? "success" : "critical"} />
                    <span className="text-slate-800 font-mono">Bus: {v.bus_id}</span>
                    <span className="text-slate-500 font-mono">Conf: {(v.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <span className="text-slate-500 font-mono text-[11px]">{new Date(v.timestamp).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
