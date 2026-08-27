"use client";

import { useEffect, useState, useMemo } from "react";
import { api } from "@/lib/api";
import { Card, CardHeader, Badge } from "@/components/ui/Card";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { SystemHealth } from "@/types";

interface StreamStatus {
  running: boolean;
  source: string;
  bus_id: string;
  camera: string;
  fps: number;
}

interface LiveDetEvent {
  type?: string;
  event_type?: string;
  event_id?: string;
  severity?: string;
}

export default function LivePage() {
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const { messages } = useWebSocket("events");
  const events = useMemo<LiveDetEvent[]>(() => messages.slice(0, 15) as LiveDetEvent[], [messages]);

  useEffect(() => {
    api.getStreamStatus().then(setStatus).catch(() => {});
    api.getSystemHealth().then(setHealth).catch(() => {});
    const interval = setInterval(() => api.getStreamStatus().then(setStatus).catch(() => {}), 2000);
    return () => clearInterval(interval);
  }, []);

  const streamUrl = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/stream/camera`;
  const aiLabel = health ? (health.pipeline === "LIVE" ? "AI: LIVE" : "AI: SIMULATED") : "AI: …";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Live Fleet Monitoring</h1>
          <p className="text-sm text-gray-500">Real-time camera feeds with AI overlays</p>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${status?.running ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />{status?.running ? "LIVE" : "OFFLINE"}</span>
          <span className="text-gray-500">FPS: {status?.fps?.toFixed(0) || "0"}</span>
          <span className="text-gray-500">Source: {status?.source || "N/A"}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Card className="overflow-hidden">
            <CardHeader>
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${status?.running ? "bg-emerald-500 animate-pulse" : "bg-gray-600"}`} />
                <span className="text-sm font-medium text-white">{status?.bus_id || "BUS-001"}</span>
                <Badge text={status?.camera || "FRONT"} variant="default" />
                {status?.running ? <Badge text="LIVE" variant="success" /> : <Badge text="OFFLINE" variant="critical" />}
              </div>
            </CardHeader>
            <div className="bg-black aspect-video relative">
              {status?.running ? (
                <>
                  <img src={streamUrl} alt="Live feed" className="w-full h-full object-contain" />
                  <div className="absolute top-2 right-2 bg-black/70 px-2 py-1 rounded text-[9px] text-emerald-400 space-y-0.5">
                    <div>BUS-001 | FRONT</div>
                    <div>{aiLabel}</div>
                    <div>{status?.fps?.toFixed(1) || "0"} FPS</div>
                  </div>
                  <div className="absolute bottom-2 left-2 bg-black/70 px-2 py-1 rounded text-[9px] text-gray-400">
                    GPS: SOURCE={status?.source === "phone" ? "PHONE" : "SIMULATED"}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-600">
                  <div className="text-center">
                    <div className="text-4xl mb-3 opacity-30">📹</div>
                    <p className="text-sm">Camera Offline</p>
                    <p className="text-[10px] text-gray-700 mt-2">Start edge AI: <code className="bg-gray-800 px-1.5 py-0.5 rounded">python edge/main.py</code></p>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><span className="text-xs text-gray-400">AI Detection Feed</span></CardHeader>
            <div className="p-3 max-h-[300px] overflow-y-auto space-y-1.5">
              {events.length === 0 && (
                <div className="text-[10px] text-gray-600 text-center py-4">Waiting for detections...</div>
              )}
              {events.map((e, i) => (
                <div key={i} className="p-2 bg-gray-800/50 rounded border-l-2" style={{borderLeftColor: e.severity === "CRITICAL" ? "#ef4444" : e.severity === "HIGH" ? "#f97316" : "#eab308"}}>
                  <div className="text-[10px] font-medium text-white">{e.type || e.event_type}</div>
                  <div className="text-[9px] text-gray-500">{e.event_id} | {e.severity}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader><span className="text-xs text-gray-400">Vehicle Count</span></CardHeader>
            <div className="p-3 grid grid-cols-2 gap-2 text-[10px]">
              {["car", "motorcycle", "bus", "truck", "bicycle", "person"].map((cls) => (
                <div key={cls} className="flex justify-between">
                  <span className="text-gray-500">{cls}</span>
                  <span className="text-gray-300 font-mono">—</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {["REAR", "LEFT", "RIGHT", "CABIN"].map((cam) => (
          <Card key={cam}>
            <CardHeader>
              <span className="text-[10px] text-gray-400">{cam}</span>
              <Badge text="STANDBY" variant="default" />
            </CardHeader>
            <div className="bg-gray-900 aspect-video flex items-center justify-center">
              <span className="text-[10px] text-gray-700">File mode</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
