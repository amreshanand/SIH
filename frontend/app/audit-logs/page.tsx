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
        <h1 className="text-2xl font-bold text-gray-100">Audit Logs</h1>
        <p className="text-sm text-gray-500">Immutable trail of every state transition and authority action</p>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Action</div>
            <input
              value={action}
              onChange={(e) => setAction(e.target.value.toUpperCase())}
              placeholder="e.g. ISSUE_CLAIM"
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 w-52"
            />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Entity</div>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
            >
              <option value="">all</option>
              {entityTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={applyFilters}
            className="px-4 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-sm text-white font-medium"
          >
            Apply
          </button>
          <span className="ml-auto text-xs text-gray-500">
            {total} entries · showing {logs.length}
          </span>
        </div>
      </Card>

      {error && (
        <Card className="p-4">
          <span className="text-sm text-red-400">{error}</span>
        </Card>
      )}

      <Card>
        <CardHeader>
          <span className="text-sm font-semibold text-gray-200">Audit trail</span>
          <Badge text={`${total} total`} variant="info" />
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-gray-500 border-b border-gray-800">
                <th className="px-4 py-2">Time</th>
                <th className="px-4 py-2">Actor</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Entity</th>
                <th className="px-4 py-2">Entity ID</th>
                <th className="px-4 py-2">Old → New</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-gray-800/60 text-sm hover:bg-gray-800/20">
                  <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">
                    {l.created_at ? new Date(l.created_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-300">{l.username ?? l.user_id?.slice(0, 8) ?? "system"}</td>
                  <td className="px-4 py-2">
                    <Badge text={l.action} variant={actionVariant(l.action)} />
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-400">{l.entity_type}</td>
                  <td className="px-4 py-2 text-xs text-gray-400 font-mono">{l.entity_id}</td>
                  <td className="px-4 py-2 text-xs">
                    <span className="text-gray-500">{jsonBrief(l.old_value)}</span>
                    <span className="text-gray-700"> → </span>
                    <span className="text-cyan-300">{jsonBrief(l.new_value)}</span>
                  </td>
                </tr>
              ))}
              {logs.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                    No audit entries match the filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {logs.length < total && (
          <div className="p-4 border-t border-gray-800 flex justify-center">
            <button
              onClick={more}
              disabled={loading}
              className="px-4 py-1.5 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-sm text-gray-200"
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}