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

const TILE_DESCRIPTIONS: Record<string, { title: string; subtitle: string; isDerived: boolean }> = {
  FRONT: { title: "FRONT SENSOR", subtitle: "Primary Optical Feed", isDerived: false },
  REAR: { title: "REAR VIEW", subtitle: "Derived Perspective (Simulated)", isDerived: true },
  LEFT: { title: "LEFT FLANK", subtitle: "Derived Perspective (Simulated)", isDerived: true },
  RIGHT: { title: "RIGHT FLANK", subtitle: "Derived Perspective (Simulated)", isDerived: true },
  CABIN: { title: "CABIN INTERIOR", subtitle: "Derived Perspective (Simulated)", isDerived: true },
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
  const cam = bus.cameras.find((c) => c.camera === camera);
  const active = Boolean(cam?.url);
  const tileInfo = TILE_DESCRIPTIONS[camera] || { title: camera, subtitle: "Auxiliary Feed", isDerived: false };

  if (!cam || !active) {
    return (
      <div className="bg-slate-900 aspect-video relative overflow-hidden flex items-center justify-center border border-slate-800">
        <div className="text-center p-4">
          <div className="w-7 h-7 mx-auto mb-2 rounded-full border border-slate-700 flex items-center justify-center text-slate-400 text-xs font-mono">
            !
          </div>
          <span className="text-xs text-slate-400 font-medium">CAMERA FEED OFFLINE</span>
          <p className="text-[10px] text-slate-500 mt-0.5">{tileInfo.subtitle}</p>
        </div>
      </div>
    );
  }

  if (camera === "FRONT") {
    return (
      <div className="bg-black aspect-video relative overflow-hidden border border-slate-800">
        <iframe
          className="absolute inset-0 w-full h-full border-0 object-cover"
          src={getYouTubeEmbedUrl(cam.url)}
          title={`${bus.bus_id} FRONT camera`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
        <div className="absolute top-3 left-3 bg-slate-900/90 border border-slate-700 px-3 py-1.5 rounded text-[11px] text-white shadow-md pointer-events-none">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="font-semibold">{tileInfo.title}</span>
            <span className="text-[10px] text-slate-300 font-mono">({bus.bus_id})</span>
          </div>
          <div className="text-slate-300 text-[10px] mt-0.5">
            AI Pipeline: {bus.ai_mode} · GPS Sync: {bus.gps_mode}
          </div>
        </div>
        <div className="absolute top-3 right-3 bg-slate-900/90 border border-slate-700 px-3 py-1.5 rounded text-[11px] text-right text-white shadow-md pointer-events-none font-mono">
          <div className="text-emerald-400 font-semibold">{bus.fps.toFixed(1)} FPS</div>
          <div className="text-slate-300 text-[10px]">{bus.latitude.toFixed(5)}°N, {bus.longitude.toFixed(5)}°E</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-black aspect-video relative overflow-hidden border border-slate-800">
      <iframe
        className="absolute inset-0 w-full h-full border-0 object-cover"
        style={CAM_STYLE[camera]}
        src={getYouTubeEmbedUrl(cam.url)}
        title={`${bus.bus_id} ${camera} camera`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
      <div className="absolute top-2 left-2 bg-slate-900/90 px-2 py-1 rounded text-[10px] text-white font-medium border border-slate-700 flex items-center gap-1.5 pointer-events-none">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        <span>{tileInfo.title}</span>
      </div>
      <div className="absolute bottom-2 left-2 bg-slate-900/90 px-2 py-0.5 rounded text-[9px] text-amber-300 font-medium border border-slate-700 pointer-events-none">
        {tileInfo.subtitle}
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
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Fleet Surveillance & Video Analytics
            </span>
            <span className="px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-[10px] font-semibold text-blue-800 tracking-wide">
              MUNICIPAL CONTROL ROOM
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Fleet Camera Command Center
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Public transit buses functioning as mobile municipal sensor platforms. Real-time vision analytics, defect detection, and spatial telemetry.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Badge text={fleet ? `ACTIVE UNITS: ${fleet.live_buses}/${fleet.total_buses}` : "CONNECTING..."} variant="info" />
          <Badge text={`${fleet?.cameras_online ?? 0} SENSOR FEEDS`} variant="success" />
          <Badge text={polling ? "POLLING: 5s" : "STANDBY"} variant={polling ? "default" : "warning"} />
        </div>
      </div>

      {!fleet && (
        <Card>
          <div className="p-12 text-center text-slate-500 text-xs">
            Querying municipal transit telemetry...
          </div>
        </Card>
      )}

      {fleet && fleet.buses.length > 0 && (
        <>
          {/* Transit Units Selection Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {fleet.buses.map((bus) => {
              const isSel = bus.bus_id === selected?.bus_id;
              const camOnline = bus.cameras.filter((c) => c.active).length;
              return (
                <button
                  key={bus.bus_id}
                  onClick={() => setSelectedId(bus.bus_id)}
                  className={`text-left p-3.5 rounded-lg border transition-all ${
                    isSel
                      ? "bg-blue-50/70 border-blue-600 ring-1 ring-blue-600 shadow-sm"
                      : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-bold ${isSel ? "text-blue-900" : "text-slate-900"}`}>
                      {bus.bus_id}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-semibold tracking-wide ${
                        bus.status === "LIVE"
                          ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                          : "bg-slate-100 text-slate-600 border border-slate-200"
                      }`}
                    >
                      {bus.status === "LIVE" ? "ACTIVE SENSING" : "STANDBY"}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 truncate">
                    {bus.route_name} ({bus.route_id})
                  </div>
                  <div className="flex items-center justify-between mt-2 text-[11px]">
                    <span className="text-slate-600 font-medium">
                      {camOnline} feeds · {bus.incidents_today} detections
                    </span>
                    <span className="font-mono text-slate-400 text-[10px]">
                      {bus.latitude.toFixed(3)}N, {bus.longitude.toFixed(3)}E
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
                        <span className="text-xs font-mono text-slate-500">{selected.route_name}</span>
                      </div>
                    </CardHeader>
                    <div className="relative">
                      <CameraFrame bus={selected} camera="FRONT" />

                      {/* Live Detection Alert Banner */}
                      {alertVisible && latestAlert && (
                        <div className="absolute top-14 left-1/2 -translate-x-1/2 w-11/12 max-w-md bg-slate-900/95 border border-amber-400 p-3 rounded-md shadow-xl text-white">
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
                      <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                        Unit Telemetry & Status
                      </span>
                      <Badge text={selected.status} variant={selected.status === "LIVE" ? "success" : "default"} />
                    </CardHeader>
                    <div className="p-4 space-y-2 text-xs">
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-500">Transit Corridor</span>
                        <span className="font-medium text-slate-900">{selected.route_name}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-500">Geographic Coordinates</span>
                        <span className="font-mono text-slate-800">
                          {selected.latitude.toFixed(5)}°N, {selected.longitude.toFixed(5)}°E
                        </span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-500">Inference Throughput</span>
                        <span className="font-mono font-semibold text-emerald-700">{selected.fps.toFixed(1)} FPS</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-500">Road Defects Flagged (24h)</span>
                        <span className="font-semibold text-slate-900 font-mono">{selected.events_today}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-slate-500">Traffic Incidents (24h)</span>
                        <span className="font-semibold text-slate-900 font-mono">{selected.incidents_today}</span>
                      </div>
                    </div>
                  </Card>

                  {/* Vehicle Counting Card */}
                  <Card>
                    <CardHeader>
                      <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                        Vehicle Density In Area
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">EDGE BYTE-TRACK</span>
                    </CardHeader>
                    <div className="p-3 grid grid-cols-2 gap-2 text-xs">
                      {VEHICLE_KEYS.map(({ label, key }) => (
                        <div key={key} className="flex justify-between items-center p-2.5 rounded bg-slate-50 border border-slate-200">
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
                    <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Multi-Perspective Sensor Perspectives — Unit {selected.bus_id}
                    </span>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Note: In this test harness, auxiliary perspectives (Rear, Flanks, Cabin) are synthetically derived from the forward sensing array.
                    </p>
                  </div>
                  <Badge text={`${selected.cameras.filter((c) => c.active).length}/5 CHANNELS ACTIVE`} variant="info" />
                </CardHeader>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {["REAR", "LEFT", "RIGHT", "CABIN"].map((cam) => {
                    const info = TILE_DESCRIPTIONS[cam];
                    return (
                      <div key={cam} className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
                        <div className="p-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                          <div>
                            <span className="text-xs font-bold text-slate-900">{info.title}</span>
                            <div className="text-[10px] text-amber-700 font-medium">{info.subtitle}</div>
                          </div>
                          <Badge text="SYNTHETIC" variant="medium" />
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
                    <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Recent Detections by Unit {selected.bus_id}
                    </span>
                    <Badge text={`${selected.recent_events.length} EVENTS`} variant="default" />
                  </CardHeader>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                          <th className="py-2.5 px-4">Event ID</th>
                          <th className="py-2.5 px-4">Defect / Incident Type</th>
                          <th className="py-2.5 px-4">Confidence</th>
                          <th className="py-2.5 px-4">Severity</th>
                          <th className="py-2.5 px-4">Captured Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selected.recent_events.map((ev) => (
                          <tr key={ev.event_id} className="hover:bg-slate-50/50">
                            <td className="py-2 px-4 font-mono text-slate-600">{ev.event_id}</td>
                            <td className="py-2 px-4 font-semibold text-slate-900 uppercase">
                              {ev.event_type.replace(/_/g, " ")}
                            </td>
                            <td className="py-2 px-4 font-mono text-emerald-700 font-medium">
                              {(ev.confidence * 100).toFixed(0)}%
                            </td>
                            <td className="py-2 px-4">
                              <Badge text={ev.severity} variant={ev.severity.toLowerCase()} />
                            </td>
                            <td className="py-2 px-4 text-slate-500 font-mono text-[11px]">
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