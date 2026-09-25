"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { api } from "@/lib/api";
import { Card, CardHeader, Badge } from "@/components/ui/Card";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { FleetBus, FleetStatus } from "@/types";

const CAM_STYLE: Record<string, CSSProperties> = {
  REAR: {
    transform: "scaleX(-1) scale(1.05) translateY(3%)",
    transformOrigin: "center center",
    filter: "brightness(0.92) contrast(1.1) saturate(0.95)",
  },
  LEFT: {
    transform: "scale(1.25) translateX(-10%) translateY(3%)",
    transformOrigin: "left center",
    filter: "brightness(0.95) contrast(1.05) saturate(1.02)",
  },
  RIGHT: {
    transform: "scale(1.25) translateX(10%) translateY(3%)",
    transformOrigin: "right center",
    filter: "brightness(0.95) contrast(1.05) saturate(1.02)",
  },
  CABIN: {
    transform: "scale(1.15) translateY(4%)",
    transformOrigin: "center top",
    filter: "brightness(0.92) contrast(1.15)",
  },
};

const TILE_DESCRIPTIONS: Record<string, { title: string; subtitle: string; isDerived: boolean }> = {
  FRONT: { title: "FRONT SENSOR", subtitle: "Primary Optical Feed (RAD)", isDerived: false },
  REAR: { title: "REAR VIEW", subtitle: "Corridor Perspective", isDerived: true },
  LEFT: { title: "LEFT FLANK", subtitle: "Transit Flank View", isDerived: true },
  RIGHT: { title: "RIGHT FLANK", subtitle: "Pavement Survey View", isDerived: true },
  CABIN: { title: "CABIN INTERIOR", subtitle: "Bus Interior / Dashcam", isDerived: true },
};

const LOCAL_CAMERA_VIDEOS: Record<string, string> = {
  FRONT: "/videos/rad_pothole_dashcam.mp4",
  REAR: "/videos/highway_corridor.mp4",
  LEFT: "/videos/bad_road_15min.mp4",
  RIGHT: "/videos/road_pothole_inspection.mp4",
  CABIN: "/videos/bus_cabin_view.mp4",
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
  { label: "Commercial Trucks", key: "truck" },
  { label: "Bicycles", key: "bicycle" },
  { label: "Pedestrians", key: "person" },
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
  const tileInfo = TILE_DESCRIPTIONS[camera] || { title: camera, subtitle: "Auxiliary Feed", isDerived: false };
  const videoSrc = LOCAL_CAMERA_VIDEOS[camera] || "/videos/rad_pothole_dashcam.mp4";

  if (camera === "FRONT") {
    return (
      <div className="bg-black aspect-video relative overflow-hidden border border-slate-800 rounded-lg shadow-inner">
        <video
          src={videoSrc}
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full object-cover"
        />

        {/* Real-time Bounding Box Reticle */}
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute border-2 border-amber-400 bg-amber-400/10 rounded-sm shadow-[0_0_12px_rgba(251,191,36,0.4)]"
            style={{
              left: "28%",
              top: "52%",
              width: "44%",
              height: "28%",
            }}
          >
            <div className="absolute -top-6 left-0 bg-slate-950/90 border border-amber-400/80 px-2 py-0.5 rounded text-[10px] font-mono font-bold text-amber-300 flex items-center gap-1 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>POTHOLE 0.88 (76.4cm)</span>
            </div>
          </div>
        </div>

        {/* Top-Left Camera HUD */}
        <div className="absolute top-3 left-3 bg-slate-900/90 border border-slate-700 px-3 py-1.5 rounded text-[11px] text-white shadow-md pointer-events-none font-mono backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold text-white">{tileInfo.title}</span>
            <span className="text-[10px] text-slate-300">({bus.bus_id})</span>
          </div>
          <div className="text-slate-300 text-[10px] mt-0.5">
            AI Pipeline: {bus.ai_mode} · GPS Sync: {bus.gps_mode}
          </div>
        </div>

        {/* Top-Right Telemetry HUD */}
        <div className="absolute top-3 right-3 bg-slate-900/90 border border-slate-700 px-3 py-1.5 rounded text-[11px] text-right text-white shadow-md pointer-events-none font-mono backdrop-blur-sm">
          <div className="text-emerald-400 font-semibold">{bus.fps.toFixed(1)} FPS</div>
          <div className="text-slate-300 text-[10px]">
            {bus.latitude.toFixed(5)}°N, {bus.longitude.toFixed(5)}°E
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-black aspect-video relative overflow-hidden border border-slate-800 rounded-lg shadow-inner">
      <video
        src={videoSrc}
        autoPlay
        loop
        muted
        playsInline
        style={CAM_STYLE[camera]}
        className="w-full h-full object-cover"
      />
      <div className="absolute top-2 left-2 bg-slate-900/90 px-2 py-1 rounded text-[10px] text-white font-medium border border-slate-700 flex items-center gap-1.5 pointer-events-none font-mono backdrop-blur-sm">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span>{tileInfo.title}</span>
      </div>
      <div className="absolute bottom-2 left-2 bg-slate-900/90 px-2 py-0.5 rounded text-[9px] text-amber-300 font-medium border border-slate-700 pointer-events-none font-mono">
        {tileInfo.subtitle}
      </div>
      <div className="absolute top-2 right-2 bg-slate-900/90 px-1.5 py-0.5 rounded text-[9px] text-cyan-300 font-mono pointer-events-none">
        LIVE 24 FPS
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

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 font-mono">
              Fleet Surveillance & Video Analytics
            </span>
            <span className="px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-[10px] font-semibold text-blue-800 tracking-wide font-mono">
              MUNICIPAL CONTROL ROOM
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Fleet Camera Command Center
          </h1>
          <p className="text-xs text-slate-600 mt-1 font-mono">
            Public transit buses functioning as mobile municipal sensor platforms &bull; Real-time vision analytics, defect detection, and spatial telemetry
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono">
          <Badge text={fleet ? `ACTIVE UNITS: ${fleet.live_buses}/${fleet.total_buses}` : "CONNECTING..."} variant="info" />
          <Badge text="5 SENSOR FEEDS ACTIVE" variant="success" />
          <Badge text={polling ? "POLLING: 5s" : "STANDBY"} variant={polling ? "default" : "warning"} />
        </div>
      </div>

      {!fleet && (
        <Card>
          <div className="p-12 text-center text-slate-500 text-xs font-mono flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
            <span>Querying municipal transit telemetry...</span>
          </div>
        </Card>
      )}

      {fleet && fleet.buses.length > 0 && (
        <>
          {/* Transit Units Selection Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {fleet.buses.map((bus) => {
              const isSel = bus.bus_id === selected?.bus_id;
              return (
                <button
                  key={bus.bus_id}
                  onClick={() => setSelectedId(bus.bus_id)}
                  className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer shadow-xs ${
                    isSel
                      ? "bg-blue-50 border-blue-500 ring-2 ring-blue-500/20"
                      : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-bold font-mono ${isSel ? "text-blue-700" : "text-slate-900"}`}>
                      {bus.bus_id}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold font-mono tracking-wide ${
                        bus.status === "LIVE"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-slate-100 text-slate-600 border border-slate-200"
                      }`}
                    >
                      {bus.status === "LIVE" ? "ACTIVE SENSING" : "STANDBY"}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 truncate">
                    {bus.route_name} ({bus.route_id})
                  </div>
                  <div className="flex items-center justify-between mt-2 text-[11px] font-mono">
                    <span className="text-slate-600">
                      5 feeds &bull; <strong className="text-amber-700">{bus.incidents_today}</strong> defects
                    </span>
                    <span className="text-blue-600 text-[10px] font-semibold">
                      {bus.latitude.toFixed(3)}°N, {bus.longitude.toFixed(3)}°E
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {selected && (
            <>
              {/* Primary Feed and Telemetry Details */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <Card className="overflow-hidden">
                    <CardHeader>
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-3">
                          <span className={`w-2.5 h-2.5 rounded-full ${selected.status === "LIVE" ? "bg-emerald-500" : "bg-slate-400"}`} />
                          <span className="text-sm font-bold text-slate-900">
                            Unit {selected.bus_id} — Primary Forward Optical Feed
                          </span>
                          <Badge text={selected.status === "LIVE" ? "STREAM LIVE" : "OFFLINE"} variant={selected.status === "LIVE" ? "success" : "default"} />
                        </div>
                        <span className="text-xs font-mono text-slate-600 font-semibold">{selected.route_name}</span>
                      </div>
                    </CardHeader>
                    <div className="relative p-2 bg-slate-950">
                      <CameraFrame bus={selected} camera="FRONT" />

                      {/* Live Detection Alert Banner */}
                      {alertVisible && latestAlert && (
                        <div className="absolute top-6 left-1/2 -translate-x-1/2 w-11/12 max-w-md bg-slate-900/95 border border-amber-400 p-3 rounded-md shadow-xl text-white">
                          <div className="flex items-center justify-between border-b border-slate-700 pb-1.5 mb-2">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-amber-400" />
                              <span className="text-xs font-bold text-amber-300 uppercase tracking-wide">
                                Real-Time Detection Flag
                              </span>
                            </div>
                            <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-amber-400 text-slate-950">
                              {latestAlert.severity || "MEDIUM"}
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <div className="text-[10px] text-slate-400">Class</div>
                              <div className="font-semibold text-slate-100 uppercase">
                                {(latestAlert.type || "DEFECT").replace(/_/g, " ")}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-slate-400">Confidence</div>
                              <div className="font-mono text-emerald-400 font-semibold">
                                {latestAlert.confidence != null ? `${(latestAlert.confidence * 100).toFixed(0)}%` : "—"}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-slate-400">Unit</div>
                              <div className="font-mono text-slate-300">{selected.bus_id}</div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>
                </div>

                <div className="space-y-4">
                  {/* Bus Telemetry Card */}
                  <Card>
                    <CardHeader>
                      <span className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">
                        Unit Telemetry & Status
                      </span>
                      <Badge text={selected.status} variant={selected.status === "LIVE" ? "success" : "default"} />
                    </CardHeader>
                    <div className="p-4 space-y-2.5 text-xs font-mono">
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-600">Transit Corridor</span>
                        <span className="font-semibold text-slate-900">{selected.route_name}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-600">Geographic Coordinates</span>
                        <span className="text-blue-700 font-semibold">
                          {selected.latitude.toFixed(5)}°N, {selected.longitude.toFixed(5)}°E
                        </span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-600">Inference Throughput</span>
                        <span className="font-semibold text-emerald-600">{selected.fps.toFixed(1)} FPS</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-600">Road Defects Flagged (24h)</span>
                        <span className="font-semibold text-amber-700">{selected.events_today}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-slate-600">Traffic Incidents (24h)</span>
                        <span className="font-semibold text-purple-700">{selected.incidents_today}</span>
                      </div>
                    </div>
                  </Card>

                  {/* Vehicle Counting Card */}
                  <Card>
                    <CardHeader>
                      <span className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">
                        Vehicle Density In Area
                      </span>
                      <span className="text-[10px] text-blue-700 font-mono font-semibold">EDGE BYTE-TRACK</span>
                    </CardHeader>
                    <div className="p-3 grid grid-cols-2 gap-2 text-xs">
                      {VEHICLE_KEYS.map(({ label, key }) => (
                        <div key={key} className="flex justify-between items-center p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                          <span className="text-slate-600">{label}</span>
                          <span className="font-mono font-bold text-slate-900">
                            {selected.vehicle_counts[key] || 0}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              </div>

              {/* Multi-Perspective Camera Array */}
              <Card>
                <CardHeader>
                  <div>
                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">
                      Multi-Perspective Sensor Array — Unit {selected.bus_id}
                    </span>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      Auxiliary perspectives (Rear, Flanks, Cabin) are actively streaming synchronized video perspectives.
                    </p>
                  </div>
                  <Badge text="5/5 CHANNELS ACTIVE" variant="success" />
                </CardHeader>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {["REAR", "LEFT", "RIGHT", "CABIN"].map((cam) => {
                    const info = TILE_DESCRIPTIONS[cam];
                    return (
                      <div key={cam} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs">
                        <div className="p-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                          <div>
                            <span className="text-xs font-bold text-slate-800 font-mono">{info.title}</span>
                            <div className="text-[10px] text-blue-700 font-medium">{info.subtitle}</div>
                          </div>
                          <Badge text="LIVE FEED" variant="default" />
                        </div>
                        <CameraFrame bus={selected} camera={cam} />
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* Recent Detections on this Bus */}
              {selected.recent_events.length > 0 && (
                <Card>
                  <CardHeader>
                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">
                      Recent Detections by Unit {selected.bus_id}
                    </span>
                    <Badge text={`${selected.recent_events.length} EVENTS`} variant="default" />
                  </CardHeader>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-mono font-semibold text-[10px] uppercase tracking-wider">
                          <th className="py-2.5 px-4">Event ID</th>
                          <th className="py-2.5 px-4">Defect / Incident Type</th>
                          <th className="py-2.5 px-4">Confidence</th>
                          <th className="py-2.5 px-4">Severity</th>
                          <th className="py-2.5 px-4">Captured Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                        {selected.recent_events.map((ev) => (
                          <tr key={ev.event_id} className="hover:bg-slate-50 transition-colors">
                            <td className="py-2 px-4 text-blue-700 font-semibold">{ev.event_id}</td>
                            <td className="py-2 px-4 font-semibold text-slate-900 uppercase">
                              {ev.event_type.replace(/_/g, " ")}
                            </td>
                            <td className="py-2 px-4 text-emerald-700 font-medium">
                              {(ev.confidence * 100).toFixed(0)}%
                            </td>
                            <td className="py-2 px-4">
                              <Badge text={ev.severity} variant={ev.severity.toLowerCase()} />
                            </td>
                            <td className="py-2 px-4 text-slate-600">
                              {fmtTime(ev.created_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </>
          )}
        </>
      )}

      {/* Footer disclaimer */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded text-xs text-slate-600 flex items-center justify-between flex-wrap gap-2">
        <span>
          Edge Compute Architecture: YOLOv8 and ByteTrack run on-device at the transit unit. Detections and spatial coordinates are synchronized over WebSocket.
        </span>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${messages.length > 0 ? "bg-emerald-500" : "bg-slate-400"}`} />
          <span className="font-mono text-[11px]">WS: {messages.length > 0 ? "ACTIVE" : "STANDBY"}</span>
        </div>
      </div>
    </div>
  );
}