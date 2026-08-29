"use client";

import { useEffect, useState, useMemo } from "react";
import { api } from "@/lib/api";
import { Card, CardHeader, Badge } from "@/components/ui/Card";
import { useWebSocket } from "@/hooks/useWebSocket";
import { StreamStatus, CameraStatusInfo } from "@/types";

interface LiveDetEvent {
  type?: string;
  event_type?: string;
  event_id?: string;
  camera_id?: string;
  camera_type?: string;
  class_name?: string;
  track_id?: string | number;
  severity?: string;
  confidence?: number;
  timestamp?: number | string;
  created_at?: string;
  evidence_url?: string;
  metadata?: Record<string, unknown>;
  metadata_json?: Record<string, unknown>;
}

type ViewMode = "dual" | "front" | "inside";

export default function LivePage() {
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("dual");
  const [frontCounts, setFrontCounts] = useState<Record<string, number>>({
    car: 0,
    motorcycle: 0,
    bus: 0,
    truck: 0,
    bicycle: 0,
    person: 0,
  });
  const [insidePassengerCount, setInsidePassengerCount] = useState<number>(0);
  const [historyEvents, setHistoryEvents] = useState<LiveDetEvent[]>([]);

  const { messages } = useWebSocket("events");

  // Merge live WebSocket messages with initial historical events
  const events = useMemo<LiveDetEvent[]>(() => {
    const wsEvents = messages as LiveDetEvent[];
    const combined = [...wsEvents, ...historyEvents];
    const seen = new Set<string>();
    const unique: LiveDetEvent[] = [];
    for (const ev of combined) {
      const id = ev.event_id || `${ev.event_type}-${ev.timestamp}-${ev.created_at}`;
      if (!seen.has(id)) {
        seen.add(id);
        unique.push(ev);
      }
    }
    return unique.slice(0, 30);
  }, [messages, historyEvents]);

  useEffect(() => {
    // Initial fetch of recent events from backend
    api.getEvents({ limit: "20" })
      .then((res) => {
        if (res.events && res.events.length > 0) {
          setHistoryEvents(res.events as unknown as LiveDetEvent[]);
        }
      })
      .catch(() => {});

    const fetchStatus = () => {
      api.getStreamStatus()
        .then((st) => {
          setStatus(st);
          if (st.cameras && st.cameras.length > 0) {
            const front = st.cameras.find((c) => c.camera_type === "OUTSIDE" || c.camera_id.includes("FRONT"));
            const inside = st.cameras.find((c) => c.camera_type === "INSIDE" || c.camera_id.includes("INSIDE"));

            if (front && front.counts) {
              setFrontCounts((prev) => ({ ...prev, ...front.counts }));
            }
            if (inside && inside.counts) {
              setInsidePassengerCount(inside.counts.person ?? inside.counts.passenger ?? 0);
            }
          } else if (st.vehicle_counts) {
            setFrontCounts((prev) => ({ ...prev, ...st.vehicle_counts }));
          }
        })
        .catch(() => {});
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 1500);
    return () => clearInterval(interval);
  }, []);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const frontStreamUrl = `${apiBase}/api/stream/camera?camera_id=BUS-001-CAM-FRONT`;
  const insideStreamUrl = `${apiBase}/api/stream/camera?camera_id=BUS-001-CAM-INSIDE`;

  const frontCamInfo: CameraStatusInfo | undefined = status?.cameras?.find(
    (c) => c.camera_type === "OUTSIDE" || c.camera_id.includes("FRONT")
  );
  const insideCamInfo: CameraStatusInfo | undefined = status?.cameras?.find(
    (c) => c.camera_type === "INSIDE" || c.camera_id.includes("INSIDE")
  );

  const frontFps = frontCamInfo?.fps ?? status?.fps ?? 10.0;
  const insideFps = insideCamInfo?.fps ?? 10.0;

  return (
    <div className="p-6 space-y-6">
      {/* Top Header & Telemetry Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="text-2xl font-bold tracking-tight text-white">BUS-001 LIVE AI COMMAND CENTER</h1>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            Dual-Camera Edge Sensing: Front Road Infrastructure (Live) &amp; Inside Cabin Passenger Analytics (Recorded Demo)
          </p>
        </div>

        {/* Global Telemetry Chips */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {/* Front Cam Live Badge */}
          <span className="flex items-center gap-1.5 font-medium px-2.5 py-1 rounded bg-gray-900 border border-emerald-500/30 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            FRONT: LIVE ({frontFps.toFixed(1)} FPS)
          </span>

          {/* Inside Cam Demo Badge */}
          <span className="flex items-center gap-1.5 font-medium px-2.5 py-1 rounded bg-gray-900 border border-amber-500/30 text-amber-300">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            CABIN: RECORDED DEMO ({insideFps.toFixed(1)} FPS)
          </span>

          <span className="text-cyan-400 bg-gray-900 px-2.5 py-1 rounded border border-gray-800">
            AI: REAL (YOLOv8n)
          </span>
          <span className="text-gray-300 bg-gray-900 px-2.5 py-1 rounded border border-gray-800">
            GPS: SIMULATED
          </span>
        </div>
      </div>

      {/* Camera Selector Tabs */}
      <div className="flex items-center justify-between border-b border-gray-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mr-2">CAMERA VIEW:</span>
          <button
            id="btn-dual-view"
            type="button"
            onClick={() => setViewMode("dual")}
            className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer transition-all ${
              viewMode === "dual"
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 shadow-sm"
                : "bg-gray-900 text-gray-400 border border-gray-800 hover:text-white"
            }`}
          >
            ⊞ DUAL VIEW MATRIX
          </button>
          <button
            id="btn-front-view"
            type="button"
            onClick={() => setViewMode("front")}
            className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer transition-all ${
              viewMode === "front"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-sm"
                : "bg-gray-900 text-gray-400 border border-gray-800 hover:text-white"
            }`}
          >
            🚗 FRONT / OUTSIDE ROAD
          </button>
          <button
            id="btn-inside-view"
            type="button"
            onClick={() => setViewMode("inside")}
            className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer transition-all ${
              viewMode === "inside"
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/50 shadow-sm"
                : "bg-gray-900 text-gray-400 border border-gray-800 hover:text-white"
            }`}
          >
            👥 INSIDE / CABIN CAMERA
          </button>
        </div>

        <div className="text-[11px] text-gray-500 font-mono">
          BUS_ID: <span className="text-gray-300 font-semibold">{status?.bus_id || "BUS-001"}</span>
        </div>
      </div>

      {/* Video Feeds Grid */}
      <div className={`grid gap-4 ${viewMode === "dual" ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
        {/* CAMERA 1: FRONT ROAD CAMERA */}
        {(viewMode === "dual" || viewMode === "front") && (
          <Card className="overflow-hidden border-gray-800 bg-gray-950/80">
            <CardHeader className="bg-gray-900/60 border-b border-gray-800 py-2.5 px-4">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-bold text-white tracking-wide">BUS-001-CAM-FRONT</span>
                  <Badge text="OUTSIDE ROAD" variant="info" />
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    ● LIVE
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-gray-400 font-mono">
                  <span>YouTube Live Stream</span>
                  <span className="text-emerald-400 font-bold">{frontFps.toFixed(1)} FPS</span>
                </div>
              </div>
            </CardHeader>

            <div className="bg-black aspect-video relative overflow-hidden flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={frontStreamUrl}
                alt="Front Road Camera AI Stream"
                className="w-full h-full object-contain"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = "none";
                }}
              />

              {/* HUD Top-Left Badge */}
              <div className="absolute top-3 left-3 bg-black/85 backdrop-blur-md border border-emerald-500/40 px-3 py-1.5 rounded text-[10px] text-gray-200 space-y-0.5 shadow-xl pointer-events-none">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  <span className="font-bold text-white">SOURCE: YouTube Live</span>
                </div>
                <div className="text-gray-300">
                  BUS: <span className="text-cyan-300 font-mono">BUS-001</span> | CAM: <span className="text-cyan-300">FRONT / OUTSIDE</span>
                </div>
                <div className="text-emerald-400">
                  AI: REAL (YOLOv8n) | GPS: SIMULATED | <span className="text-emerald-300 font-bold">MODE: LIVE</span>
                </div>
              </div>

              {/* HUD Top-Right Telemetry Badge */}
              <div className="absolute top-3 right-3 bg-black/85 backdrop-blur-md border border-cyan-500/40 px-3 py-1.5 rounded text-[10px] text-right text-gray-200 space-y-0.5 shadow-xl pointer-events-none">
                <div className="text-cyan-300 font-mono font-bold">INFERENCE: 10.0 FPS</div>
                <div className="text-emerald-400 font-mono font-bold">STREAM: {frontFps.toFixed(1)} FPS</div>
                <div className="text-gray-400 text-[9px]">TRACKS: {frontCamInfo?.unique_tracks || 0} ACTIVE</div>
              </div>
            </div>

            {/* Front Camera Live Stats Bar */}
            <div className="p-3 bg-gray-900/40 border-t border-gray-800 grid grid-cols-6 gap-2 text-center text-[10px]">
              {[
                { label: "Cars", key: "car", color: "text-emerald-400" },
                { label: "Motorcycles", key: "motorcycle", color: "text-yellow-400" },
                { label: "Buses", key: "bus", color: "text-purple-400" },
                { label: "Trucks", key: "truck", color: "text-orange-400" },
                { label: "Bicycles", key: "bicycle", color: "text-pink-400" },
                { label: "Pedestrians", key: "person", color: "text-cyan-400" },
              ].map(({ label, key, color }) => (
                <div key={key} className="p-1.5 rounded bg-gray-900/80 border border-gray-800/80">
                  <div className="text-gray-400 text-[9px] truncate">{label}</div>
                  <div className={`font-mono font-bold text-sm ${color}`}>{frontCounts[key] || 0}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* CAMERA 2: INSIDE CABIN CAMERA */}
        {(viewMode === "dual" || viewMode === "inside") && (
          <Card className="overflow-hidden border-gray-800 bg-gray-950/80">
            <CardHeader className="bg-gray-900/60 border-b border-gray-800 py-2.5 px-4">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-xs font-bold text-white tracking-wide">BUS-001-CAM-INSIDE</span>
                  <Badge text="CABIN / INSIDE" variant="default" />
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    RECORDED DEMO
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-gray-400 font-mono">
                  <span>YouTube Video</span>
                  <span className="text-amber-300 font-bold">{insideFps.toFixed(1)} FPS</span>
                </div>
              </div>
            </CardHeader>

            <div className="bg-black aspect-video relative overflow-hidden flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={insideStreamUrl}
                alt="Inside Cabin Camera AI Stream"
                className="w-full h-full object-contain"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = "none";
                }}
              />

              {/* HUD Top-Left Badge */}
              <div className="absolute top-3 left-3 bg-black/85 backdrop-blur-md border border-amber-500/40 px-3 py-1.5 rounded text-[10px] text-gray-200 space-y-0.5 shadow-xl pointer-events-none">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span className="font-bold text-white">SOURCE: YouTube Video</span>
                </div>
                <div className="text-gray-300">
                  BUS: <span className="text-cyan-300 font-mono">BUS-001</span> | CAM: <span className="text-cyan-300">INSIDE / CABIN</span>
                </div>
                <div className="text-amber-300">
                  AI: REAL (YOLOv8n) | GPS: N/A | <span className="font-bold">MODE: RECORDED DEMO</span>
                </div>
              </div>

              {/* HUD Top-Right Telemetry Badge */}
              <div className="absolute top-3 right-3 bg-black/85 backdrop-blur-md border border-purple-500/40 px-3 py-1.5 rounded text-[10px] text-right text-gray-200 space-y-0.5 shadow-xl pointer-events-none">
                <div className="text-cyan-300 font-mono font-bold">INFERENCE: 10.0 FPS</div>
                <div className="text-amber-300 font-mono font-bold">STREAM: {insideFps.toFixed(1)} FPS</div>
                <div className="text-gray-400 text-[9px]">PASSENGERS: {insidePassengerCount} ACTIVE</div>
              </div>
            </div>

            {/* Inside Camera Cabin Stats Bar */}
            <div className="p-3 bg-gray-900/40 border-t border-gray-800 grid grid-cols-3 gap-2 text-center text-[10px]">
              <div className="p-1.5 rounded bg-gray-900/80 border border-gray-800/80">
                <div className="text-gray-400 text-[9px]">Active Passengers</div>
                <div className="font-mono font-bold text-sm text-purple-400">{insidePassengerCount}</div>
              </div>
              <div className="p-1.5 rounded bg-gray-900/80 border border-gray-800/80">
                <div className="text-gray-400 text-[9px]">Cabin Occupancy</div>
                <div className="font-mono font-bold text-sm text-amber-300">
                  {insidePassengerCount > 0 ? "OCCUPIED" : "VACANT"}
                </div>
              </div>
              <div className="p-1.5 rounded bg-gray-900/80 border border-gray-800/80">
                <div className="text-gray-400 text-[9px]">Unique Tracks</div>
                <div className="font-mono font-bold text-sm text-cyan-400">{insideCamInfo?.unique_tracks || 0}</div>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Detection Feed & Live Analytics Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Real-time AI Detection Stream Table */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-xs font-semibold text-white">UNIFIED AI DETECTION FEED</span>
                </div>
                <span className="text-[10px] text-gray-500 font-mono">Real-time WebSocket stream (/ws/events)</span>
              </div>
            </CardHeader>

            <div className="p-3 max-h-[300px] overflow-y-auto space-y-2">
              {events.length === 0 && (
                <div className="text-xs text-gray-500 text-center py-6">
                  Listening for real-time detections and defect events from bus cameras...
                </div>
              )}
              {events.map((e, i) => {
                const meta = e.metadata || e.metadata_json || {};
                const camId = e.camera_id || String(meta.camera_id || "BUS-001-CAM-FRONT");
                const isFront = camId.includes("FRONT") || String(meta.camera_type).toUpperCase() === "OUTSIDE";
                const trackId = e.track_id ? `#${e.track_id}` : meta.track_id ? `#${meta.track_id}` : "";
                const conf = e.confidence
                  ? `${(e.confidence * 100).toFixed(0)}%`
                  : meta.confidence
                  ? `${(Number(meta.confidence) * 100).toFixed(0)}%`
                  : "";
                const timeStr = e.created_at
                  ? new Date(e.created_at).toLocaleTimeString()
                  : new Date().toLocaleTimeString();
                const severity = e.severity || "MEDIUM";

                return (
                  <div
                    key={i}
                    className="p-2.5 bg-gray-900/80 rounded border-l-4 flex items-center justify-between text-xs transition-all hover:bg-gray-900"
                    style={{
                      borderLeftColor:
                        severity === "CRITICAL"
                          ? "#ef4444"
                          : severity === "HIGH"
                          ? "#f97316"
                          : severity === "MEDIUM"
                          ? "#eab308"
                          : "#3b82f6",
                    }}
                  >
                    <div className="flex items-center gap-3">
                      {/* Camera Badge */}
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          isFront
                            ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                            : "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                        }`}
                      >
                        {isFront ? "FRONT CAM" : "CABIN CAM"}
                      </span>

                      {/* Event Class / Track */}
                      <div>
                        <span className="font-semibold text-white uppercase">
                          {e.class_name || e.event_type || e.type} {trackId}
                        </span>
                        <div className="text-[10px] text-gray-400">
                          {e.event_id || "DETECTION"}
                          {e.evidence_url && (
                            <span className="ml-2 text-emerald-400 underline">📸 Snapshot Attached</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right font-mono text-[10px] space-y-0.5">
                      <div className="text-gray-400">{timeStr}</div>
                      <div className="text-emerald-400 font-bold">{conf && `Conf: ${conf}`}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Edge AI Health & Multi-Camera Summary */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <span className="text-xs font-semibold text-white">CAMERA SYSTEM STATUS</span>
                <Badge text="HEALTHY" variant="success" />
              </div>
            </CardHeader>
            <div className="p-3 space-y-3 text-xs">
              <div className="p-2.5 rounded bg-gray-900/60 border border-gray-800 space-y-1">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-gray-300 font-medium">Front Road Camera</span>
                  <span className="text-emerald-400 font-bold text-[10px]">CONNECTED</span>
                </div>
                <div className="text-[10px] text-gray-400">
                  Target: Road Defect &amp; Vehicle Analytics (YOLO + ByteTrack)
                </div>
                <div className="flex justify-between text-[10px] text-gray-500 font-mono pt-1">
                  <span>Stream FPS: {frontFps.toFixed(1)}</span>
                  <span>Tracks: {frontCamInfo?.unique_tracks || 0}</span>
                </div>
              </div>

              <div className="p-2.5 rounded bg-gray-900/60 border border-gray-800 space-y-1">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-gray-300 font-medium">Inside Cabin Camera</span>
                  <span className="text-amber-300 font-bold text-[10px]">CONNECTED</span>
                </div>
                <div className="text-[10px] text-gray-400">
                  Target: Passenger &amp; Cabin Monitoring (YOLO + Looped Replay)
                </div>
                <div className="flex justify-between text-[10px] text-gray-500 font-mono pt-1">
                  <span>Stream FPS: {insideFps.toFixed(1)}</span>
                  <span>Passengers: {insidePassengerCount}</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
