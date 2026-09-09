"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import type * as Leaflet from "leaflet";
import { api } from "@/lib/api";
import { Event, Issue, Bus, BusLocation, RouteResponse, RouteStop } from "@/types";
import { Card, CardHeader } from "@/components/ui/Card";

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#ef4444",
  HIGH:     "#f97316",
  MEDIUM:   "#eab308",
  LOW:      "#22c55e",
};

const STATUS_COLORS: Record<string, string> = {
  OPEN:                  "#ef4444",
  ASSIGNED:              "#f97316",
  IN_PROGRESS:           "#3b82f6",
  PENDING_VERIFICATION:  "#a855f7",
  RESOLVED:              "#22c55e",
  REOPENED:              "#ef4444",
};

// Distinct route colours for polylines
const ROUTE_PALETTE = [
  "#06b6d4", // cyan  – FC Road / Viman Nagar
  "#a855f7", // purple – Kothrud / Hinjawadi
  "#22d3ee", // sky   – Station / Kharadi
  "#f59e0b", // amber – Katraj / Hadapsar
  "#34d399", // emerald – PCMC Metro Link
  "#f472b6", // pink  – Dhanori / Airport
];

const ROUTE_LABEL: Record<string, string> = {
  FC_ROAD_VIMAN_NAGAR:         "FC Road – Viman Nagar",
  KOTHRUD_HINJAWADI_EXPRESS:   "Kothrud – Hinjawadi",
  PUNE_STATION_KHARADI_LINE:   "Station – Kharadi / Wagholi",
  KATRAJ_HADAPSAR_CORRIDOR:    "Katraj – Hadapsar",
  OLD_HIGHWAY_PCMC_METRO_LINK: "PCMC Metro Link",
  AIRPORT_DHANORI_CIRCULAR:    "Airport – Dhanori Circular",
};

const SNAP = 4;
const snap = (v: number) => Math.round(v * 10 ** SNAP) / 10 ** SNAP;
const SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

function topSeverity<T extends { severity: string }>(items: T[]): string {
  for (const s of SEV_ORDER) {
    if (items.some((i) => i.severity === s)) return s;
  }
  return items[0]?.severity || "LOW";
}

function groupBySpot<T extends { latitude: number; longitude: number }>(
  items: T[],
  snapPrecision: number = 4
): { lat: number; lon: number; items: T[] }[] {
  const groups = new Map<string, { lat: number; lon: number; items: T[] }>();
  const snap = (v: number) => Math.round(v * 10 ** snapPrecision) / 10 ** snapPrecision;
  items.forEach((item) => {
    const lat = snap(item.latitude);
    const lon = snap(item.longitude);
    const key = `${lat}|${lon}`;
    if (!groups.has(key)) groups.set(key, { lat, lon, items: [] });
    groups.get(key)!.items.push(item);
  });
  return [...groups.values()];
}

// Emoji icon per issue type
const ISSUE_ICON: Record<string, string> = {
  POTHOLE:             "🕳",
  ROAD_CRACK:          "⚡",
  DAMAGED_ROAD:        "🚧",
  WATERLOGGING:        "💧",
  TRAFFIC_CONGESTION:  "🚦",
  MISSING_SIGN:        "🔇",
  MISSING_CROSSING:    "🚶",
  MISSING_DIVIDER:     "━",
  DAMAGED_SIGN:        "⚠",
  STREET_LIGHT:        "💡",
  PEDESTRIAN_RISK:     "🚷",
  DEFAULT:             "📍",
};

export default function MapPage() {
  const mapRef          = useRef<HTMLDivElement>(null);
  const mapInstanceRef  = useRef<Leaflet.Map | null>(null);
  const markersRef      = useRef<(Leaflet.Marker | Leaflet.Polyline | Leaflet.CircleMarker)[]>([]);
  const routeLayersRef  = useRef<Leaflet.Polyline[]>([]);

  const [events,       setEvents]       = useState<Event[]>([]);
  const [issues,       setIssues]       = useState<Issue[]>([]);
  const [buses,        setBuses]        = useState<Bus[]>([]);
  const [busLocations, setBusLocations] = useState<BusLocation[]>([]);
  const [routes,       setRoutes]       = useState<RouteResponse[]>([]);

  const [activeLayer,   setActiveLayer]   = useState<"events" | "issues" | "buses">("issues");
  const [showRoutes,    setShowRoutes]    = useState(true);
  const [mapReady,      setMapReady]      = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [zoom,          setZoom]          = useState(12);

  const snapPrecision = zoom >= 15 ? 4 : zoom >= 13 ? 3 : 2;

  // ── 1. Init Leaflet map ──────────────────────────────────────────────────
  useEffect(() => {
    const initMap = async () => {
      if (typeof window === "undefined") return;
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (!mapRef.current || mapInstanceRef.current) return;

      const map = L.map(mapRef.current, { zoomControl: true }).setView([18.53, 73.855], 12);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      map.on("zoomend", () => {
        setZoom(map.getZoom());
      });

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

  // ── 2. Fetch data ─────────────────────────────────────────────────────────
  const fetchMapData = useCallback(() => {
    api.getEvents({ limit: "1000" }).then((r) => setEvents(r.events)).catch(() => {});
    api.getIssues({ limit: "1000" }).then((r) => setIssues(r.issues)).catch(() => {});
    api.getBuses().then(setBuses).catch(() => {});
    api.getBusLocations().then(setBusLocations).catch(() => {});
    api.getRoutes().then(setRoutes).catch(() => {});
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    fetchMapData();
    const interval = setInterval(() => {
      api.getBusLocations().then(setBusLocations).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [mapReady, fetchMapData]);

  // ── 3. Draw route polylines ───────────────────────────────────────────────
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    let cancelled = false;

    (async () => {
      const L = await import("leaflet");
      if (cancelled || !mapInstanceRef.current) return;
      const map = mapInstanceRef.current;

      // Remove old route layers
      routeLayersRef.current.forEach((l) => map.removeLayer(l));
      routeLayersRef.current = [];

      if (!showRoutes) return;

      routes.forEach((route, idx) => {
        const stops = route.stops as RouteStop[] | undefined;
        if (!stops || !Array.isArray(stops) || stops.length < 2) return;

        const colour = ROUTE_PALETTE[idx % ROUTE_PALETTE.length];
        const label  = ROUTE_LABEL[route.route_name] || route.route_name;
        const latlngs = stops.map((s) => [s.lat, s.lon] as [number, number]);
        const isSelected = selectedRoute === route.route_name || selectedRoute === null;

        // Polyline
        const polyline = L.polyline(latlngs, {
          color:   colour,
          weight:  isSelected ? 5 : 3,
          opacity: isSelected ? 0.9 : 0.4,
          dashArray: isSelected ? undefined : "6 4",
        })
          .addTo(map)
          .bindTooltip(label, { permanent: false, sticky: true });

        routeLayersRef.current.push(polyline);

        // Stop markers (small circles)
        stops.forEach((stop, si) => {
          const isTerminus = si === 0 || si === stops.length - 1;
          const circle = L.circleMarker([stop.lat, stop.lon], {
            radius:      isTerminus ? 7 : 4,
            fillColor:   colour,
            color:       "#fff",
            weight:      2,
            opacity:     isSelected ? 1 : 0.35,
            fillOpacity: isSelected ? 0.95 : 0.35,
          })
            .addTo(map)
            .bindPopup(
              `<div style="font-family:system-ui;min-width:140px">
                <b style="font-size:12px;color:#111">${stop.name}</b><br/>
                <span style="font-size:10px;color:#555">Route: ${label}</span><br/>
                <span style="font-size:10px;color:#888">${stop.lat.toFixed(4)}, ${stop.lon.toFixed(4)}</span>
              </div>`
            );

          routeLayersRef.current.push(circle as unknown as Leaflet.Polyline);
        });
      });
    })();

    return () => { cancelled = true; };
  }, [routes, showRoutes, selectedRoute, mapReady]);

  // ── 4. Draw issue / event / bus markers ──────────────────────────────────
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    let cancelled = false;

    (async () => {
      const L = await import("leaflet");
      if (cancelled || !mapInstanceRef.current) return;
      const map = mapInstanceRef.current;

      markersRef.current.forEach((m) => map.removeLayer(m));
      markersRef.current = [];

      // ── Events ──
      if (activeLayer === "events") {
        groupBySpot(events, snapPrecision).forEach((g) => {
          const color = SEVERITY_COLORS[topSeverity(g.items)] || "#888";
          const count = g.items.length;
          const html =
            count === 1
              ? `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);"></div>`
              : `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:bold;">${count}</div>`;
          const icon = L.divIcon({ className: "custom-marker", html, iconSize: count === 1 ? [14, 14] : [22, 22], iconAnchor: count === 1 ? [7, 7] : [11, 11] });
          const title = count === 1 ? g.items[0].event_type : `${count} events`;
          const popupRows = g.items.slice(0, 8).map((e) =>
            `<div style="font-size:10px;border-top:1px solid #eee;padding-top:3px;margin-top:3px;">
              <b>${e.event_type}</b> <span style="color:#888">${e.event_id}</span><br/>
              Confidence: ${(e.confidence * 100).toFixed(0)}% · Severity: ${e.severity}<br/>
              <span style="color:#999">${new Date(e.created_at).toLocaleString()}</span>
            </div>`
          ).join("");
          const marker = L.marker([g.lat, g.lon], { icon }).addTo(map).bindPopup(
            `<div style="min-width:200px"><b style="font-size:12px">${title}</b>${popupRows}${g.items.length > 8 ? `<div style="font-size:10px;color:#888;margin-top:3px;">… +${g.items.length - 8} more</div>` : ""}</div>`
          );
          markersRef.current.push(marker);
        });
      }

      // ── Issues ──
      if (activeLayer === "issues") {
        groupBySpot(issues, snapPrecision).forEach((g) => {
          const topItem = g.items[0];
          const statusColor = STATUS_COLORS[topItem.status] || "#888";
          const sevColor    = SEVERITY_COLORS[topSeverity(g.items)] || "#888";
          const count       = g.items.length;
          const emoji       = ISSUE_ICON[topItem.issue_type] || ISSUE_ICON.DEFAULT;

          // Build a shaped marker with colored border by status & emoji icon
          const size = count === 1 ? 26 : 30;
          const badge = count > 1 ? `<div style="position:absolute;top:-6px;right:-6px;background:#ef4444;color:white;border-radius:50%;width:14px;height:14px;font-size:8px;font-weight:bold;display:flex;align-items:center;justify-content:center;border:1.5px solid white">${count}</div>` : "";
          const html = `<div style="position:relative;width:${size}px;height:${size}px;border-radius:6px;background:${sevColor}22;border:2.5px solid ${statusColor};box-shadow:0 2px 6px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;font-size:${count === 1 ? 14 : 12}px;">${emoji}${badge}</div>`;

          const icon = L.divIcon({ className: "custom-marker", html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

          const popupRows = g.items.slice(0, 8).map((i) =>
            `<div style="font-size:10px;border-top:1px solid #eee;padding-top:4px;margin-top:4px;">
              <b style="color:${STATUS_COLORS[i.status] || '#333'}">${i.status}</b> — <b>${i.issue_type.replaceAll("_"," ")}</b><br/>
              <span style="color:#555">${i.issue_id}</span> · Dept: ${i.department || "N/A"}<br/>
              Severity: <b style="color:${SEVERITY_COLORS[i.severity] || '#333'}">${i.severity}</b> · Obs: ${i.observation_count}<br/>
              ${(i as any).metadata_json?.title ? `<span style="color:#888;font-style:italic">${(i as any).metadata_json.title}</span><br/>` : ""}
              <a href="/issues/${i.id}" style="color:#3b82f6;font-weight:600">View Details →</a>
            </div>`
          ).join("");

          const marker = L.marker([g.lat, g.lon], { icon }).addTo(map).bindPopup(
            `<div style="min-width:220px;font-family:system-ui">
              <b style="font-size:12px">${count === 1 ? topItem.issue_type.replaceAll("_"," ") : `${count} issues at this spot`}</b>
              ${popupRows}
              ${g.items.length > 8 ? `<div style="font-size:10px;color:#888;margin-top:3px;">… +${g.items.length - 8} more</div>` : ""}
            </div>`
          );
          markersRef.current.push(marker);
        });
      }

      // ── Buses ──
      if (activeLayer === "buses") {
        busLocations.forEach((b) => {
          if (b.latitude === null || b.longitude === null) return;
          const icon = L.divIcon({
            className: "custom-marker",
            html: `<div style="width:24px;height:24px;border-radius:50%;background:#2563eb;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:white;font-family:system-ui">BUS</div>`,
            iconSize: [24, 24], iconAnchor: [12, 12],
          });
          const isSimulated = b.source === "SIMULATED";
          const speedLabel = b.speed != null ? `${b.speed.toFixed(1)} km/h` : "N/A";
          const headingLabel = b.heading != null ? `${b.heading.toFixed(0)}°` : "N/A";
          const timeLabel = b.last_updated ? new Date(b.last_updated).toLocaleTimeString() : "N/A";
          const marker = L.marker([b.latitude, b.longitude], { icon }).addTo(map).bindPopup(
            `<div style="min-width:190px;font-family:system-ui">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                <b style="font-size:13px;color:#111">${b.bus_number}</b>
                <span style="font-size:9px;padding:2px 6px;border-radius:4px;background:${b.status === "ACTIVE" ? "#22c55e20" : "#ef444420"};color:${b.status === "ACTIVE" ? "#16a34a" : "#dc2626"};font-weight:600">${b.status}</span>
              </div>
              <div style="font-size:10px;color:#555;line-height:1.6">
                <div><b>GPS:</b> ${b.latitude.toFixed(4)}, ${b.longitude.toFixed(4)}</div>
                <div><b>Speed:</b> ${speedLabel} | <b>Heading:</b> ${headingLabel}</div>
                <div><b>Last Update:</b> ${timeLabel}</div>
                <div style="margin-top:4px;padding-top:4px;border-top:1px solid #eee">
                  <b>Source:</b> <span style="color:${isSimulated ? "#d97706" : "#2563eb"};font-weight:600">${b.source || "N/A"}</span>
                </div>
              </div>
            </div>`
          );
          markersRef.current.push(marker);
        });
      }
    })();

    return () => { cancelled = true; };
  }, [events, issues, busLocations, activeLayer, mapReady]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const busesWithGPS    = busLocations.filter((b) => b.latitude !== null);
  const busesWithoutGPS = busLocations.filter((b) => b.latitude === null);

  const openIssues     = issues.filter((i) => i.status === "OPEN").length;
  const inProgressIssues = issues.filter((i) => i.status === "IN_PROGRESS" || i.status === "ASSIGNED").length;
  const resolvedIssues = issues.filter((i) => i.status === "RESOLVED").length;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">GIS Command Center</h1>
          <p className="text-sm text-gray-500">
            {routes.length} corridors · {issues.length} issues · {events.length} events across Pune
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button
            onClick={() => setShowRoutes((v) => !v)}
            className={`text-[10px] px-3 py-1.5 rounded border transition-colors ${
              showRoutes
                ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/30"
                : "bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-600"
            }`}
          >
            Routes: {showRoutes ? "Enabled" : "Disabled"}
          </button>
          {(["events", "issues", "buses"] as const).map((layer) => (
            <button
              key={layer}
              onClick={() => setActiveLayer(layer)}
              className={`text-[10px] px-3 py-1.5 rounded border transition-colors ${
                activeLayer === layer
                  ? "bg-blue-600 text-white border-blue-700"
                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
              }`}
            >
              {layer === "events" && "Raw Events"}
              {layer === "issues" && "Road Issues"}
              {layer === "buses"  && "Transit Fleet"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4">
        {/* Map */}
        <div className="flex-1">
          <div ref={mapRef} className="h-[640px] rounded-lg overflow-hidden border border-gray-800" />
        </div>

        {/* Sidebar */}
        <div className="w-72 space-y-3">

          {/* Issue status */}
          <Card>
            <CardHeader><span className="text-xs text-gray-400">Issue Status</span></CardHeader>
            <div className="p-3 space-y-1.5 text-[10px]">
              <div className="flex justify-between">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />Open</span>
                <span className="text-red-400 font-semibold">{openIssues}</span>
              </div>
              <div className="flex justify-between">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block" />In Progress / Assigned</span>
                <span className="text-blue-400 font-semibold">{inProgressIssues}</span>
              </div>
              <div className="flex justify-between">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" />Resolved</span>
                <span className="text-green-400 font-semibold">{resolvedIssues}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-gray-800">
                <span className="text-gray-500">Total Issues</span>
                <span className="text-gray-300 font-semibold">{issues.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Events Detected</span>
                <span className="text-gray-300">{events.length}</span>
              </div>
            </div>
          </Card>

          {/* Route corridors */}
          <Card>
            <CardHeader>
              <span className="text-xs text-gray-400">Corridors — click to focus</span>
            </CardHeader>
            <div className="p-3 space-y-1.5">
              <button
                onClick={() => setSelectedRoute(null)}
                className={`w-full text-left text-[10px] px-2 py-1 rounded transition-colors ${
                  selectedRoute === null
                    ? "bg-gray-700 text-gray-100"
                    : "text-gray-400 hover:bg-gray-800"
                }`}
              >
                All corridors
              </button>
              {routes.map((r, idx) => {
                const colour = ROUTE_PALETTE[idx % ROUTE_PALETTE.length];
                const label  = ROUTE_LABEL[r.route_name] || r.route_name;
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRoute(selectedRoute === r.route_name ? null : r.route_name)}
                    className={`w-full text-left flex items-center gap-2 text-[10px] px-2 py-1.5 rounded transition-colors ${
                      selectedRoute === r.route_name
                        ? "bg-gray-700 text-gray-100"
                        : "text-gray-400 hover:bg-gray-800"
                    }`}
                  >
                    <span style={{ background: colour }} className="w-3 h-1.5 rounded-full flex-shrink-0 inline-block" />
                    <span className="truncate">{label}</span>
                    <span className="ml-auto text-[9px] text-gray-600">{r.distance_km?.toFixed(1)} km</span>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Legend */}
          <Card>
            <CardHeader><span className="text-xs text-gray-400">Legend</span></CardHeader>
            <div className="p-3 space-y-1.5 text-[10px]">
              <div className="text-gray-500 font-semibold mb-1">Severity</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-red-500" />Critical</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-orange-500" />High</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-yellow-500" />Medium</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-green-500" />Low / Resolved</div>
              <div className="text-gray-500 font-semibold mt-2 mb-1">Issue Icons</div>
              {Object.entries(ISSUE_ICON).filter(([k]) => k !== "DEFAULT").slice(0, 6).map(([k, emoji]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="text-base leading-none">{emoji}</span>
                  <span className="text-gray-400">{k.replaceAll("_"," ")}</span>
                </div>
              ))}
              <div className="text-gray-500 font-semibold mt-2 mb-1">Border = Status</div>
              {Object.entries(STATUS_COLORS).slice(0, 5).map(([s, c]) => (
                <div key={s} className="flex items-center gap-2">
                  <span style={{ borderColor: c }} className="w-3 h-3 rounded border-2 bg-transparent" />
                  <span className="text-gray-400">{s.replaceAll("_"," ")}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Fleet */}
          <Card>
            <CardHeader><span className="text-xs text-gray-400">Fleet GPS Status</span></CardHeader>
            <div className="p-3 space-y-1.5">
              {busLocations.map((b) => (
                <div key={b.bus_id} className="flex items-center justify-between text-[10px] border-b border-gray-800/60 pb-1.5 last:border-0 last:pb-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${b.latitude !== null ? "bg-cyan-400" : "bg-gray-600"}`} />
                    <span className="text-gray-300 font-medium">{b.bus_number}</span>
                  </div>
                  <div className="text-right">
                    {b.latitude !== null ? (
                      <span className="text-cyan-400 font-mono">{b.latitude.toFixed(3)}, {b.longitude?.toFixed(3)}</span>
                    ) : (
                      <span className="text-gray-500 italic">No GPS Fix</span>
                    )}
                  </div>
                </div>
              ))}
              {busLocations.length === 0 && (
                <p className="text-[10px] text-gray-600">No fleet data — start the edge pipeline</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
