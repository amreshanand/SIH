"use client";

import { useCallback, useEffect, useState } from "react";
import { api, APIError } from "@/lib/api";
import { Card, CardHeader, Badge } from "@/components/ui/Card";
import type { AuditLogEntry } from "@/types";

function actionVariant(action: string): string {
  if (action.startsWith("ISSUE_") || action.includes("ASSIGN")) return "info";
  if (action.includes("RESOLVE") || action.includes("VERIFY")) return "success";
  if (action.includes("REOPEN") || action.includes("ESCALATE")) return "warning";
  if (action.includes("FAIL") || action.includes("DELETE") || action.includes("REJECT")) return "critical";
  return "default";
}

function jsonBrief(value: Record<string, unknown> | null): string {
  if (!value) return "—";
  const s = JSON.stringify(value);
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = 50;

  const load = useCallback(
    async (offset: number, reset: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const params: Record<string, string> = {
          skip: String(offset),
          limit: String(limit),
        };
        if (action) params.action = action;
        if (entityType) params.entity_type = entityType;
        const res = await api.getAuditLogs(params);
        setTotal(res.total);
        setLogs((prev) => (reset ? res.logs : [...prev, ...res.logs]));
      } catch (e) {
        setError(e instanceof APIError ? `${e.status}: ${e.detail}` : "Failed to load audit logs");
      } finally {
        setLoading(false);
      }
    },
    [action, entityType],
  );

  useEffect(() => {
    const id = setTimeout(() => void load(0, true), 0);
    return () => clearTimeout(id);
  }, [load]);

  const applyFilters = () => {
    setSkip(0);
    void load(0, true);
  };

  const more = () => {
    const next = skip + limit;
    setSkip(next);
    void load(next, false);
  };

  const entityTypes = Array.from(new Set(logs.map((l) => l.entity_type).filter(Boolean))).sort();

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Audit Logs</h1>
        <p className="text-xs text-slate-500 mt-0.5">Immutable trail of every state transition, authority decision, and defect life cycle event</p>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-600 mb-1 font-mono">Action Filter</div>
            <input
              value={action}
              onChange={(e) => setAction(e.target.value.toUpperCase())}
              placeholder="e.g. ISSUE_CLAIM"
              className="bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white w-52 transition-colors"
            />
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-600 mb-1 font-mono">Entity Type</div>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-colors"
            >
              <option value="">All Entities</option>
              {entityTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={applyFilters}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs text-white font-bold transition-colors cursor-pointer shadow-xs"
          >
            Apply Filters
          </button>
          <span className="ml-auto text-xs font-medium text-slate-500">
            <strong className="text-slate-800">{total}</strong> entries recorded · showing {logs.length}
          </span>
        </div>
      </Card>

      {error && (
        <Card className="p-4 bg-rose-50 border-rose-200">
          <span className="text-xs font-semibold text-rose-700">{error}</span>
        </Card>
      )}

      <Card>
        <CardHeader>
          <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">Immutable Audit Trail</span>
          <Badge text={`${total} TOTAL ENTRIES`} variant="default" />
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] uppercase font-bold tracking-wider text-slate-500 border-b border-slate-200 bg-slate-50/70 font-mono">
                <th className="px-4 py-2.5">Time</th>
                <th className="px-4 py-2.5">Actor</th>
                <th className="px-4 py-2.5">Action</th>
                <th className="px-4 py-2.5">Entity</th>
                <th className="px-4 py-2.5">Entity ID</th>
                <th className="px-4 py-2.5">Old → New State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-2.5 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                    {l.created_at ? new Date(l.created_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2.5 font-semibold text-slate-800">{l.username ?? l.user_id?.slice(0, 8) ?? "system"}</td>
                  <td className="px-4 py-2.5">
                    <Badge text={l.action} variant={actionVariant(l.action)} />
                  </td>
                  <td className="px-4 py-2.5 font-medium text-slate-700">{l.entity_type}</td>
                  <td className="px-4 py-2.5 text-slate-600 font-mono text-[11px]">{l.entity_id}</td>
                  <td className="px-4 py-2.5 font-mono text-[11px]">
                    <span className="text-slate-500">{jsonBrief(l.old_value)}</span>
                    <span className="text-slate-400 font-bold"> → </span>
                    <span className="text-blue-700 font-semibold">{jsonBrief(l.new_value)}</span>
                  </td>
                </tr>
              ))}
              {logs.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500 font-mono">
                    No audit entries match the filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {logs.length < total && (
          <div className="p-4 border-t border-slate-200 flex justify-center bg-slate-50/50">
            <button
              onClick={more}
              disabled={loading}
              className="px-4 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-xs font-semibold text-slate-800 transition-colors cursor-pointer shadow-xs"
            >
              {loading ? "Loading…" : "Load more entries"}
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}