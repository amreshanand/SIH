"use client";

import { useCallback, useEffect, useState } from "react";
import { api, APIError, auth, type AuthUser } from "@/lib/api";
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
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setCurrentUser(auth.user);
    setMounted(true);
    const handler = () => setCurrentUser(auth.user);
    window.addEventListener("auth-changed", handler);
    return () => window.removeEventListener("auth-changed", handler);
  }, []);

  const isAdmin = mounted && currentUser?.role === "ADMIN";

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">System Settings</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Runtime configuration, AI modes, and demo lifecycle controls
        </p>
      </div>

      {msg && (
        <Card className="p-3 bg-cyan-50 border-cyan-200">
          <span className="text-xs font-semibold text-cyan-800">{msg}</span>
        </Card>
      )}
      {err && (
        <Card className="p-3 bg-rose-50 border-rose-200">
          <span className="text-xs font-semibold text-rose-700">{err}</span>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">System Configuration</span>
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
              <div className="mt-4 border-t border-slate-200 pt-3">
                <div className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mb-2 font-mono">Capabilities</div>
                {capList.map(([name, cap]) => {
                  const c = cap as { mode: string; detail: string };
                  return (
                    <div key={name} className="flex justify-between py-1 text-xs">
                      <span className="text-slate-800 font-semibold capitalize">{name.replace(/_/g, " ")}</span>
                      <span className="text-slate-500 font-mono">
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
            <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">Demo Data &amp; Lifecycle</span>
            <Badge
              text={!mounted ? "..." : isAdmin ? "ADMIN" : "READ-ONLY"}
              variant={!mounted ? "default" : isAdmin ? "success" : "default"}
            />
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
                  ["Run automated workflow validation", () => api.runSihMode()],
                ] as Array<[string, () => Promise<unknown>]>
              ).map(([label, fn]) => (
                <div key={label} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-xs font-semibold text-slate-800">{label}</span>
                  <button
                    onClick={() => runAction(label, fn)}
                    disabled={busy === label}
                    className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-xs text-white font-semibold transition-colors cursor-pointer shadow-xs"
                  >
                    {busy === label ? "Running…" : "Run"}
                  </button>
                </div>
              ))}
              {mounted && !isAdmin && (
                <p className="text-xs text-amber-700 pt-2 font-medium">
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