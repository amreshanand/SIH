"use client";

import { useCallback, useEffect, useState } from "react";
import { api, APIError, auth } from "@/lib/api";
import { Card, CardHeader, Badge, Stat } from "@/components/ui/Card";
import type { SystemHealth } from "@/types";

interface DemoStatus {
  buses: number;
  events: number;
  issues: number;
  incidents: number;
  lifecycle_steps: number;
}

export default function SettingsPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [demo, setDemo] = useState<DemoStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [currentUser] = useState(auth.user);
  const isAdmin = currentUser?.role === "ADMIN";

  const load = useCallback(() => {
    setMsg(null);
    Promise.all([api.getSystemHealth(), api.getDemoStatus()])
      .then(([h, d]) => {
        setHealth(h);
        setDemo(d as DemoStatus);
      })
      .catch((e: unknown) => {
        setErr(e instanceof APIError ? `${e.status}: ${e.detail}` : "Failed to load settings");
      });
  }, []);

  useEffect(() => {
    const id = setTimeout(() => load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  const runAction = async (label: string, fn: () => Promise<unknown>) => {
    if (!isAdmin) {
      setMsg("Admin access required");
      return;
    }
    if (!window.confirm(`Run "${label}" — this changes demo data. Continue?`)) return;
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      setMsg(`${label} completed`);
      load();
    } catch (e) {
      setMsg(e instanceof APIError ? `${label} failed: ${e.status} ${e.detail}` : `${label} failed`);
    } finally {
      setBusy(null);
    }
  };

  const caps = health?.capabilities ?? {};
  const capList = Object.entries(caps);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Settings</h1>
        <p className="text-sm text-gray-500">
          Runtime configuration, AI modes, and demo lifecycle controls
        </p>
      </div>

      {msg && (
        <Card className="p-4 border-cyan-500/40">
          <span className="text-sm text-cyan-300">{msg}</span>
        </Card>
      )}
      {err && (
        <Card className="p-4">
          <span className="text-sm text-red-400">{err}</span>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <span className="text-sm font-semibold text-gray-200">Configuration</span>
            <Badge text={health?.pipeline ?? "…"} variant={health?.pipeline === "LIVE" ? "online" : "low"} />
          </CardHeader>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <Stat label="AI Mode" value={health?.ai_mode ?? "—"} tone="cyan" />
              <Stat label="GPS Mode" value={health?.gps_mode ?? "—"} tone="cyan" />
            </div>
            <div className="grid grid-cols-3 gap-4 my-3">
              <Badge text={`DB ${health?.database.status ?? "?"}`} variant={health?.database.status === "online" ? "success" : "critical"} />
              <Badge text={`PostGIS ${health?.postgis?.status ?? "n/a"}`} variant="info" />
              <Badge text={health?.spatial_engine ?? "—"} variant="info" />
            </div>
            {capList.length > 0 && (
              <div className="mt-4 border-t border-gray-800 pt-3">
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Capabilities</div>
                {capList.map(([name, cap]) => {
                  const c = cap as { mode: string; detail: string };
                  return (
                    <div key={name} className="flex justify-between py-1 text-xs">
                      <span className="text-gray-300 capitalize">{name.replace(/_/g, " ")}</span>
                      <span className="text-gray-500">
                        {c.mode} · {c.detail}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-sm font-semibold text-gray-200">Demo Data &amp; Lifecycle</span>
            <Badge text={isAdmin ? "ADMIN" : "READ-ONLY"} variant={isAdmin ? "success" : "default"} />
          </CardHeader>
          <div className="p-4">
            {demo && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-5">
                <Card className="p-3"><Stat label="Buses" value={demo.buses} /></Card>
                <Card className="p-3"><Stat label="Events" value={demo.events} /></Card>
                <Card className="p-3"><Stat label="Issues" value={demo.issues} /></Card>
                <Card className="p-3"><Stat label="Incidents" value={demo.incidents} /></Card>
              </div>
            )}
            <div className="space-y-3">
              {(
                [
                  ["Reset database", () => api.resetDemo()],
                  ["Seed demo data", () => api.seedDemo()],
                  ["Run SIH demo lifecycle", () => api.runSihMode()],
                ] as Array<[string, () => Promise<unknown>]>
              ).map(([label, fn]) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-sm text-gray-300">{label}</span>
                  <button
                    onClick={() => runAction(label, fn)}
                    disabled={busy === label}
                    className="px-4 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-sm text-white font-medium"
                  >
                    {busy === label ? "Running…" : "Run"}
                  </button>
                </div>
              ))}
              {!isAdmin && (
                <p className="text-xs text-amber-400 pt-2">
                  ADMIN role required for demo controls — current role: {currentUser?.role ?? "none"}
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}