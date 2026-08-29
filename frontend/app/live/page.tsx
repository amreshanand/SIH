"use client";

import { useEffect, useState, useMemo } from "react";
import { api } from "@/lib/api";
import { Card, CardHeader, Badge } from "@/components/ui/Card";
import { useWebSocket } from "@/hooks/useWebSocket";

import { StreamStatus, CameraStatusInfo } from "@/types";

import { getYouTubeEmbedUrl } from "@/lib/youtube";
import Link from "next/link";


interface StreamStatus {
  running: boolean;
  source: string;
  youtube_live_url?: string;
  youtube_rear_url?: string;
  youtube_left_url?: string;
  youtube_right_url?: string;
  youtube_cabin_url?: string;
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
  issue_id?: string;
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

  // Live issue detection alert overlay state
  const ROAD_ISSUE_TYPES = new Set(["POTHOLE", "ROAD_CRACK", "DAMAGED_ROAD", "WATERLOGGING", "MISSING_SIGN", "DAMAGED_SIGN", "MISSING_CROSSING", "MISSING_DIVIDER", "STREET_LIGHT"]);
  const [liveAlert, setLiveAlert] = useState<LiveDetEvent | null>(null);
  const [alertVisible, setAlertVisible] = useState(false);

  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);

  // Drive the alert overlay from the websocket subscription callback (the
  // external-system boundary) instead of a synchronous effect on message state.
  const { messages } = useWebSocket("events", (latest) => {
    const type = latest.type || "";

    if (type === "new_event") {
      const eventType = str(latest.event_type) || "";
      if (ROAD_ISSUE_TYPES.has(eventType.toUpperCase())) {
        setLiveAlert({
          type: eventType,
          event_type: eventType,
          event_id: str(latest.event_id),
          severity: str(latest.severity),
          confidence: num(latest.confidence),
          metadata: {
            latitude: num(latest.latitude),
            longitude: num(latest.longitude),
          },
        });
        setAlertVisible(true);
      }
    } else if (type === "issue_updated" || type === "new_issue") {
      // If we have an active alert, attach the issue_id to it so the user can click to view it
      const issueId = str(latest.issue_id);
      setLiveAlert((prev) => {
        if (prev && !prev.issue_id && issueId) {
          return { ...prev, issue_id: issueId };
        }
        return prev;
      });
    }
  });
  const events = useMemo<LiveDetEvent[]>(() => messages.slice(0, 15) as LiveDetEvent[], [messages]);

  // Auto-close the live detection alert overlay after 8 seconds (gives user ample time to click redirect)
  useEffect(() => {
    if (alertVisible) {
      const timer = setTimeout(() => setAlertVisible(false), 8000);
      return () => clearTimeout(timer);
    }
  }, [alertVisible]);

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

  const isYouTube = Boolean(status?.youtube_live_url);
  const sourceName = isYouTube ? "YouTube Live" : status?.source ? status.source.toUpperCase() : "YOUTUBE";
  const gpsLabel = status?.gps_mode === "phone" ? "PHONE" : "SIMULATED";


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

              {status?.running && status.youtube_live_url ? (
                <>
                  {/* FRONT cam: slight zoom to remove letterbox, slight bottom crop to show road clearly */}
                  <iframe
                    className="w-full h-full object-cover"
                    style={{ transform: "scale(1.12) translateY(4%)", transformOrigin: "center bottom", filter: "contrast(1.08) saturate(1.1)" }}
                    src={getYouTubeEmbedUrl(status.youtube_live_url)}
                    title="YouTube video player"
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  ></iframe>
                  
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

                  {/* ═══════ LIVE ROAD ISSUE DETECTION OVERLAY ═══════ */}
                  {alertVisible && liveAlert && (() => {
                    const issueType = (liveAlert.type || liveAlert.event_type || "DEFECT").toUpperCase().replace(/_/g, " ");
                    const sev = liveAlert.severity || "MEDIUM";
                    const conf = liveAlert.confidence ? `${(liveAlert.confidence * 100).toFixed(0)}%` : "—";
                    const meta = liveAlert.metadata || liveAlert.metadata_json || {};
                    const lat = typeof meta.latitude === "number" ? (meta.latitude as number).toFixed(5) : "18.5299";
                    const lon = typeof meta.longitude === "number" ? (meta.longitude as number).toFixed(5) : "73.8629";
                    const sevColor = sev === "CRITICAL" ? "border-red-500 bg-red-500/15" : sev === "HIGH" ? "border-orange-500 bg-orange-500/12" : "border-yellow-500 bg-yellow-500/10";
                    const sevTextColor = sev === "CRITICAL" ? "text-red-400" : sev === "HIGH" ? "text-orange-400" : "text-yellow-400";
                    const sevGlow = sev === "CRITICAL" ? "shadow-[0_0_30px_rgba(239,68,68,0.4)]" : sev === "HIGH" ? "shadow-[0_0_25px_rgba(249,115,22,0.35)]" : "shadow-[0_0_20px_rgba(234,179,8,0.3)]";
                    return (
                      <>
                        {/* Full-screen red flash overlay */}
                        <div className="absolute inset-0 pointer-events-none animate-pulse" style={{ background: sev === "CRITICAL" ? "rgba(220,38,38,0.08)" : sev === "HIGH" ? "rgba(249,115,22,0.06)" : "rgba(234,179,8,0.04)", animation: "pulse 1s ease-in-out 2" }} />

                        {/* Bounding box style detection rectangle — center-bottom of video */}
                        <div className={`absolute bottom-16 left-1/2 -translate-x-1/2 w-[55%] border-2 ${sevColor} rounded-lg ${sevGlow} backdrop-blur-sm transition-all duration-300`}>
                          {/* Top bar: issue type + severity */}
                          <div className={`flex items-center justify-between px-3 py-1.5 border-b ${sev === "CRITICAL" ? "border-red-500/30" : sev === "HIGH" ? "border-orange-500/30" : "border-yellow-500/30"}`}>
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                              <span className={`text-xs font-bold ${sevTextColor} uppercase tracking-wider`}>⚠ {issueType} DETECTED</span>
                            </div>
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${sev === "CRITICAL" ? "bg-red-600 text-white" : sev === "HIGH" ? "bg-orange-600 text-white" : "bg-yellow-600 text-black"}`}>{sev}</span>
                          </div>

                          {/* Body: details */}
                          <div className="px-3 py-2 grid grid-cols-3 gap-2 text-[9px]">
                            <div>
                              <div className="text-gray-500 uppercase tracking-wider mb-0.5">Confidence</div>
                              <div className="text-emerald-400 font-mono font-bold text-sm">{conf}</div>
                            </div>
                            <div>
                              <div className="text-gray-500 uppercase tracking-wider mb-0.5">Location</div>
                              <div className="text-cyan-400 font-mono">{lat}°N</div>
                              <div className="text-cyan-400 font-mono">{lon}°E</div>
                            </div>
                            <div>
                              <div className="text-gray-500 uppercase tracking-wider mb-0.5">Action</div>
                              <div className={`${sevTextColor} font-medium`}>Registering Issue</div>
                              <div className="text-gray-500 font-mono text-[8px]">{liveAlert.event_id || "EVT-LIVE"}</div>
                            </div>
                          </div>

                          {/* Link to actual registered issue */}
                          <div className="p-2 bg-black/60 flex items-center justify-center border-t border-gray-800/60">
                            <Link
                              href={liveAlert.issue_id ? `/issues/${liveAlert.issue_id}` : `/issues`}
                              className="w-full py-2 bg-cyan-600/30 hover:bg-cyan-500/50 border border-cyan-400/50 text-cyan-200 rounded text-center text-[10px] font-bold tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-lg"
                            >
                              <span>⚡ VIEW DETECTED ISSUE {liveAlert.issue_id ? `(${liveAlert.issue_id})` : "DETAILS"}</span>
                              <span>→</span>
                            </Link>
                          </div>
                        </div>

                        {/* Top-center alert banner — Clickable Redirect */}
                        <Link
                          href={liveAlert.issue_id ? `/issues/${liveAlert.issue_id}` : `/issues`}
                          className={`absolute top-14 left-1/2 -translate-x-1/2 ${sev === "CRITICAL" ? "bg-red-600/95 hover:bg-red-500" : sev === "HIGH" ? "bg-orange-600/95 hover:bg-orange-500" : "bg-yellow-600/95 hover:bg-yellow-500"} backdrop-blur-md px-5 py-2 rounded-full text-[11px] text-white font-bold tracking-wider ${sevGlow} flex items-center gap-2 transition-all transform hover:scale-105 cursor-pointer shadow-2xl border border-white/20`}
                        >
                          <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                          <span>ROAD ISSUE DETECTED — {issueType}</span>
                          <span className="bg-black/30 px-2 py-0.5 rounded text-[9px] text-cyan-200">OPEN ISSUE →</span>
                        </Link>
                      </>
                    );
                  })()}
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <div className="text-center p-6">
                    <div className="text-4xl mb-3 animate-bounce">📡</div>
                    <p className="text-sm font-medium text-white">Connecting to Live Video Stream...</p>
                    <p className="text-xs text-gray-400 mt-1">Resolving YouTube live HLS manifest</p>
                  </div>
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
      <div className="grid grid-cols-4 gap-4">
        {[
          { key: "REAR", name: "REAR", url: status?.youtube_rear_url },
          { key: "LEFT", name: "LEFT", url: status?.youtube_left_url },
          { key: "RIGHT", name: "RIGHT", url: status?.youtube_right_url },
          { key: "CABIN", name: "CABIN", url: status?.youtube_cabin_url },
        ].map((cam) => {
          const isCamActive = status?.running && cam.url;
          return (
            <Card key={cam.key} className="overflow-hidden">
              <CardHeader>
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] font-semibold text-gray-400">{cam.name} CAMERA</span>
                  {isCamActive ? (
                    <Badge text="LIVE FEED" variant="success" />
                  ) : (
                    <Badge text="STANDBY" variant="default" />
                  )}
                </div>
              </CardHeader>
              <div className="bg-black aspect-video relative overflow-hidden flex items-center justify-center">
                {isCamActive ? (
                  <>
                    {/* ─── REAR CAM: zoomed wide + flipped horizontal mirror view ─── */}
                    {cam.key === "REAR" && (
                      <iframe
                        className="w-full h-full"
                        style={{
                          transform: "scaleX(-1) scale(1.08)",
                          transformOrigin: "center center",
                          filter: "brightness(0.9) contrast(1.1)",
                        }}
                        src={getYouTubeEmbedUrl(cam.url!, 120)}
                        title="REAR camera view"
                        frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen
                      />
                    )}

                    {/* ─── LEFT CAM: shifted roadside perspective ─── */}
                    {cam.key === "LEFT" && (
                      <iframe
                        className="w-full h-full"
                        style={{
                          transform: "scale(1.15) translateX(-8%)",
                          transformOrigin: "left center",
                          filter: "brightness(0.92) contrast(1.08)",
                        }}
                        src={getYouTubeEmbedUrl(cam.url!, 120)}
                        title="LEFT camera view"
                        frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen
                      />
                    )}

                    {/* ─── RIGHT CAM: shifted right roadside perspective ─── */}
                    {cam.key === "RIGHT" && (
                      <iframe
                        className="w-full h-full"
                        style={{
                          transform: "scale(1.15) translateX(8%)",
                          transformOrigin: "right center",
                          filter: "brightness(0.92) contrast(1.08)",
                        }}
                        src={getYouTubeEmbedUrl(cam.url!, 90)}
                        title="RIGHT camera view"
                        frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen
                      />
                    )}

                    {/* ─── CABIN CAM: wide-angle dome view ─── */}
                    {cam.key === "CABIN" && (
                      <iframe
                        className="w-full h-full"
                        style={{
                          transform: "scale(1.12)",
                          transformOrigin: "center top",
                          filter: "grayscale(40%) sepia(20%) hue-rotate(90deg) brightness(0.88)",
                        }}
                        src={getYouTubeEmbedUrl(cam.url!, 90)}
                        title="CABIN camera view"
                        frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen
                      />
                    )}

                    {/* ─── REAR overlay: distance guide lines + label ─── */}
                    {cam.key === "REAR" && (
                      <div className="absolute inset-0 pointer-events-none">
                        {/* curved distance lines */}
                        <div className="absolute bottom-[25%] left-[15%] right-[15%] h-px bg-orange-400/25" />
                        <div className="absolute bottom-[45%] left-[25%] right-[25%] h-px bg-orange-400/15" />
                        <div className="absolute bottom-[65%] left-[35%] right-[35%] h-px bg-orange-400/10" />
                        {/* converging vertical guides */}
                        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_40%,rgba(255,100,0,0.04)_100%)]" />
                        <div className="absolute top-2 left-2 bg-black/80 backdrop-blur px-2 py-1 rounded text-[8px] text-orange-300 font-mono border border-orange-500/25 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" /> REAR VIEW
                        </div>
                        <div className="absolute bottom-2 right-2 bg-black/80 px-1.5 py-0.5 rounded text-[8px] text-gray-400 font-mono border border-gray-700">CAM-02</div>
                      </div>
                    )}

                    {/* ─── LEFT overlay: door mirror frame + blindspot arc ─── */}
                    {cam.key === "LEFT" && (
                      <div className="absolute inset-0 pointer-events-none">
                        {/* mirror frame arc top-left */}
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_left_center,transparent_55%,rgba(0,0,0,0.45)_100%)]" />
                        <div className="absolute top-2 left-2 bg-black/80 backdrop-blur px-2 py-1 rounded text-[8px] text-yellow-300 font-mono border border-yellow-500/25 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" /> LEFT SIDE
                        </div>
                        <div className="absolute bottom-2 left-2 bg-black/80 px-1.5 py-0.5 rounded text-[8px] text-yellow-400 font-mono border border-yellow-500/20">⚠ BLIND ZONE</div>
                        <div className="absolute bottom-2 right-2 bg-black/80 px-1.5 py-0.5 rounded text-[8px] text-gray-400 font-mono border border-gray-700">CAM-03</div>
                      </div>
                    )}

                    {/* ─── RIGHT overlay: mirror frame + blindspot arc ─── */}
                    {cam.key === "RIGHT" && (
                      <div className="absolute inset-0 pointer-events-none">
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_right_center,transparent_55%,rgba(0,0,0,0.45)_100%)]" />
                        <div className="absolute top-2 right-2 bg-black/80 backdrop-blur px-2 py-1 rounded text-[8px] text-yellow-300 font-mono border border-yellow-500/25 flex items-center gap-1">
                          RIGHT SIDE <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                        </div>
                        <div className="absolute bottom-2 right-2 bg-black/80 px-1.5 py-0.5 rounded text-[8px] text-yellow-400 font-mono border border-yellow-500/20">BLIND ZONE ⚠</div>
                        <div className="absolute bottom-2 left-2 bg-black/80 px-1.5 py-0.5 rounded text-[8px] text-gray-400 font-mono border border-gray-700">CAM-04</div>
                      </div>
                    )}

                    {/* ─── CABIN overlay: CCTV scanlines + REC badge ─── */}
                    {cam.key === "CABIN" && (
                      <div className="absolute inset-0 pointer-events-none">
                        {/* CRT scanline overlay */}
                        <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(0,255,100,0.03)_2px,rgba(0,255,100,0.03)_4px)]" />
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_50%,rgba(0,0,0,0.35)_100%)]" />
                        <div className="absolute top-2 left-2 bg-black/85 px-2 py-1 rounded text-[8px] text-emerald-400 font-mono border border-emerald-500/30 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> REC
                        </div>
                        <div className="absolute top-2 right-2 bg-black/85 px-2 py-1 rounded text-[8px] text-emerald-400 font-mono border border-emerald-500/30">CAM-05 CABIN</div>
                        <div className="absolute bottom-2 inset-x-2 flex justify-between">
                          <span className="bg-black/85 px-1.5 py-0.5 rounded text-[7px] text-emerald-400 font-mono border border-emerald-500/20">{new Date().toLocaleDateString()}</span>
                          <span className="bg-black/85 px-1.5 py-0.5 rounded text-[7px] text-emerald-400 font-mono border border-emerald-500/20 animate-pulse">CCTV SECURE</span>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <span className="text-[10px] text-gray-500 font-mono">Multi-Angle Standby</span>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
