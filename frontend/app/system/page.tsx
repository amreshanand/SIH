"use client";

import { useEffect, useState } from "react";
import { api, APIError } from "@/lib/api";
import { Card, CardHeader, Badge } from "@/components/ui/Card";
import type { SystemHealth, SpatialStatus } from "@/types";

function modeVariant(mode: string): string {
  switch (mode) {
    case "LIVE":
    case "REAL":
    case "PHONE":
    case "NMEA":
      return "success";
    case "SIMULATED":
      return "warning";
    case "OFF":
    case "UNAVAILABLE":
      return "critical";
    default:
      return "default";
  }
}

function CapabilityRow({ name, cap }: { name: string; cap: { mode: string; detail: string; live: boolean } }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${cap.live ? "bg-emerald-500" : "bg-amber-500"}`} />
        <span className="text-xs text-slate-800 capitalize font-medium">{name.replace(/_/g, " ")}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-slate-500 font-mono">{cap.detail}</span>
        <Badge text={cap.mode} variant={modeVariant(cap.mode)} />
      </div>
    </div>
  );
}

interface ModelInfo {
  name: string;
  path: string;
  status: string;
  available: boolean;
  size_bytes: number;
  note?: string;
}

interface ModelsResponse {
  vehicle_model: ModelInfo;
  road_damage_model: ModelInfo;
}

export default function SystemPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [spatial, setSpatial] = useState<SpatialStatus | null>(null);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getSystemHealth(), api.getSpatialStatus(), api.getSystemModels().catch(() => null)])
      .then(([h, s, m]) => {
        if (!cancelled) {
          setHealth(h);
          setSpatial(s);
          setModels(m);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof APIError ? `${e.status}: ${e.detail}` : "Failed to load system diagnostics");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="p-6 max-w-7xl">
        <h1 className="text-xl font-bold text-slate-900 mb-4">System Infrastructure Diagnostics</h1>
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded text-xs">
          Unable to reach backend: {error}
        </div>
      </div>
    );
  }

  if (!health || !spatial) {
    return (
      <div className="p-6 max-w-7xl">
        <h1 className="text-xl font-bold text-slate-900 mb-4">System Infrastructure Diagnostics</h1>
        <div className="p-4 bg-white border border-slate-200 rounded text-slate-500 text-xs font-mono">
          Loading diagnostic health indicators...
        </div>
      </div>
    );
  }

  const pipelineLive = health.pipeline === "LIVE";
  const dbOnline = health.database.status === "online";

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-xl font-bold text-slate-900">System Infrastructure Diagnostics</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Deterministic capabilities, database latencies, PostGIS readiness, and neural network weights
        </p>
      </div>

      {/* Top Health Indicators */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Pipeline Mode</div>
          <div className={`text-xl font-bold mt-1 ${pipelineLive ? "text-emerald-700" : "text-amber-700"}`}>
            {health.pipeline}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Real-time edge telemetry</div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Database Engine</div>
          <div className={`text-xl font-bold mt-1 ${dbOnline ? "text-emerald-700" : "text-red-700"}`}>
            {dbOnline ? "ONLINE" : "OFFLINE"}
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">{health.database.latency_ms}ms round-trip</div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Spatial Indexing</div>
          <div className="text-xl font-bold mt-1 text-blue-700 font-mono">{spatial.engine}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            PostGIS {spatial.postgis_installed ? "Enabled" : "Fallback"}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Inference Runtime</div>
          <div className="text-xl font-bold mt-1 text-slate-900 font-mono">{health.ai_mode.toUpperCase()}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">GPS fix: {health.gps_mode}</div>
        </div>
      </div>

      {/* Capabilities & Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">Edge Sensing Modules</span>
            <Badge text={pipelineLive ? "LIVE PIPELINE" : "SYNTHETIC / FALLBACK"} variant={pipelineLive ? "success" : "warning"} />
          </CardHeader>
          <div className="p-4">
            {Object.entries(health.capabilities || {}).map(([name, cap]) => (
              <CapabilityRow key={name} name={name} cap={cap as never} />
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">GIS & Spatial Topology</span>
          </CardHeader>
          <div className="p-4 space-y-2 text-xs">
            <div className="flex justify-between border-b border-slate-100 pb-1.5">
              <span className="text-slate-500">Assigned Transit Unit: </span>
              <span className="font-mono text-slate-800">{health.bus_id ?? "—"}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-1.5">
              <span className="text-slate-500">Active Camera Mount: </span>
              <span className="font-mono text-slate-800">{health.camera ?? "—"}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-1.5">
              <span className="text-slate-500">Cluster Distance Threshold: </span>
              <span className="font-mono font-semibold text-slate-800">{spatial.cluster_distance_meters} meters</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-1.5">
              <span className="text-slate-500">Demo State: </span>
              <span className="font-mono text-slate-800">{health.demo_mode ? "ACTIVE" : "OFF"}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-1.5">
              <span className="text-slate-500">Spatial Geometry Tables: </span>
              <span className="font-mono text-slate-800">
                {spatial.geometry_tables.length ? spatial.geometry_tables.join(", ") : "none (haversine)"}
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-1.5">
              <span className="text-slate-500">GiST Spatial Indexes: </span>
              <span className="font-mono text-slate-800">
                {spatial.gist_indexes.length ? spatial.gist_indexes.join(", ") : "none"}
              </span>
            </div>
            <div className="pt-1 text-[11px] text-slate-500 italic">{spatial.note}</div>
          </div>
        </Card>
      </div>

      {/* Model Weights Diagnostic */}
      {models && (
        <Card>
          <CardHeader>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              Neural Network Weights & Diagnostics
            </span>
            <Badge
              text={models.road_damage_model.available ? "WEIGHTS READY" : "TRANSPARENT FALLBACK ACTIVE"}
              variant={models.road_damage_model.available ? "success" : "default"}
            />
          </CardHeader>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3 rounded bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">{models.vehicle_model.name}</span>
                  <Badge
                    text={models.vehicle_model.available ? "READY" : "MISSING"}
                    variant={models.vehicle_model.available ? "success" : "critical"}
                  />
                </div>
                <div className="text-[11px] text-slate-600 font-mono break-all">{models.vehicle_model.path}</div>
                <div className="text-[11px] text-slate-500">
                  Size: {(models.vehicle_model.size_bytes / (1024 * 1024)).toFixed(2)} MB • COCO Pretrained
                </div>
              </div>

              <div className="p-3 rounded bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">{models.road_damage_model.name}</span>
                  <Badge
                    text={models.road_damage_model.available ? "WEIGHTS MOUNTED" : "HEURISTIC FALLBACK"}
                    variant={models.road_damage_model.available ? "success" : "warning"}
                  />
                </div>
                <div className="text-[11px] text-slate-600 font-mono break-all">{models.road_damage_model.path}</div>
                <div className="text-[11px] text-slate-500">
                  {models.road_damage_model.available
                    ? `Size: ${(models.road_damage_model.size_bytes / (1024 * 1024)).toFixed(2)} MB • Custom RDD2022 Weights`
                    : "Weights file absent. Platform operates in non-fabricating heuristic mode."}
                </div>
              </div>
            </div>

            {models.road_damage_model.note && (
              <div className="text-xs p-3 rounded bg-slate-50 border border-slate-200 text-slate-700">
                Notice: {models.road_damage_model.note}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
