"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { api } from "@/lib/api";
import { Card, CardHeader, Badge } from "@/components/ui/Card";
import { useWebSocket } from "@/hooks/useWebSocket";
import { getYouTubeEmbedUrl } from "@/lib/youtube";
import type { FleetBus, FleetStatus } from "@/types";

const CAM_STYLE: Record<string, CSSProperties> = {
  REAR: {
    transform: "scaleX(-1) scale(1.05) translateY(3%)",
    transformOrigin: "center center",
    filter: "brightness(0.82) contrast(1.2) saturate(0.85)",
  },
  LEFT: {
    transform: "scale(1.35) translateX(-18%) translateY(5%)",
    transformOrigin: "left center",
    filter: "brightness(0.88) contrast(1.1) saturate(1.05) hue-rotate(2deg)",
  },
  RIGHT: {
    transform: "scale(1.35) translateX(18%) translateY(5%)",
    transformOrigin: "right center",
    filter: "brightness(0.88) contrast(1.1) saturate(1.05) hue-rotate(-2deg)",
  },
  CABIN: {
    transform: "scale(1.25) translateY(8%)",
    transformOrigin: "center top",
    filter: "grayscale(60%) sepia(40%) hue-rotate(90deg) brightness(0.85) contrast(1.25)",
  },
};

const TILE_LABELS: Record<string, string> = {
  REAR: "REAR VIEW",
  LEFT: "LEFT SIDE",
  RIGHT: "RIGHT SIDE",
  CABIN: "CCTV CABIN",
};

const ALERT_TYPES = new Set([
  "POTHOLE",
  "ROAD_CRACK",
  "DAMAGED_ROAD",
  "WATERLOGGING",
  "MISSING_SIGN",
  "DAMAGED_SIGN",
  "MISSING_CROSSING",
  "MISSING_DIVIDER",
  "STREET_LIGHT",
  "RASH_DRIVING",
  "HIT_AND_RUN",
  "COLLISION",
]);

const VEHICLE_KEYS = [
  { label: "Cars", key: "car" },
  { label: "Motorcycles", key: "motorcycle" },
  { label: "Buses", key: "bus" },
  { label: "Trucks", key: "truck" },
  { label: "Bicycles", key: "bicycle" },
  { label: "People", key: "person" },
];

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

function CameraFrame({ bus, camera }: { bus: FleetBus; camera: string }) {
  const cam = bus.cameras.find((c) => c.camera === camera);
  const active = Boolean(cam?.url);

  if (!cam || !active) {
    return (
      <div className="bg-black aspect-video relative overflow-hidden flex items-center justify-center">
        <div className="text-center p-4">
          <div className="text-2xl mb-1 opacity-60">🛰</div>
          <span className="text-[10px] text-gray-500 font-mono">FEED STANDBY — CAM OFFLINE</span>
        </div>
      </div>
    );
  }

  if (camera === "FRONT") {
    return (
      <div className="bg-black aspect-video relative overflow-hidden flex items-center justify-center">
        <iframe
          className="w-full h-full object-cover"
          style={{ transform: "scale(1.12) translateY(4%)", transformOrigin: "center bottom", filter: "contrast(1.08) saturate(1.1)" }}
          src={getYouTubeEmbedUrl(cam.url)}
          title={`${bus.bus_id} FRONT camera`}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
        <div className="absolute top-3 left-3 bg-black/85 backdrop-blur-md border border-emerald-500/40 px-3 py-2 rounded text-[10px] text-gray-200 space-y-0.5 shadow-xl pointer-events-none">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="font-semibold text-white">SOURCE: LINKED LIVE FEED</span>
          </div>
          <div className="text-gray-300">
            BUS: <span className="text-cyan-300 font-mono">{bus.bus_id}</span> | CAM: <span className="text-cyan-300">FRONT</span>
          </div>
          <div className="text-emerald-400">AI: {bus.ai_mode} | GPS: {bus.gps_mode}</div>
        </div>
        <div className="absolute top-3 right-3 bg-black/85 backdrop-blur-md border border-cyan-500/40 px-3 py-2 rounded text-[10px] text-right text-gray-200 space-y-0.5 shadow-xl pointer-events-none">
          <div className="text-emerald-400 font-mono">STREAM: {bus.fps.toFixed(1)} FPS</div>
          <div className="text-cyan-300 font-mono">{bus.latitude.toFixed(5)}°N</div>
          <div className="text-cyan-300 font-mono">{bus.longitude.toFixed(5)}°E</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-black aspect-video relative overflow-hidden flex items-center justify-center">
      <iframe
        className="w-full h-full"
        style={CAM_STYLE[camera]}
        src={getYouTubeEmbedUrl(cam.url)}
        title={`${bus.bus_id} ${camera} camera`}
        frameBorder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
      <div className="absolute top-2 left-2 bg-black/80 backdrop-blur px-2 py-1 rounded text-[8px] text-gray-200 font-mono border border-gray-700 flex items-center gap-1 pointer-events-none">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        {TILE_LABELS[camera] || camera}
      </div>
      <div className="absolute bottom-2 left-2 bg-black/80 px-1.5 py-0.5 rounded text-[8px] text-gray-400 font-mono border border-gray-700 pointer-events-none">
        CAM-{["FRONT", "REAR", "LEFT", "RIGHT", "CABIN"].indexOf(camera) + 1} · {bus.bus_id}
      </div>
    </div>
  );
}

export default function CommandCenterPage() {
  const [fleet, setFleet] = useState<FleetStatus | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [latestAlert, setLatestAlert] = useState<{ id?: string; type?: string; severity?: string; confidence?: number; at: string } | null>(null);
  const [alertVisible, setAlertVisible] = useState(false);
  const [polling, setPolling] = useState(true);

  const { messages } = useWebSocket("events", (latest) => {
    const type = latest.type || "";
    if ((type === "new_event" || type === "new_incident") && ALERT_TYPES.has(str(latest.event_type)?.toUpperCase() || "")) {
      setLatestAlert({
        id: str(latest.event_id),
        type: str(latest.event_type),
        severity: str(latest.severity),
        confidence: num(latest.confidence),
        at: new Date().toISOString(),
      });
      setAlertVisible(true);
      setPolling(true);
    }
  });

  useEffect(() => {
    if (alertVisible) {
      const timer = setTimeout(() => setAlertVisible(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [alertVisible]);

  useEffect(() => {
    const load = () => api.getFleet().then(setFleet).catch(() => {});
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const selected = useMemo(() => {
    if (!fleet || fleet.buses.length === 0) return null;
    if (selectedId && fleet.buses.some((b) => b.bus_id === selectedId)) {
      return fleet.buses.find((b) => b.bus_id === selectedId) || null;
    }
    return fleet.buses.find((b) => b.status === "LIVE") || fleet.buses[0];
  }, [fleet, selectedId]);

  const navActive = fleet ? `LIVE ${fleet.live_buses}/${fleet.total_buses}` : "—";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Fleet Camera Command Center</h1>
          <p className="text-sm text-gray-500">All buses as mobile sensing units — any camera, any bus, one console</p>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <Badge text={navActive} variant="info" />
          <Badge text={`${fleet?.cameras_online ?? 0} CAMS ONLINE`} variant="success" />
          <Badge text={polling ? "AUTO-POLLING · 5s" : "PAUSED"} variant={polling ? "online" : "warning"} />
        </div>
      </div>

      {!fleet && (
        <Card><div className="p-8 text-center text-gray-500 text-sm">Loading fleet…</div></Card>
      )}

      {fleet && fleet.buses.length > 0 && (
        <>
          {/* Fleet strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {fleet.buses.map((bus) => {
              const isSel = bus.bus_id === selected?.bus_id;
              const camOnline = bus.cameras.filter((c) => c.active).length;
              return (
                <button
                  key={bus.bus_id}
                  onClick={() => setSelectedId(bus.bus_id)}
                  className={`text-left p-3 rounded-lg border transition-all ${
                    isSel
                      ? "bg-cyan-500/10 border-cyan-500/50 shadow-[0_0_20px_rgba(34,211,238,0.15)]"
                      : "bg-gray-900 border-gray-800 hover:border-gray-600"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-bold ${isSel ? "text-cyan-300" : "text-white"}`}>{bus.bus_id}</span>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${
                      bus.status === "LIVE"
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse"
                        : "bg-gray-800 text-gray-500 border border-gray-700"
                    }`}>
                      {bus.status === "LIVE" ? "● LIVE" : "STANDBY"}
                    </span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1">{bus.route_name} · {bus.route_id}</div>
                  <div className="flex items-center justify-between mt-2 text-[10px]">
                    <span className="text-gray-400">
                      📹 {camOnline} cams · 🚨 {bus.incidents_today}
                    </span>
                    <span className="font-mono text-gray-500">
                      {bus.latitude.toFixed(3)}, {bus.longitude.toFixed(3)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {selected && (
            <>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <Card className="overflow-hidden">
                    <CardHeader>
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-3">
                          <span className={`w-2 h-2 rounded-full ${selected.status === "LIVE" ? "bg-emerald-500 animate-pulse" : "bg-gray-600"}`} />
                          <span className="text-sm font-semibold text-white">{selected.bus_id} — FRONT</span>
                          <Badge text={selected.status === "LIVE" ? "AI OVERLAY ACTIVE" : "FEED LINKED"} variant={selected.status === "LIVE" ? "success" : "default"} />
                          <Badge text={selected.ai_mode} variant="info" />
                        </div>
                        <span className="text-[10px] text-gray-400 font-mono">{selected.route_name}</span>
                      </div>
                    </CardHeader>
                    <div className="relative">
                      <CameraFrame bus={selected} camera="FRONT" />

                      {/* Live detection alert overlay */}
                      {alertVisible && latestAlert && (() => {
                        const issueType = (latestAlert.type || "DETECTION").toUpperCase().replace(/_/g, " ");
                        const sev = latestAlert.severity || "MEDIUM";
                        const sevColor = sev === "CRITICAL" ? "border-red-500 bg-red-500/15" : sev === "HIGH" ? "border-orange-500 bg-orange-500/12" : "border-yellow-500 bg-yellow-500/10";
                        const sevText = sev === "CRITICAL" ? "text-red-400" : sev === "HIGH" ? "text-orange-400" : "text-yellow-400";
                        const sevGlow = sev === "CRITICAL" ? "shadow-[0_0_30px_rgba(239,68,68,0.4)]" : sev === "HIGH" ? "shadow-[0_0_25px_rgba(249,115,22,0.35)]" : "shadow-[0_0_20px_rgba(234,179,8,0.3)]";
                        return (
                          <>
                            <div className="absolute inset-0 pointer-events-none animate-pulse" style={{ background: sev === "CRITICAL" ? "rgba(220,38,38,0.08)" : sev === "HIGH" ? "rgba(249,115,22,0.06)" : "rgba(234,179,8,0.04)" }} />
                            <div className={`absolute top-14 left-1/2 -translate-x-1/2 ${sev === "CRITICAL" ? "bg-red-600/90" : sev === "HIGH" ? "bg-orange-600/90" : "bg-yellow-600/90"} backdrop-blur-md px-4 py-1.5 rounded-full text-[10px] text-white font-bold tracking-wider ${sevGlow} flex items-center gap-2 animate-bounce`}>
                              <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                              {issueType} DETECTED — {selected.bus_id}
                            </div>
                            <div className={`absolute bottom-16 left-1/2 -translate-x-1/2 w-[55%] border-2 ${sevColor} rounded-lg ${sevGlow} backdrop-blur-sm transition-all duration-300`}>
                              <div className={`flex items-center justify-between px-3 py-1.5 border-b ${sev === "CRITICAL" ? "border-red-500/30" : sev === "HIGH" ? "border-orange-500/30" : "border-yellow-500/30"}`}>
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                                  <span className={`text-xs font-bold ${sevText} uppercase tracking-wider`}>⚠ {issueType}</span>
                                </div>
                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${sev === "CRITICAL" ? "bg-red-600 text-white" : sev === "HIGH" ? "bg-orange-600 text-white" : "bg-yellow-600 text-black"}`}>{sev}</span>
                              </div>
                              <div className="px-3 py-2 grid grid-cols-3 gap-2 text-[9px]">
                                <div>
                                  <div className="text-gray-500 uppercase tracking-wider mb-0.5">Bus</div>
                                  <div className="text-cyan-300 font-mono font-bold text-sm">{selected.bus_id}</div>
                                </div>
                                <div>
                                  <div className="text-gray-500 uppercase tracking-wider mb-0.5">Confidence</div>
                                  <div className="text-emerald-400 font-mono font-bold text-sm">
                                    {latestAlert.confidence != null ? `${(latestAlert.confidence * 100).toFixed(0)}%` : "—"}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-gray-500 uppercase tracking-wider mb-0.5">Event</div>
                                  <div className="text-gray-300 font-mono text-[8px]">{latestAlert.id || "EVT-LIVE"}</div>
                                </div>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </Card>
                </div>

                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <span className="text-xs text-gray-400">Bus Telemetry</span>
                      <Badge text={selected.status} variant={selected.status === "LIVE" ? "success" : "default"} />
                    </CardHeader>
                    <div className="p-4 space-y-2 text-[11px]">
                      <div className="flex justify-between"><span className="text-gray-500">Route</span><span className="text-gray-200">{selected.route_name}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">GPS</span><span className="text-gray-200 font-mono">{selected.latitude.toFixed(5)}N, {selected.longitude.toFixed(5)}E</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Stream FPS</span><span className="text-emerald-400 font-mono">{selected.fps.toFixed(1)}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Events today</span><span className="text-orange-400">{selected.events_today}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Incidents today</span><span className="text-red-400">{selected.incidents_today}</span></div>
                    </div>
                  </Card>

                  <Card>
                    <CardHeader>
                      <span className="text-xs text-gray-400">Vehicle Population</span>
                      <span className="text-[9px] text-gray-500">on {selected.bus_id}</span>
                    </CardHeader>
                    <div className="p-3 grid grid-cols-2 gap-2 text-[11px]">
                      {VEHICLE_KEYS.map(({ label, key }) => (
                        <div key={key} className="flex justify-between items-center p-2 rounded bg-gray-900/70 border border-gray-800">
                          <span className="text-gray-400">{label}</span>
                          <span className="text-cyan-400 font-mono font-bold text-sm">{selected.vehicle_counts[key] || 0}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              </div>

              <div>
                <Card>
                  <CardHeader>
                    <span className="text-sm font-medium text-gray-300">Camera Array — {selected.bus_id}</span>
                    <Badge text={`${selected.cameras.filter((c) => c.active).length}/5 ONLINE`} variant="info" />
                  </CardHeader>
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {["REAR", "LEFT", "RIGHT", "CABIN"].map((cam) => (
                      <Card key={cam} className="overflow-hidden">
                        <CardHeader>
                          <div className="flex items-center justify-between w-full">
                            <span className="text-[10px] font-semibold text-gray-400">{cam} CAMERA</span>
                            {selected.cameras.find((c) => c.camera === cam)?.active ? (
                              <Badge text="LIVE FEED" variant="success" />
                            ) : (
                              <Badge text="STANDBY" variant="default" />
                            )}
                          </div>
                        </CardHeader>
                        <CameraFrame bus={selected} camera={cam} />
                      </Card>
                    ))}
                  </div>
                </Card>
              </div>

              {selected.recent_events.length > 0 && (
                <Card>
                  <CardHeader>
                    <span className="text-sm font-medium text-gray-300">Recent Detections — {selected.bus_id}</span>
                    <Badge text={`${selected.recent_events.length} events`} variant="medium" />
                  </CardHeader>
                  <div className="p-4 space-y-1.5 max-h-[260px] overflow-y-auto">
                    {selected.recent_events.map((ev) => (
                      <div key={ev.event_id} className="flex items-center justify-between p-2 bg-gray-800/50 rounded border-l-2 text-[10px]" style={{ borderLeftColor: ev.severity === "CRITICAL" ? "#ef4444" : ev.severity === "HIGH" ? "#f97316" : ev.severity === "MEDIUM" ? "#eab308" : "#22c55e" }}>
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-white uppercase">{ev.event_type.replace(/_/g, " ")}</span>
                          <span className="text-[9px] text-gray-500 font-mono">{ev.event_id}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-400 font-mono">{(ev.confidence * 100).toFixed(0)}%</span>
                          <Badge text={ev.severity} variant={ev.severity.toLowerCase()} />
                          <span className="text-[9px] text-gray-500">{fmtTime(ev.created_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}
        </>
      )}

      <div className="flex items-center justify-between text-[10px] text-gray-600">
        <span>Every bus = one edge unit (YOLOv8 + ByteTrack + defect suite + plate OCR) streaming detections to this console. Video stays on the bus; only intelligence reaches the center.</span>
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${messages.length > 0 ? "bg-emerald-500 animate-pulse" : "bg-gray-700"}`} />
          WS {messages.length > 0 ? "RECEIVING" : "IDLE"}
        </div>
      </div>
    </div>
  );
}