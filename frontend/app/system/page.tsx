"use client";

import { useEffect, useState } from "react";
import { api, APIError } from "@/lib/api";
import { Card, CardHeader, Badge } from "@/components/ui/Card";
import type { SystemHealth, SpatialStatus } from "@/types";

function modeColor(mode: string): string {
  switch (mode) {
    case "LIVE":
    case "REAL":
    case "PHONE":
      return "success";
    case "MOCK":
    case "SIMULATED":
      return "low";
    case "OFF":
    case "UNAVAILABLE":
      return "medium";
    default:
      return "default";
  }
}

function CapabilityRow({ name, cap }: { name: string; cap: { mode: string; detail: string; live: boolean } }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-800 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${cap.live ? "bg-emerald-500" : "bg-amber-400"}`} />
        <span className="text-sm text-gray-200 capitalize">{name.replace(/_/g, " ")}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500">{cap.detail}</span>
        <Badge text={cap.mode} variant={modeColor(cap.mode)} />
      </div>
    </div>
  );
}

export default function SystemPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [spatial, setSpatial] = useState<SpatialStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getSystemHealth(), api.getSpatialStatus()])
      .then(([h, s]) => {
        if (!cancelled) {
          setHealth(h);
          setSpatial(s);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof APIError ? `${e.status}: ${e.detail}` : "Failed to load system status");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-100 mb-4">System Status</h1>
        <Card className="p-6">
          <div className="text-red-400">Unable to reach backend: {error}</div>
        </Card>
      </div>
    );
  }

  if (!health || !spatial) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-100 mb-4">System Status</h1>
        <Card className="p-6">
          <div className="text-gray-400 animate-pulse">Loading system status…</div>
        </Card>
      </div>
    );
  }

  const pipelineLive = health.pipeline === "LIVE";
  const dbOnline = health.database.status === "online";

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">System Status</h1>
        <p className="text-sm text-gray-500">Truthful, real-time health of the UrbanSense AI pipeline</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-widest text-gray-500">Overall Pipeline</div>
          <div className={`text-2xl font-bold mt-1 ${pipelineLive ? "text-emerald-400" : "text-amber-400"}`}>
            {health.pipeline}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-widest text-gray-500">Database</div>
          <div className={`text-2xl font-bold mt-1 ${dbOnline ? "text-emerald-400" : "text-red-400"}`}>
            {dbOnline ? "ONLINE" : "OFFLINE"}
          </div>
          <div className="text-[10px] text-gray-500 mt-1">{health.database.latency_ms}ms latency</div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-widest text-gray-500">Spatial Engine</div>
          <div className="text-2xl font-bold mt-1 text-cyan-400">{spatial.engine}</div>
          <div className="text-[10px] text-gray-500 mt-1">
            PostGIS {spatial.postgis_installed ? "installed" : "not installed"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-widest text-gray-500">AI Mode</div>
          <div className="text-2xl font-bold mt-1 text-cyan-400">{health.ai_mode.toUpperCase()}</div>
          <div className="text-[10px] text-gray-500 mt-1">model · gps: {health.gps_mode}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <span className="text-sm font-semibold text-gray-200">Edge / AI Capabilities</span>
            <Badge text={pipelineLive ? "LIVE" : "SIMULATED"} variant={pipelineLive ? "success" : "low"} />
          </CardHeader>
          <div className="p-4">
            {Object.entries(health.capabilities || {}).map(([name, cap]) => (
              <CapabilityRow key={name} name={name} cap={cap as never} />
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-sm font-semibold text-gray-200">Spatial / Configuration</span>
          </CardHeader>
          <div className="p-4">
            <div className="py-2.5 border-b border-gray-800 text-sm">
              <span className="text-gray-500">Bus ID: </span>
              <span className="text-gray-200">{health.bus_id ?? "—"}</span>
            </div>
            <div className="py-2.5 border-b border-gray-800 text-sm">
              <span className="text-gray-500">Camera: </span>
              <span className="text-gray-200">{health.camera ?? "—"}</span>
            </div>
            <div className="py-2.5 border-b border-gray-800 text-sm">
              <span className="text-gray-500">Cluster radius: </span>
              <span className="text-gray-200">{spatial.cluster_distance_meters}m</span>
            </div>
            <div className="py-2.5 border-b border-gray-800 text-sm">
              <span className="text-gray-500">Demo mode: </span>
              <span className="text-gray-200">{health.demo_mode ? "ON" : "OFF"}</span>
            </div>
            <div className="py-2.5 border-b border-gray-800 text-sm">
              <span className="text-gray-500">Geometry tables: </span>
              <span className="text-gray-200">
                {spatial.geometry_tables.length ? spatial.geometry_tables.join(", ") : "none"}
              </span>
            </div>
            <div className="py-2.5 border-b border-gray-800 text-sm">
              <span className="text-gray-500">GiST indexes: </span>
              <span className="text-gray-200">
                {spatial.gist_indexes.length ? spatial.gist_indexes.join(", ") : "none"}
              </span>
            </div>
            <div className="py-2.5 text-xs text-gray-600">{spatial.note}</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
