"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import type * as Leaflet from "leaflet";
import { api } from "@/lib/api";
import { Event, Issue, Bus, BusLocation } from "@/types";
import { Card, CardHeader } from "@/components/ui/Card";

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#ef4444",
  HIGH: "#f97316",
  MEDIUM: "#eab308",
  LOW: "#22c55e",
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: "#ef4444",
  ASSIGNED: "#f97316",
  IN_PROGRESS: "#3b82f6",
  PENDING_VERIFICATION: "#a855f7",
  RESOLVED: "#22c55e",
  REOPENED: "#ef4444",
};

// Snap coordinates to ~11 m so observations of the same spot collapse into one marker.
const SNAP = 4;
const snap = (v: number) => Math.round(v * 10 ** SNAP) / 10 ** SNAP;
const SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

function topSeverity<T extends { severity: string }>(items: T[]): string {
  for (const s of SEV_ORDER) {
    if (items.some((i) => i.severity === s)) return s;
  }
  return items[0]?.severity || "LOW";
}

function groupBySpot<T extends { latitude: number; longitude: number }>(items: T[]): { lat: number; lon: number; items: T[] }[] {
  const groups = new Map<string, { lat: number; lon: number; items: T[] }>();
  items.forEach((item) => {
    const lat = snap(item.latitude);
    const lon = snap(item.longitude);
    const key = `${lat}|${lon}`;
    if (!groups.has(key)) groups.set(key, { lat, lon, items: [] });
    groups.get(key)!.items.push(item);
  });
  return [...groups.values()];
}

export default function MapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Leaflet.Map | null>(null);
  const markersRef = useRef<Leaflet.Marker[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [buses, setBuses] = useState<Bus[]>([]);
  const [busLocations, setBusLocations] = useState<BusLocation[]>([]);
  const [activeLayer, setActiveLayer] = useState<"events" | "issues" | "buses">("events");
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    const initMap = async () => {
      if (typeof window === "undefined") return;
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");

      if (!mapRef.current || mapInstanceRef.current) return;

      const map = L.map(mapRef.current, {
        zoomControl: true,
      }).setView([18.53, 73.86], 13);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = map;
      setMapReady(true);
    };

    initMap();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  const fetchMapData = useCallback(() => {
    api.getEvents({ limit: "200" }).then((r) => setEvents(r.events)).catch(() => {});
    api.getIssues({ limit: "200" }).then((r) => setIssues(r.issues)).catch(() => {});
    api.getBuses().then(setBuses).catch(() => {});
    api.getBusLocations().then(setBusLocations).catch(() => {});
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    fetchMapData();

    // Refresh bus telemetry every 5 seconds
    const interval = setInterval(() => {
      api.getBusLocations().then(setBusLocations).catch(() => {});
    }, 5000);

    return () => clearInterval(interval);
  }, [mapReady, fetchMapData]);

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    let cancelled = false;

    (async () => {
      const L = await import("leaflet");
      if (cancelled || !mapInstanceRef.current) return;
      const map = mapInstanceRef.current;

      markersRef.current.forEach((m) => map.removeLayer(m));
      markersRef.current = [];

      if (activeLayer === "events") {
        groupBySpot(events).forEach((g) => {
          const color = SEVERITY_COLORS[topSeverity(g.items)] || "#888";
          const count = g.items.length;
          const html =
            count === 1
              ? `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);"></div>`
              : `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:bold;">${count}</div>`;
          const icon = L.divIcon({
            className: "custom-marker",
            html,
            iconSize: count === 1 ? [14, 14] : [22, 22],
            iconAnchor: count === 1 ? [7, 7] : [11, 11],
          });
          const title = count === 1 ? `${g.items[0].event_type}` : `${count} events at this location`;
          const popupRows = g.items
            .slice(0, 8)
            .map(
              (e) => `
                <div style="font-size:10px;border-top:1px solid #eee;padding-top:3px;margin-top:3px;">
                  <b>${e.event_type}</b> <span style="color:#888">${e.event_id}</span><br/>
                  Confidence: ${(e.confidence * 100).toFixed(0)}% · Severity: ${e.severity} · Source: ${e.source}<br/>
                  <span style="color:#999">${new Date(e.created_at).toLocaleString()}</span>
                </div>`
            )
            .join("");
          const marker = L.marker([g.lat, g.lon], { icon })
            .addTo(map)
            .bindPopup(`
              <div style="min-width:200px">
                <b style="font-size:12px">${title}</b>
                ${popupRows}
                ${g.items.length > 8 ? `<div style="font-size:10px;color:#888;margin-top:3px;">… +${g.items.length - 8} more</div>` : ""}
              </div>
            `);
          markersRef.current.push(marker);
        });
      }

      if (activeLayer === "issues") {
        groupBySpot(issues).forEach((g) => {
          const color = STATUS_COLORS[g.items[0].status] || "#888";
          const count = g.items.length;
          const html =
            count === 1
              ? `<div style="width:18px;height:18px;border-radius:4px;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-size:8px;color:white;font-weight:bold;">▲</div>`
              : `<div style="width:22px;height:22px;border-radius:4px;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-size:9px;color:white;font-weight:bold;">▲ ${count}</div>`;
          const icon = L.divIcon({
            className: "custom-marker",
            html,
            iconSize: count === 1 ? [18, 18] : [22, 22],
            iconAnchor: count === 1 ? [9, 9] : [11, 11],
          });
          const title = count === 1 ? `${g.items[0].issue_id}` : `${count} issues at this location`;
          const popupRows = g.items
            .slice(0, 8)
            .map(
              (i) => `
                <div style="font-size:10px;border-top:1px solid #eee;padding-top:3px;margin-top:3px;">
                  <b>${i.issue_id}</b> <span style="color:#888">${i.issue_type}</span><br/>
                  Status: ${i.status} · ${i.department || "N/A"} · Observations: ${i.observation_count}<br/>
                  <a href="/issues/${i.id}" style="color:#3b82f6">View Details →</a>
                </div>`
            )
            .join("");
          const marker = L.marker([g.lat, g.lon], { icon })
            .addTo(map)
            .bindPopup(`
              <div style="min-width:200px">
                <b style="font-size:12px">${title}</b>
                ${popupRows}
                ${g.items.length > 8 ? `<div style="font-size:10px;color:#888;margin-top:3px;">… +${g.items.length - 8} more</div>` : ""}
              </div>
            `);
          markersRef.current.push(marker);
        });
      }

      if (activeLayer === "buses") {
        busLocations.forEach((b) => {
          // If no GPS coordinates exist for this bus, do not invent phantom coordinates
          if (b.latitude === null || b.longitude === null) {
            return;
          }

          const icon = L.divIcon({
            className: "custom-marker",
            html: `<div style="width:22px;height:22px;border-radius:50%;background:#06b6d4;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-size:10px;color:white;font-weight:bold;">🚌</div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          });

          const isSimulated = b.source === "SIMULATED";
          const sourceLabel = b.source || "UNAVAILABLE";
          const speedLabel = b.speed !== null && b.speed !== undefined ? `${b.speed.toFixed(1)} km/h` : "N/A";
          const headingLabel = b.heading !== null && b.heading !== undefined ? `${b.heading.toFixed(0)}°` : "N/A";
          const timeLabel = b.last_updated ? new Date(b.last_updated).toLocaleTimeString() : "N/A";

          const marker = L.marker([b.latitude, b.longitude], { icon })
            .addTo(map)
            .bindPopup(`
              <div style="min-width:190px;font-family:system-ui,-apple-system,sans-serif;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                  <b style="font-size:13px;color:#111;">${b.bus_number}</b>
                  <span style="font-size:9px;padding:2px 6px;border-radius:4px;background:${b.status === "ACTIVE" ? "#22c55e20" : "#ef444420"};color:${b.status === "ACTIVE" ? "#16a34a" : "#dc2626"};font-weight:600;">${b.status}</span>
                </div>
                <div style="font-size:10px;color:#555;line-height:1.5;">
                  <div><b>GPS:</b> ${b.latitude.toFixed(4)}, ${b.longitude.toFixed(4)}</div>
                  <div><b>Speed:</b> ${speedLabel} | <b>Heading:</b> ${headingLabel}</div>
                  <div><b>Last Update:</b> ${timeLabel}</div>
                  <div style="margin-top:4px;padding-top:4px;border-top:1px solid #eee;">
                    <b>GPS Source:</b> <span style="color:${isSimulated ? "#d97706" : "#2563eb"};font-weight:600;">${sourceLabel}</span>
                  </div>
                </div>
              </div>
            `);
          markersRef.current.push(marker);
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [events, issues, busLocations, activeLayer, mapReady]);

  const busesWithGPS = busLocations.filter((b) => b.latitude !== null && b.longitude !== null);
  const busesWithoutGPS = busLocations.filter((b) => b.latitude === null || b.longitude === null);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">GIS Command Center</h1>
          <p className="text-sm text-gray-500">Geospatial view of events, issues, and fleet</p>
        </div>
        <div className="flex gap-2">
          {(["events", "issues", "buses"] as const).map((layer) => (
            <button
              key={layer}
              onClick={() => setActiveLayer(layer)}
              className={`text-[10px] px-3 py-1.5 rounded border transition-colors ${
                activeLayer === layer
                  ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
                  : "bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-600"
              }`}
            >
              {layer === "events" && "● Events"}
              {layer === "issues" && "▲ Issues"}
              {layer === "buses" && "🚌 Fleet"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <div ref={mapRef} className="h-[600px] rounded-lg overflow-hidden border border-gray-800" />
        </div>
        <div className="w-72 space-y-3">
          <Card>
            <CardHeader>
              <span className="text-xs text-gray-400">Legend</span>
            </CardHeader>
            <div className="p-3 space-y-2">
              <div className="flex items-center gap-2 text-[10px]"><span className="w-3 h-3 rounded-full bg-red-500" /> Critical</div>
              <div className="flex items-center gap-2 text-[10px]"><span className="w-3 h-3 rounded-full bg-orange-500" /> High</div>
              <div className="flex items-center gap-2 text-[10px]"><span className="w-3 h-3 rounded-full bg-yellow-500" /> Medium</div>
              <div className="flex items-center gap-2 text-[10px]"><span className="w-3 h-3 rounded-full bg-green-500" /> Low / Resolved</div>
              <div className="flex items-center gap-2 text-[10px]"><span className="w-3 h-3 rounded-full bg-cyan-500" /> Fleet Bus</div>
              <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-2 pt-2 border-t border-gray-800">
                Markers at the same spot are merged — a number badge shows how many observations/issues are stacked there.
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <span className="text-xs text-gray-400">Stats</span>
            </CardHeader>
            <div className="p-3 space-y-1 text-[10px]">
              <div className="flex justify-between"><span className="text-gray-500">Events</span><span className="text-gray-300">{events.length}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Issues</span><span className="text-gray-300">{issues.length}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Fleet (Total)</span><span className="text-gray-300">{busLocations.length || buses.length}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Fleet (Live GPS)</span><span className="text-cyan-400 font-semibold">{busesWithGPS.length}</span></div>
              {busesWithoutGPS.length > 0 && (
                <div className="flex justify-between"><span className="text-gray-500">Fleet (No GPS Fix)</span><span className="text-amber-500">{busesWithoutGPS.length}</span></div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <span className="text-xs text-gray-400">Fleet Telemetry Status</span>
            </CardHeader>
            <div className="p-3 space-y-2">
              {busLocations.map((b) => (
                <div key={b.bus_id} className="flex items-center justify-between text-[10px] border-b border-gray-800/60 pb-1.5 last:border-0 last:pb-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${b.latitude !== null ? "bg-cyan-400" : "bg-gray-600"}`} />
                    <span className="text-gray-300 font-medium">{b.bus_number}</span>
                  </div>
                  <div className="text-right">
                    {b.latitude !== null ? (
                      <span className="text-xs text-cyan-400 font-mono">
                        {b.latitude.toFixed(3)}, {b.longitude?.toFixed(3)}
                      </span>
                    ) : (
                      <span className="text-[9px] text-gray-500 italic">No GPS Fix</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <span className="text-xs text-gray-400">Defect Types</span>
            </CardHeader>
            <div className="p-3 space-y-2">
              {Array.from(
                events.reduce((acc, e) => {
                  acc.set(e.event_type, (acc.get(e.event_type) || 0) + 1);
                  return acc;
                }, new Map<string, number>())
              )
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between text-[10px]">
                    <span className="text-gray-400">{type.replaceAll("_", " ")}</span>
                    <span className="text-gray-500">{count}</span>
                  </div>
                ))}
              {events.length === 0 && <span className="text-[10px] text-gray-600">No defect events yet — run the demo</span>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

