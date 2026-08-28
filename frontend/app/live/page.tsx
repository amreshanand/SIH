"use client";

import { useEffect, useState, useMemo } from "react";
import { api } from "@/lib/api";
import { Card, CardHeader, Badge } from "@/components/ui/Card";
import { useWebSocket } from "@/hooks/useWebSocket";


interface StreamStatus {
  running: boolean;
  source: string;
  youtube_live_url?: string;
  bus_id: string;
  camera: string;
  fps: number;
  ai_mode?: string;
  gps_mode?: string;
  vehicle_counts?: Record<string, number>;
  unique_tracks?: number;
}

interface LiveDetEvent {
  type?: string;
  event_type?: string;
  event_id?: string;
  severity?: string;
  confidence?: number;
  timestamp?: number | string;
  created_at?: string;
  metadata?: Record<string, unknown>;
  metadata_json?: Record<string, unknown>;
}

export default function LivePage() {
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [streamCounts, setStreamCounts] = useState<Record<string, number>>({
    car: 0,
    motorcycle: 0,
    bus: 0,
    truck: 0,
    bicycle: 0,
    person: 0,
  });

  const { messages } = useWebSocket("events");
  const events = useMemo<LiveDetEvent[]>(() => messages.slice(0, 15) as LiveDetEvent[], [messages]);

  useEffect(() => {
    const fetchStatus = () => {
      api.getStreamStatus().then((st) => {
        const fullStatus = st as StreamStatus;
        setStatus(fullStatus);
        if (fullStatus.vehicle_counts) {
          setStreamCounts((prev) => ({ ...prev, ...fullStatus.vehicle_counts }));
        }
      }).catch(() => {});
    };

    fetchStatus();
    api.getTraffic().then((res) => {
      if (res.traffic && res.traffic.length > 0) {
        const latest = res.traffic[0] as unknown as { vehicle_distribution?: Record<string, number> };
        if (latest.vehicle_distribution) {
          setStreamCounts((prev) => ({ ...prev, ...latest.vehicle_distribution }));
        }
      }
    }).catch(() => {});

    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const streamUrl = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/stream/camera`;
  const isYouTube = status?.source === "youtube";
  const sourceName = isYouTube ? "YouTube Live" : status?.source ? status.source.toUpperCase() : "YOUTUBE";
  const gpsLabel = status?.gps_mode === "phone" ? "PHONE" : "SIMULATED";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Live Fleet AI Monitoring</h1>
          <p className="text-sm text-gray-500">Real-time YouTube live stream ingested through YOLOv8 object detector & ByteTrack</p>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1.5 font-medium px-2.5 py-1 rounded bg-gray-900 border border-gray-800">
            <span className={`w-2 h-2 rounded-full ${status?.running ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
            {status?.running ? "STREAM LIVE" : "CONNECTING"}
          </span>
          <span className="text-gray-300 bg-gray-900 px-2.5 py-1 rounded border border-gray-800">FPS: {status?.fps?.toFixed(1) || "10.0"}</span>
          <span className="text-cyan-400 bg-gray-900 px-2.5 py-1 rounded border border-gray-800">Source: {sourceName}</span>
          <span className="text-amber-400 bg-gray-900 px-2.5 py-1 rounded border border-gray-800">GPS: {gpsLabel}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Card className="overflow-hidden">
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${status?.running ? "bg-emerald-500 animate-pulse" : "bg-gray-600"}`} />
                  <span className="text-sm font-semibold text-white">{status?.bus_id || "BUS-001"}</span>
                  <Badge text={status?.camera || "FRONT"} variant="default" />
                  <Badge text="YOLOv8n" variant="info" />
                  {status?.running ? <Badge text="AI OVERLAY ACTIVE" variant="success" /> : <Badge text="STANDBY" variant="warning" />}
                </div>
                <span className="text-[10px] text-gray-400 font-mono">
                  {status?.youtube_live_url ? "YouTube Live Stream" : "Front Camera Feed"}
                </span>
              </div>
            </CardHeader>
            <div className="bg-black aspect-video relative overflow-hidden flex items-center justify-center">
              {status?.running ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={streamUrl} alt="Live AI Camera Feed" className="w-full h-full object-contain" />
                  
                  {/* HUD Top-Left Badge */}
                  <div className="absolute top-3 left-3 bg-black/85 backdrop-blur-md border border-emerald-500/40 px-3 py-2 rounded text-[10px] text-gray-200 space-y-0.5 shadow-xl">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                      <span className="font-semibold text-white">SOURCE: {sourceName}</span>
                    </div>
                    <div className="text-gray-300">BUS: <span className="text-cyan-300 font-mono">{status?.bus_id || "BUS-001"}</span> | CAM: <span className="text-cyan-300">{status?.camera || "FRONT"}</span></div>
                    <div className="text-emerald-400">AI: REAL (YOLOv8n) | GPS: {gpsLabel}</div>
                  </div>

                  {/* HUD Top-Right Telemetry Badge */}
                  <div className="absolute top-3 right-3 bg-black/85 backdrop-blur-md border border-cyan-500/40 px-3 py-2 rounded text-[10px] text-right text-gray-200 space-y-0.5 shadow-xl">
                    <div className="text-cyan-300 font-mono font-bold">INFERENCE: 10.0 FPS</div>
                    <div className="text-emerald-400 font-mono">STREAM: {status?.fps?.toFixed(1) || "10.0"} FPS</div>
                    <div className="text-gray-400 text-[9px]">TRACKS: {status?.unique_tracks || 0} TOTAL</div>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <div className="text-center p-6">
                    <div className="text-4xl mb-3 animate-bounce">📡</div>
                    <p className="text-sm font-medium text-white">Connecting to Live Video Stream...</p>
                    <p className="text-xs text-gray-400 mt-1">Resolving YouTube live HLS manifest</p>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <span className="text-xs font-semibold text-white">Live Vehicle Tracking</span>
                <span className="text-[10px] text-emerald-400 font-mono">Actual Counts</span>
              </div>
            </CardHeader>
            <div className="p-3 grid grid-cols-2 gap-2 text-[11px]">
              {[
                { label: "Cars", key: "car" },
                { label: "Motorcycles", key: "motorcycle" },
                { label: "Buses", key: "bus" },
                { label: "Trucks", key: "truck" },
                { label: "Bicycles", key: "bicycle" },
                { label: "People", key: "person" },
              ].map(({ label, key }) => (
                <div key={key} className="flex justify-between items-center p-2 rounded bg-gray-900/70 border border-gray-800">
                  <span className="text-gray-400">{label}</span>
                  <span className="text-cyan-400 font-mono font-bold text-sm">{streamCounts[key] || 0}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <span className="text-xs font-semibold text-white">AI Detection Feed</span>
                <span className="text-[10px] text-gray-500">Live stream events</span>
              </div>
            </CardHeader>
            <div className="p-3 max-h-[220px] overflow-y-auto space-y-1.5">
              {events.length === 0 && (
                <div className="text-[10px] text-gray-500 text-center py-4">Ingesting live detections from video stream...</div>
              )}
              {events.map((e, i) => {
                const meta = e.metadata || e.metadata_json || {};
                const trackId = meta.track_id ? `#${meta.track_id}` : "";
                const conf = e.confidence ? `${(e.confidence * 100).toFixed(0)}%` : meta.confidence ? `${(Number(meta.confidence) * 100).toFixed(0)}%` : "";
                const timeStr = e.created_at ? new Date(e.created_at).toLocaleTimeString() : new Date().toLocaleTimeString();

                return (
                  <div key={i} className="p-2 bg-gray-900/70 rounded border-l-2 text-[10px]" style={{borderLeftColor: e.severity === "CRITICAL" ? "#ef4444" : e.severity === "HIGH" ? "#f97316" : "#eab308"}}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white uppercase">{e.type || e.event_type} {trackId}</span>
                      <span className="text-[9px] text-gray-500 font-mono">{timeStr}</span>
                    </div>
                    <div className="flex items-center justify-between text-[9px] text-gray-400 mt-0.5">
                      <span>{e.event_id || "DET-LIVE"}</span>
                      <span className="text-emerald-400 font-mono">{conf && `Conf: ${conf}`}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {["REAR", "LEFT", "RIGHT", "CABIN"].map((cam) => (
          <Card key={cam}>
            <CardHeader>
              <span className="text-[10px] font-semibold text-gray-400">{cam} CAMERA</span>
              <Badge text="STANDBY" variant="default" />
            </CardHeader>
            <div className="bg-gray-900/80 aspect-video flex items-center justify-center border border-gray-800 rounded">
              <span className="text-[10px] text-gray-500">Multi-Angle Standby</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}


