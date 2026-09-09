"use client";

import { useEffect, useMemo, useState } from "react";
import { api, APIError, auth } from "@/lib/api";
import { Card, CardHeader, Badge, Stat } from "@/components/ui/Card";
import type { Bus, Issue, Verification } from "@/types";

const VERIFY_STATUSES = ["PENDING_VERIFICATION", "ASSIGNED", "IN_PROGRESS", "REOPENED", "RESOLVED"];

const sevVariant: Record<string, string> = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
};

function statusVariant(status: string): string {
  if (status === "RESOLVED") return "success";
  if (status === "REOPENED" || status === "PENDING_VERIFICATION") return "warning";
  if (status === "IN_PROGRESS") return "info";
  return "default";
}

export default function VerificationPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [buses, setBuses] = useState<Bus[]>([]);
  const [history, setHistory] = useState<Record<string, Verification[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busId, setBusId] = useState<string>("");
  const [result, setResult] = useState<"CLEAR" | "DETECTED">("CLEAR");
  const [confidence, setConfidence] = useState(0.9);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [currentUser] = useState(auth.user);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getIssues({ limit: "200" }), api.getBuses()])
      .then(([issueRes, busList]) => {
        if (cancelled) return;
        setIssues(issueRes.issues.filter((i) => VERIFY_STATUSES.includes(i.status)));
        setBuses(busList);
        if (busList.length > 0) setBusId(busList[0].id);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof APIError ? `${e.status}: ${e.detail}` : "Failed to load issues");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshIssues = (keepExpanded = true) => {
    api
      .getIssues({ limit: "200" })
      .then((res) => {
        setIssues(res.issues.filter((i) => VERIFY_STATUSES.includes(i.status)));
        if (!keepExpanded) setExpanded(null);
      })
      .catch(() => {
        /* keep current view if refresh fails */
      });
  };

  const toggleHistory = (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!history[id]) {
      api
        .getVerificationHistory(id)
        .then((list) => setHistory((prev) => ({ ...prev, [id]: list as Verification[] })))
        .catch(() => {
          /* ignore history load errors */
        });
    }
  };

  const submit = async (issue: Issue) => {
    if (!busId) {
      setNotice("Select a bus performing the verification pass");
      return;
    }
    setBusy(issue.id);
    setNotice(null);
    try {
      const res = await api.createVerification({
        issue_id: issue.id,
        bus_id: busId,
        latitude: issue.latitude,
        longitude: issue.longitude,
        detection_result: result,
        confidence,
      });
      setNotice(
        `Bus ${res.bus_id.slice(0, 8)} reported ${res.detection_result} @ ${issue.issue_id} → ` +
          `result ${res.result ?? "PENDING"} · issue ${res.issue_status ?? "unchanged"}`,
      );
      refreshIssues(true);
    } catch (e) {
      setNotice(e instanceof APIError ? `${e.status}: ${e.detail}` : "Verification submission failed");
    } finally {
      setBusy(null);
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of issues) c[i.status] = (c[i.status] || 0) + 1;
    return c;
  }, [issues]);

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-100 mb-4">Multi-Bus Verification</h1>
        <Card className="p-6">
          <div className="text-red-400">Unable to reach backend: {error}</div>
        </Card>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-100 mb-4">Multi-Bus Verification</h1>
        <Card className="p-6">
          <div className="text-amber-400">Sign in to submit verification passes.</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Multi-Bus Verification</h1>
          <p className="text-sm text-gray-500">
            If a future bus detects the issue again after repair, it is automatically REOPENED.
          </p>
        </div>
      </div>

      {notice && (
        <Card className="p-4 border-cyan-500/40">
          <span className="text-sm text-cyan-300">{notice}</span>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {VERIFY_STATUSES.map((s) => (
          <Card key={s} className="p-3">
            <Stat label={s.replace(/_/g, " ").toLowerCase()} value={counts[s] || 0} tone={s !== "RESOLVED" ? "amber" : "green"} />
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {issues.map((issue) => {
          const open = expanded === issue.id;
          return (
            <Card key={issue.id}>
              <CardHeader>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-200">{issue.issue_id}</span>
                  <Badge text={issue.issue_type.replace(/_/g, " ")} variant={sevVariant[issue.severity] || "default"} />
                  <Badge text={issue.status} variant={statusVariant(issue.status)} />
                </div>
                <span className="text-xs text-gray-500">
                  {issue.latitude.toFixed(4)}, {issue.longitude.toFixed(4)}
                </span>
              </CardHeader>
              <div className="p-4 space-y-4">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>observations: {issue.observation_count}</span>
                  <span>confidence: {(issue.confidence * 100).toFixed(0)}%</span>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Bus</div>
                    <select
                      className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
                      value={busId}
                      onChange={(e) => setBusId(e.target.value)}
                    >
                      {buses.length === 0 && <option value="">no buses</option>}
                      {buses.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.bus_number}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Detection</div>
                    <select
                      className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
                      value={result}
                      onChange={(e) => setResult(e.target.value as "CLEAR" | "DETECTED")}
                    >
                      <option value="CLEAR">CLEAR (no defect)</option>
                      <option value="DETECTED">DETECTED (defect present)</option>
                    </select>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">
                      Confidence {Math.round(confidence * 100)}%
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={1}
                      step={0.05}
                      value={confidence}
                      onChange={(e) => setConfidence(Number(e.target.value))}
                      className="w-28 accent-cyan-500"
                    />
                  </div>
                  <button
                    onClick={() => submit(issue)}
                    disabled={busy === issue.id}
                    className="ml-auto px-4 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-sm text-white font-medium"
                  >
                    {busy === issue.id ? "Sending…" : "Submit pass"}
                  </button>
                </div>

                <button
                  onClick={() => toggleHistory(issue.id)}
                  className="text-xs text-cyan-400 hover:text-cyan-300"
                >
                  {open ? "hide history" : `show verification history (${history[issue.id]?.length ?? 0})`}
                </button>

                {open && (
                  <div className="space-y-2 pt-2 border-t border-gray-800">
                    {(history[issue.id] ?? []).length === 0 && (
                      <div className="text-xs text-gray-500">No verification passes recorded yet.</div>
                    )}
                    {(history[issue.id] ?? []).map((v) => (
                      <div key={v.id} className="flex justify-between text-xs bg-gray-800/40 rounded px-3 py-2">
                        <span className="text-gray-300">
                          {v.detection_result === "CLEAR" ? "CLEAR ✓" : "DETECTED ✗"} ·{" "}
                          <span className="text-gray-500">{v.bus_id.slice(0, 8)}</span> ·{" "}
                          {new Date(v.timestamp).toLocaleTimeString()}
                        </span>
                        <Badge text={v.result} variant={v.result === "CLEARED" ? "success" : "warning"} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {issues.length === 0 && !error && (
        <Card className="p-8 text-center">
          <div className="text-sm text-gray-500">No issues pending multi-bus verification.</div>
        </Card>
      )}
    </div>
  );
}