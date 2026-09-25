"use client";

import { useEffect, useMemo, useState } from "react";
import { api, APIError, auth, type AuthUser } from "@/lib/api";
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
  const confidence = 0.95;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setCurrentUser(auth.user);
    setMounted(true);
    const handler = () => setCurrentUser(auth.user);
    window.addEventListener("auth-changed", handler);
    return () => window.removeEventListener("auth-changed", handler);
  }, []);

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
        <h1 className="text-2xl font-bold text-slate-900 mb-4">Multi-Bus Verification</h1>
        <Card className="p-6 bg-rose-50 border-rose-200">
          <div className="text-xs font-semibold text-rose-700">Unable to reach backend: {error}</div>
        </Card>
      </div>
    );
  }

  if (!mounted) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-4">Multi-Bus Verification</h1>
        <Card className="p-6">
          <div className="text-slate-500 font-mono text-sm animate-pulse">Loading verification console...</div>
        </Card>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-4">Multi-Bus Verification</h1>
        <Card className="p-6 bg-amber-50 border-amber-200">
          <div className="text-xs font-semibold text-amber-800">Sign in to submit verification passes.</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Multi-Bus Verification</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Cross-fleet consensus and re-verification. If a future bus detects the defect again after repair, it is automatically REOPENED.
          </p>
        </div>
      </div>

      {notice && (
        <Card className="p-3.5 bg-cyan-50 border-cyan-200">
          <span className="text-xs font-semibold text-cyan-800">{notice}</span>
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
                  <span className="text-xs font-bold font-mono text-slate-900">{issue.issue_id}</span>
                  <Badge text={issue.issue_type.replace(/_/g, " ")} variant={sevVariant[issue.severity] || "default"} />
                  <Badge text={issue.status} variant={statusVariant(issue.status)} />
                </div>
                <span className="text-xs font-mono text-slate-500">
                  {issue.latitude.toFixed(4)}, {issue.longitude.toFixed(4)}
                </span>
              </CardHeader>
              <div className="p-4 space-y-4">
                <div className="flex justify-between text-xs font-medium text-slate-600">
                  <span>Observations: <strong className="text-slate-900 font-mono">{issue.observation_count}</strong></span>
                  <span>Confidence: <strong className="text-slate-900 font-mono">{(issue.confidence * 100).toFixed(0)}%</strong></span>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <div className="text-[10px] uppercase font-bold tracking-wider text-slate-600 mb-1 font-mono">Bus</div>
                    <select
                      className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-colors"
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
                    <div className="text-[10px] uppercase font-bold tracking-wider text-slate-600 mb-1 font-mono">Detection Result</div>
                    <select
                      className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-colors"
                      value={result}
                      onChange={(e) => setResult(e.target.value as "CLEAR" | "DETECTED")}
                    >
                      <option value="CLEAR">CLEAR (no defect)</option>
                      <option value="DETECTED">DETECTED (defect present)</option>
                    </select>
                  </div>
                  <button
                    onClick={() => submit(issue)}
                    disabled={busy === issue.id}
                    className="ml-auto px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-xs text-white font-bold transition-colors cursor-pointer shadow-xs"
                  >
                    {busy === issue.id ? "Sending…" : "Submit pass"}
                  </button>
                </div>

                <button
                  onClick={() => toggleHistory(issue.id)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
                >
                  {open ? "▲ Hide history" : `▼ Show verification history (${history[issue.id]?.length ?? 0})`}
                </button>

                {open && (
                  <div className="space-y-2 pt-2 border-t border-slate-200">
                    {(history[issue.id] ?? []).length === 0 && (
                      <div className="text-xs text-slate-500 font-mono">No verification passes recorded yet.</div>
                    )}
                    {(history[issue.id] ?? []).map((v) => (
                      <div key={v.id} className="flex justify-between items-center text-xs bg-slate-50 border border-slate-200/80 rounded-lg px-3 py-2">
                        <span className="text-slate-800 font-medium">
                          <strong className={v.detection_result === "CLEAR" ? "text-emerald-700" : "text-amber-700"}>
                            {v.detection_result === "CLEAR" ? "CLEAR ✓" : "DETECTED ✗"}
                          </strong>{" "}
                          · <span className="font-mono text-slate-500">{v.bus_id.slice(0, 8)}</span> ·{" "}
                          <span className="text-slate-500">{new Date(v.timestamp).toLocaleTimeString()}</span>
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
          <div className="text-xs text-slate-500 font-mono">No issues pending multi-bus verification.</div>
        </Card>
      )}
    </div>
  );
}