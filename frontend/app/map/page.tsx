"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import type * as Leaflet from "leaflet";
import { api } from "@/lib/api";
import { Event, Issue, Bus, BusLocation, RouteResponse, RouteStop, RoadChunk, RoadChunksSummary } from "@/types";
import { Card, CardHeader } from "@/components/ui/Card";
import Link from "next/link";

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
  const chunkPolylinesRef = useRef<Map<string, Leaflet.Polyline>>(new Map());

  const [events,        setEvents]        = useState<Event[]>([]);
  const [issues,        setIssues]        = useState<Issue[]>([]);
  const [buses,         setBuses]         = useState<Bus[]>([]);
  const [busLocations,  setBusLocations]  = useState<BusLocation[]>([]);
  const [routes,        setRoutes]        = useState<RouteResponse[]>([]);
  const [roadChunks,    setRoadChunks]    = useState<RoadChunk[]>([]);
  const [chunksSummary, setChunksSummary] = useState<RoadChunksSummary | null>(null);
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
  const [mapChunkSearch, setMapChunkSearch] = useState<string>("");
  const [selectedManifestChunkId, setSelectedManifestChunkId] = useState<string | null>(null);
  const [manifestData, setManifestData] = useState<any | null>(null);
  const [manifestLoading, setManifestLoading] = useState<boolean>(false);
  const [dispatchMessage, setDispatchMessage] = useState<string | null>(null);

  const [activeLayer,   setActiveLayer]   = useState<"events" | "issues" | "chunks" | "buses">("issues");
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
    api.getChunks().then((r) => setRoadChunks(r.chunks)).catch(() => {});
    api.getChunksSummary().then(setChunksSummary).catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const chunkParam = params.get("chunk");
      if (chunkParam) {
        setActiveLayer("chunks");
        setSelectedChunkId(chunkParam);
      }
    }
  }, []);

  useEffect(() => {
    fetchMapData();
  }, [fetchMapData]);

  // Load manifest when chunk selected for inspection
  useEffect(() => {
    if (!selectedManifestChunkId) {
      setManifestData(null);
      return;
    }
    setManifestLoading(true);
    api.getChunkManifest(selectedManifestChunkId)
      .then(setManifestData)
      .catch(() => setManifestData(null))
      .finally(() => setManifestLoading(false));
  }, [selectedManifestChunkId]);

  // Global window functions for popup interactive buttons
  useEffect(() => {
    (window as any).__dispatchChunk = async (chunkId: string) => {
      try {
        const res = await api.dispatchChunk(chunkId);
        setDispatchMessage(`✅ ${res.message} (Work Order: ${res.work_order_id})`);
        fetchMapData();
        setTimeout(() => setDispatchMessage(null), 6000);
      } catch (e: any) {
        setDispatchMessage(`⚠️ Dispatch failed: ${e?.message || e}`);
        setTimeout(() => setDispatchMessage(null), 6000);
      }
    };
    (window as any).__viewChunkManifest = (chunkId: string) => {
      setSelectedManifestChunkId(chunkId);
    };
    return () => {
      delete (window as any).__dispatchChunk;
      delete (window as any).__viewChunkManifest;
    };
  }, [fetchMapData]);

  useEffect(() => {
    if (!mapReady) return;
    const interval = setInterval(() => {
      api.getBusLocations().then(setBusLocations).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [mapReady]);

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
      chunkPolylinesRef.current.clear();

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

      // ── 500m Road Chunks ──
      if (activeLayer === "chunks") {
        const visibleChunks = selectedRoute
          ? roadChunks.filter((c) => c.corridor_id === selectedRoute)
          : roadChunks;

        visibleChunks.forEach((chunk) => {
          const isSelected = selectedChunkId === chunk.chunk_id;
          let color = "#10b981"; // Good (PCI >= 75)
          if (chunk.health_score < 50) {
            color = "#ef4444"; // Critical Hotspot
          } else if (chunk.health_score < 75) {
            color = "#f59e0b"; // Fair / Degraded
          }

          // 500m polyline
          const polyline = L.polyline(chunk.polyline, {
            color,
            weight: isSelected ? 8 : 5,
            opacity: isSelected ? 1.0 : 0.85,
          }).addTo(map);

          polyline.bindTooltip(
            `<div style="font-family:system-ui">
              <b>${chunk.chunk_id}</b> · ${chunk.chainage}<br/>
              <span style="color:${color};font-weight:bold">PCI Health: ${chunk.health_score}/100</span> · ${chunk.active_issues_count} defects
            </div>`,
            { sticky: true }
          );

          polyline.on("click", () => {
            setSelectedChunkId(chunk.chunk_id);
          });
          chunkPolylinesRef.current.set(chunk.chunk_id, polyline);

          // Defect breakdown badges
          const defectBadges = Object.entries(chunk.issue_types || {})
            .map(([type, cnt]) => `<span style="font-size:9px;background:#f1f5f9;color:#334155;padding:2px 5px;border-radius:4px;border:1px solid #cbd5e1;font-weight:600">${type.replace(/_/g," ")}: ${cnt}</span>`)
            .join(" ");

          const previewList = (chunk.issues_preview || []).slice(0, 4).map((iss) =>
            `<div style="font-size:10px;padding:3px 0;border-top:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;">
              <span style="font-weight:600;color:#1e293b">${iss.issue_id}</span>
              <span style="color:${SEVERITY_COLORS[iss.severity] || '#64748b'};font-weight:bold;font-size:9px;">${iss.severity}</span>
            </div>`
          ).join("");

          const popupContent = `
            <div style="min-width:240px;font-family:system-ui;padding:2px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <b style="font-size:13px;color:#0f172a;font-family:monospace">${chunk.chunk_id}</b>
                <span style="font-size:9px;font-weight:bold;padding:2px 6px;border-radius:9999px;background:${color}20;color:${color};border:1px solid ${color}">
                  ${chunk.status} · PCI ${chunk.health_score}
                </span>
              </div>
              <div style="font-size:11px;font-weight:600;color:#334155;margin-bottom:2px">${chunk.chunk_name}</div>
              <div style="font-size:10px;color:#64748b;margin-bottom:6px">Chainage: <b>${chunk.chainage}</b> (500m segment) · Ward: ${chunk.ward}</div>
              
              <div style="margin-bottom:6px;background:#f8fafc;padding:5px;border-radius:6px;border:1px solid #e2e8f0;">
                <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px">
                  <span style="color:#64748b">Pavement Condition:</span>
                  <b style="color:${color}">${chunk.health_score}/100</b>
                </div>
                <div style="height:5px;width:100%;background:#e2e8f0;border-radius:3px;overflow:hidden">
                  <div style="height:100%;width:${chunk.health_score}%;background:${color}"></div>
                </div>
              </div>

              <div style="font-size:10px;color:#475569;margin-bottom:4px">
                <b>${chunk.active_issues_count}</b> active defects detected in this 500m segment
              </div>
              ${defectBadges ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px">${defectBadges}</div>` : ""}
              ${previewList ? `<div style="margin-bottom:8px">${previewList}</div>` : ""}

              <div style="display:flex;flex-direction:column;gap:4px;margin-top:6px;">
                <a href="/issues?chunk=${chunk.chunk_id}" style="display:block;text-align:center;background:#2563eb;color:white;text-decoration:none;font-size:10px;font-weight:bold;padding:5px 8px;border-radius:5px">
                  Filter All Issues in This Chunk →
                </a>
                ${chunk.active_issues_count > 0 ? `
                  <button onclick="window.__dispatchChunk('${chunk.chunk_id}')" style="background:#059669;color:white;border:none;font-size:10px;font-weight:bold;padding:5px 8px;border-radius:5px;cursor:pointer">
                    ⚡ Dispatch Remediation Work Order
                  </button>
                ` : ''}
                <button onclick="window.__viewChunkManifest('${chunk.chunk_id}')" style="background:#475569;color:white;border:none;font-size:10px;font-weight:bold;padding:5px 8px;border-radius:5px;cursor:pointer">
                  📋 Engineering Pavement Manifest
                </button>
              </div>
            </div>
          `;
          polyline.bindPopup(popupContent);
          markersRef.current.push(polyline);

          // If defects exist, put a pill/pin marker at the chunk center
          if (chunk.active_issues_count > 0) {
            const markerHtml = `
              <div style="background:${color};color:white;border:2px solid white;border-radius:12px;padding:2px 6px;font-size:10px;font-weight:800;font-family:system-ui;box-shadow:0 2px 5px rgba(0,0,0,0.4);display:flex;align-items:center;gap:3px;white-space:nowrap;cursor:pointer">
                <span>⚠️</span>
                <span>${chunk.active_issues_count}</span>
              </div>
            `;
            const icon = L.divIcon({
              className: "chunk-marker",
              html: markerHtml,
              iconSize: [40, 20],
              iconAnchor: [20, 10],
            });
            const centerMarker = L.marker([chunk.center_lat, chunk.center_lon], { icon })
              .addTo(map)
              .bindPopup(popupContent);
            markersRef.current.push(centerMarker);
          }
        });

        // If a chunk is selected, zoom/pan to it and open its popup
        if (selectedChunkId) {
          const target = roadChunks.find((c) => c.chunk_id === selectedChunkId);
          if (target) {
            map.flyTo([target.center_lat, target.center_lon], 16, { animate: true });
            const poly = chunkPolylinesRef.current.get(selectedChunkId);
            if (poly) {
              poly.openPopup([target.center_lat, target.center_lon]);
            }
          }
        }
      }
    })();

    return () => { cancelled = true; };
  }, [events, issues, busLocations, roadChunks, activeLayer, selectedRoute, selectedChunkId, mapReady]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const busesWithGPS    = busLocations.filter((b) => b.latitude !== null);
  const busesWithoutGPS = busLocations.filter((b) => b.latitude === null);

  const openIssues     = issues.filter((i) => i.status === "OPEN").length;
  const inProgressIssues = issues.filter((i) => i.status === "IN_PROGRESS" || i.status === "ASSIGNED").length;
  const resolvedIssues = issues.filter((i) => i.status === "RESOLVED").length;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">GIS Command Center</h1>
          <p className="text-sm text-slate-500 font-medium">
            {routes.length} corridors · {issues.length} issues · {events.length} events across Pune
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Quick 500m Chunk Search */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search 500m Chunk..."
              value={mapChunkSearch}
              onChange={(e) => setMapChunkSearch(e.target.value)}
              className="text-[10px] bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 font-medium w-44 shadow-2xs"
            />
            {mapChunkSearch && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-xl z-50 max-h-56 overflow-y-auto">
                {roadChunks
                  .filter((c) =>
                    c.chunk_id.toLowerCase().includes(mapChunkSearch.toLowerCase()) ||
                    c.chunk_name.toLowerCase().includes(mapChunkSearch.toLowerCase()) ||
                    c.corridor_name.toLowerCase().includes(mapChunkSearch.toLowerCase())
                  )
                  .slice(0, 8)
                  .map((c) => (
                    <button
                      key={c.chunk_id}
                      onClick={() => {
                        setActiveLayer("chunks");
                        setSelectedChunkId(c.chunk_id);
                        setMapChunkSearch("");
                        if (mapInstanceRef.current) {
                          mapInstanceRef.current.flyTo([c.center_lat, c.center_lon], 16);
                          const poly = chunkPolylinesRef.current.get(c.chunk_id);
                          if (poly) poly.openPopup([c.center_lat, c.center_lon]);
                        }
                      }}
                      className="w-full text-left p-2 hover:bg-slate-50 border-b border-slate-100 last:border-0 text-[10px] cursor-pointer"
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-mono font-bold text-blue-700">{c.chunk_id}</span>
                        <span className={`px-1.5 py-0.2 rounded text-[8px] font-bold ${c.health_score < 50 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          PCI {c.health_score}
                        </span>
                      </div>
                      <div className="text-[9px] text-slate-600 truncate">{c.chunk_name}</div>
                      <div className="text-[8px] text-slate-400 font-mono">{c.chainage} · {c.active_issues_count} defects</div>
                    </button>
                  ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setShowRoutes((v) => !v)}
            className={`text-[10px] px-3 py-1.5 rounded border transition-colors ${
              showRoutes
                ? "bg-indigo-500/20 text-indigo-700 border-indigo-400 font-semibold"
                : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50 font-medium"
            }`}
          >
            Routes: {showRoutes ? "Enabled" : "Disabled"}
          </button>
          {(["events", "issues", "chunks", "buses"] as const).map((layer) => (
            <button
              key={layer}
              id={`layer-btn-${layer}`}
              onClick={() => setActiveLayer(layer)}
              className={`text-[10px] px-3 py-1.5 rounded border transition-colors ${
                activeLayer === layer
                  ? "bg-blue-600 text-white border-blue-700 font-bold shadow-sm"
                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50 font-medium"
              }`}
            >
              {layer === "events" && "Raw Events"}
              {layer === "issues" && "Road Issues"}
              {layer === "chunks" && `500m Road Chunks (${roadChunks.length > 0 ? roadChunks.length : 206})`}
              {layer === "buses"  && "Transit Fleet"}
            </button>
          ))}
        </div>
      </div>

      {/* Dispatch Success Alert */}
      {dispatchMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-4 py-2.5 rounded-lg flex items-center justify-between shadow-xs">
          <span className="font-semibold">{dispatchMessage}</span>
          <button onClick={() => setDispatchMessage(null)} className="text-emerald-700 hover:text-emerald-900 text-xs cursor-pointer font-bold">✕</button>
        </div>
      )}

      {/* Highway Linear Chainage Ribbon */}
      {activeLayer === "chunks" && (
        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5 font-mono">
                <span>🛣</span>
                <span>LINEAR HIGHWAY CHAINAGE STRIP</span>
              </span>
              <span className="text-[10px] text-slate-500 font-medium">
                {selectedRoute ? `Corridor: ${ROUTE_LABEL[selectedRoute] || selectedRoute}` : "All Corridors (206 Chunks)"} · Click any 500m segment to fly & inspect
              </span>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-medium text-slate-600">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-500 inline-block" /> Good (&ge;75)</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-500 inline-block" /> Fair (50-74)</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-500 inline-block" /> Critical (&lt;50)</span>
            </div>
          </div>

          {/* Horizontal Scrollable Ribbon */}
          <div className="flex gap-1 overflow-x-auto pb-1 pt-0.5 scrollbar-thin">
            {(selectedRoute ? roadChunks.filter((c) => c.corridor_id === selectedRoute) : roadChunks).map((chk) => {
              let bg = "bg-emerald-500 hover:bg-emerald-600";
              if (chk.health_score < 50) bg = "bg-red-500 hover:bg-red-600";
              else if (chk.health_score < 75) bg = "bg-amber-500 hover:bg-amber-600";
              const isSelected = selectedChunkId === chk.chunk_id;

              return (
                <button
                  key={chk.chunk_id}
                  title={`${chk.chunk_id} · ${chk.chainage}\nPCI: ${chk.health_score}/100 | ${chk.active_issues_count} defects\n${chk.chunk_name}`}
                  onClick={() => {
                    setSelectedChunkId(chk.chunk_id);
                    if (mapInstanceRef.current) {
                      mapInstanceRef.current.flyTo([chk.center_lat, chk.center_lon], 16);
                      const poly = chunkPolylinesRef.current.get(chk.chunk_id);
                      if (poly) poly.openPopup([chk.center_lat, chk.center_lon]);
                    }
                  }}
                  className={`flex-shrink-0 h-9 w-11 rounded flex flex-col items-center justify-center text-[8px] font-mono text-white transition-all cursor-pointer relative ${bg} ${
                    isSelected ? "ring-2 ring-blue-600 scale-105 z-10 shadow-md font-bold" : "opacity-90 hover:opacity-100"
                  }`}
                >
                  <span className="leading-tight truncate max-w-full px-0.5">
                    {chk.chainage_end_m >= 1000 ? `${(chk.chainage_end_m / 1000).toFixed(1)}k` : `${Math.round(chk.chainage_end_m)}m`}
                  </span>
                  {chk.active_issues_count > 0 && (
                    <span className="text-[7px] font-bold bg-black/40 px-1 rounded-full mt-0.5">
                      {chk.active_issues_count}⚠️
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-4">
        {/* Map */}
        <div className="flex-1">
          <div ref={mapRef} className="h-[640px] rounded-lg overflow-hidden border border-slate-200 shadow-sm" />
        </div>

        {/* Sidebar */}
        <div className="w-72 space-y-3">

          {/* 500m Road Chunks System Card (when activeLayer is chunks) */}
          {activeLayer === "chunks" && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between w-full">
                  <span className="text-xs text-slate-900 font-bold flex items-center gap-1.5">
                    <span>🛣</span>
                    <span>500M CHUNKS HEALTH</span>
                  </span>
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200 font-bold">
                    {roadChunks.length} Chunks
                  </span>
                </div>
              </CardHeader>
              <div className="p-3 space-y-2 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-slate-600 font-medium">Total Network</span>
                  <span className="font-mono text-slate-900 font-bold">
                    {chunksSummary ? `${chunksSummary.total_network_km} km` : "103.0 km"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 font-medium">Average PCI Health</span>
                  <span className="font-mono text-emerald-700 font-bold">
                    {chunksSummary ? `${chunksSummary.average_pci_health}%` : "92.5%"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 font-medium">Active Road Defects</span>
                  <span className="font-mono text-red-600 font-bold">
                    {chunksSummary ? chunksSummary.total_active_defects : issues.length}
                  </span>
                </div>

                <div className="pt-2 border-t border-slate-200">
                  <div className="text-[10px] font-bold text-slate-800 mb-1.5 flex items-center justify-between">
                    <span>Defect Hotspot Chunks</span>
                    <span className="text-[9px] text-red-600 font-medium">Click to inspect</span>
                  </div>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {roadChunks
                      .filter((c) => c.active_issues_count > 0)
                      .sort((a, b) => a.health_score - b.health_score)
                      .slice(0, 6)
                      .map((chk) => {
                        const isSelected = selectedChunkId === chk.chunk_id;
                        return (
                          <div
                            key={chk.chunk_id}
                            className={`w-full p-2 rounded-lg transition-all border ${
                              isSelected
                                ? "bg-blue-50 border-blue-500 text-blue-900 shadow-sm ring-1 ring-blue-500"
                                : "bg-white border-slate-200 text-slate-800 hover:bg-slate-50 hover:border-slate-300 shadow-xs"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <button
                                onClick={() => {
                                  setSelectedChunkId(chk.chunk_id);
                                  if (mapInstanceRef.current) {
                                    mapInstanceRef.current.flyTo([chk.center_lat, chk.center_lon], 16);
                                    const poly = chunkPolylinesRef.current.get(chk.chunk_id);
                                    if (poly) poly.openPopup([chk.center_lat, chk.center_lon]);
                                  }
                                }}
                                className="text-left flex-1 truncate mr-2 cursor-pointer"
                              >
                                <div className="font-mono font-bold text-[10px] text-blue-700 flex items-center gap-1">
                                  <span>📍</span>
                                  <span>{chk.chunk_id}</span>
                                </div>
                                <div className="text-[9px] text-slate-700 font-medium truncate">{chk.chunk_name}</div>
                                <div className="text-[8px] text-slate-500 font-mono">{chk.chainage}</div>
                              </button>
                              <div className="text-right flex-shrink-0">
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono bg-red-50 text-red-700 border border-red-200">
                                  PCI {chk.health_score}
                                </span>
                                <div className="text-[8px] text-red-600 mt-0.5 font-bold">{chk.active_issues_count} defects</div>
                              </div>
                            </div>
                            <div className="flex items-center justify-end gap-1.5 mt-1.5 pt-1.5 border-t border-slate-100">
                              <button
                                onClick={() => {
                                  setSelectedChunkId(chk.chunk_id);
                                  if (mapInstanceRef.current) {
                                    mapInstanceRef.current.flyTo([chk.center_lat, chk.center_lon], 16);
                                    const poly = chunkPolylinesRef.current.get(chk.chunk_id);
                                    if (poly) poly.openPopup([chk.center_lat, chk.center_lon]);
                                  }
                                }}
                                className="text-[9px] text-slate-600 hover:text-slate-900 font-medium px-1.5 py-0.5 rounded hover:bg-slate-100 cursor-pointer"
                              >
                                Focus Map
                              </button>
                              <button
                                onClick={() => setSelectedManifestChunkId(chk.chunk_id)}
                                className="text-[9px] text-blue-700 hover:text-blue-900 font-bold px-1.5 py-0.5 rounded bg-blue-100 hover:bg-blue-200 cursor-pointer flex items-center gap-0.5"
                              >
                                <span>📋</span>
                                <span>Manifest</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Issue status (when activeLayer is issues or events) */}
          {activeLayer !== "chunks" && (
            <Card>
              <CardHeader>
                <span className="text-xs text-slate-800 font-bold uppercase tracking-wider">Issue Status</span>
              </CardHeader>
              <div className="p-3 space-y-1.5 text-[10px]">
                <div className="flex justify-between">
                  <span className="flex items-center gap-1.5 text-slate-700 font-medium">
                    <span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />Open
                  </span>
                  <span className="text-red-600 font-bold font-mono">{openIssues}</span>
                </div>
                <div className="flex justify-between">
                  <span className="flex items-center gap-1.5 text-slate-700 font-medium">
                    <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block" />In Progress / Assigned
                  </span>
                  <span className="text-blue-600 font-bold font-mono">{inProgressIssues}</span>
                </div>
                <div className="flex justify-between">
                  <span className="flex items-center gap-1.5 text-slate-700 font-medium">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />Resolved
                  </span>
                  <span className="text-emerald-700 font-bold font-mono">{resolvedIssues}</span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-slate-200">
                  <span className="text-slate-600 font-medium">Total Issues</span>
                  <span className="text-slate-900 font-bold font-mono">{issues.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 font-medium">Events Detected</span>
                  <span className="text-slate-900 font-bold font-mono">{events.length}</span>
                </div>
              </div>
            </Card>
          )}

          {/* Route corridors */}
          <Card>
            <CardHeader>
              <span className="text-xs text-slate-800 font-bold uppercase tracking-wider">Corridors — click to focus</span>
            </CardHeader>
            <div className="p-3 space-y-1.5">
              <button
                onClick={() => setSelectedRoute(null)}
                className={`w-full text-left text-[10px] px-2.5 py-1.5 rounded transition-all cursor-pointer ${
                  selectedRoute === null
                    ? "bg-blue-50 text-blue-900 font-bold border border-blue-300"
                    : "text-slate-700 hover:bg-slate-100 font-medium border border-transparent"
                }`}
              >
                All corridors
              </button>
              {routes.map((r, idx) => {
                const colour = ROUTE_PALETTE[idx % ROUTE_PALETTE.length];
                const label  = ROUTE_LABEL[r.route_name] || r.route_name;
                const isSelected = selectedRoute === r.route_name;
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRoute(isSelected ? null : r.route_name)}
                    className={`w-full text-left flex items-center gap-2 text-[10px] px-2.5 py-1.5 rounded transition-all cursor-pointer ${
                      isSelected
                        ? "bg-blue-50 text-blue-900 font-bold border border-blue-300 shadow-2xs"
                        : "text-slate-700 hover:bg-slate-100 font-medium border border-transparent"
                    }`}
                  >
                    <span style={{ background: colour }} className="w-3 h-1.5 rounded-full flex-shrink-0 inline-block" />
                    <span className="truncate">{label}</span>
                    <span className="ml-auto text-[9px] text-slate-500 font-mono font-medium">{r.distance_km?.toFixed(1)} km</span>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Legend */}
          <Card>
            <CardHeader><span className="text-xs text-slate-800 font-bold uppercase tracking-wider">Legend</span></CardHeader>
            <div className="p-3 space-y-1.5 text-[10px]">
              {activeLayer === "chunks" ? (
                <>
                  <div className="text-slate-800 font-bold mb-1">500m Chunk PCI Health</div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-1.5 rounded bg-emerald-500" />
                    <span className="text-slate-700 font-medium">Clean / Good (PCI 75-100)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-1.5 rounded bg-amber-500" />
                    <span className="text-slate-700 font-medium">Degraded / Fair (PCI 50-74)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-1.5 rounded bg-red-500" />
                    <span className="text-slate-700 font-medium">Critical Hotspot (PCI &lt; 50)</span>
                  </div>
                  <div className="flex items-center gap-2 mt-2 pt-1 border-t border-slate-100">
                    <span className="px-1.5 py-0.5 rounded bg-red-500 text-white font-bold text-[9px]">⚠️ 5</span>
                    <span className="text-slate-600 font-medium">Chunk Defect Count Badge</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-slate-800 font-bold mb-1">Severity</div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-red-500" /><span className="text-slate-700 font-medium">Critical</span></div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-orange-500" /><span className="text-slate-700 font-medium">High</span></div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-yellow-500" /><span className="text-slate-700 font-medium">Medium</span></div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-green-500" /><span className="text-slate-700 font-medium">Low / Resolved</span></div>
                  <div className="text-slate-800 font-bold mt-2 mb-1">Issue Icons</div>
                  {Object.entries(ISSUE_ICON).filter(([k]) => k !== "DEFAULT").slice(0, 6).map(([k, emoji]) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="text-base leading-none">{emoji}</span>
                      <span className="text-slate-700 font-medium">{k.replaceAll("_"," ")}</span>
                    </div>
                  ))}
                  <div className="text-slate-800 font-bold mt-2 mb-1">Border = Status</div>
                  {Object.entries(STATUS_COLORS).slice(0, 5).map(([s, c]) => (
                    <div key={s} className="flex items-center gap-2">
                      <span style={{ borderColor: c }} className="w-3 h-3 rounded border-2 bg-transparent" />
                      <span className="text-slate-700 font-medium">{s.replaceAll("_"," ")}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </Card>

          {/* Fleet */}
          <Card>
            <CardHeader><span className="text-xs text-slate-800 font-bold uppercase tracking-wider">Fleet GPS Status</span></CardHeader>
            <div className="p-3 space-y-1.5">
              {busLocations.map((b) => (
                <div key={b.bus_id} className="flex items-center justify-between text-[10px] border-b border-slate-100 pb-1.5 last:border-0 last:pb-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${b.latitude !== null ? "bg-cyan-500" : "bg-slate-300"}`} />
                    <span className="text-slate-800 font-medium">{b.bus_number}</span>
                  </div>
                  <div className="text-right">
                    {b.latitude !== null ? (
                      <span className="text-blue-700 font-mono font-semibold">{b.latitude.toFixed(3)}, {b.longitude?.toFixed(3)}</span>
                    ) : (
                      <span className="text-slate-400 italic">No GPS Fix</span>
                    )}
                  </div>
                </div>
              ))}
              {busLocations.length === 0 && (
                <p className="text-[10px] text-slate-500">No fleet data — start the edge pipeline</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Engineering Pavement Distress Manifest Modal */}
      {selectedManifestChunkId && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-3">
                <span className="text-xl">📋</span>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900">Engineering Pavement Distress Manifest</h2>
                    <span className="font-mono bg-blue-100 text-blue-800 border border-blue-200 text-xs px-2 py-0.5 rounded font-bold">
                      {selectedManifestChunkId}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium">
                    {manifestData ? `${manifestData.chunk_name} · ${manifestData.ward}` : "Loading chunk stationing details..."}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedManifestChunkId(null)}
                className="w-8 h-8 rounded-full hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors cursor-pointer text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {manifestLoading ? (
                <div className="py-16 text-center space-y-3">
                  <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-xs text-slate-500 font-mono">Aggregating pavement distress consensus & civil estimations...</p>
                </div>
              ) : manifestData ? (
                <>
                  {/* PCI Health Status Card */}
                  <div className={`p-4 rounded-xl border flex items-center justify-between flex-wrap gap-4 ${
                    manifestData.health_score < 50
                      ? "bg-red-50/70 border-red-200 text-red-950"
                      : manifestData.health_score < 75
                      ? "bg-amber-50/70 border-amber-200 text-amber-950"
                      : "bg-emerald-50/70 border-emerald-200 text-emerald-950"
                  }`}>
                    <div className="space-y-1">
                      <div className="text-[10px] font-mono uppercase tracking-wider font-bold opacity-80">
                        Pavement Condition Index (PCI ASTM D6433)
                      </div>
                      <div className="text-3xl font-extrabold font-mono tracking-tight flex items-baseline gap-2">
                        <span>{manifestData.health_score}</span>
                        <span className="text-sm font-normal text-slate-500">/ 100</span>
                        <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold ml-2 ${
                          manifestData.health_score < 50
                            ? "bg-red-200/80 text-red-800"
                            : manifestData.health_score < 75
                            ? "bg-amber-200/80 text-amber-800"
                            : "bg-emerald-200/80 text-emerald-800"
                        }`}>
                          {manifestData.health_score < 50 ? "CRITICAL HOTSPOT" : manifestData.health_score < 75 ? "DEGRADED SURFACE" : "OPTIMAL PAVEMENT"}
                        </span>
                      </div>
                      <div className="text-xs opacity-90 font-medium">
                        Chainage Station: <strong className="font-mono">{manifestData.chainage}</strong> &bull; Ward: <strong>{manifestData.ward}</strong>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-mono text-slate-500 uppercase">Status</div>
                      <div className="text-sm font-bold font-mono uppercase">{manifestData.status}</div>
                    </div>
                  </div>

                  {/* Civil Remediation Engineering Estimates */}
                  <div>
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                      <span>🏗️</span>
                      <span>Civil Remediation Material & Crew Forecast</span>
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <div className="text-[10px] font-mono text-slate-500 uppercase">Hot-Mix Asphalt</div>
                        <div className="text-lg font-bold font-mono text-slate-900 mt-1">
                          {manifestData.remediation_estimates?.asphalt_mix_cum ?? 0} <span className="text-xs font-normal text-slate-500">m³</span>
                        </div>
                        <div className="text-[9px] text-slate-400 mt-0.5">Surface patching mix</div>
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <div className="text-[10px] font-mono text-slate-500 uppercase">Crack Sealant</div>
                        <div className="text-lg font-bold font-mono text-slate-900 mt-1">
                          {manifestData.remediation_estimates?.crack_sealant_meters ?? 0} <span className="text-xs font-normal text-slate-500">m</span>
                        </div>
                        <div className="text-[9px] text-slate-400 mt-0.5">Bituminous hot-pour</div>
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <div className="text-[10px] font-mono text-slate-500 uppercase">Recommended Crew</div>
                        <div className="text-lg font-bold font-mono text-blue-700 mt-1">
                          {manifestData.remediation_estimates?.estimated_crew_size ?? 0} <span className="text-xs font-normal text-slate-500">pers</span>
                        </div>
                        <div className="text-[9px] text-slate-400 mt-0.5">Civil & safety team</div>
                      </div>
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <div className="text-[10px] font-mono text-slate-500 uppercase">Target SLA Window</div>
                        <div className="text-lg font-bold font-mono text-purple-700 mt-1">
                          {manifestData.remediation_estimates?.recommended_sla_hours ?? 24} <span className="text-xs font-normal text-slate-500">hrs</span>
                        </div>
                        <div className="text-[9px] text-slate-400 mt-0.5">Municipal SLA limit</div>
                      </div>
                    </div>
                  </div>

                  {/* Logged Defect Inventory Table */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                        <span>⚠️</span>
                        <span>Logged Pavement Distress Items ({manifestData.defects?.length || 0})</span>
                      </h3>
                      <div className="flex gap-2 text-[10px] font-mono text-slate-500">
                        <span>Potholes: <strong className="text-slate-800">{manifestData.defect_summary?.potholes || 0}</strong></span>
                        <span>&bull;</span>
                        <span>Cracks: <strong className="text-slate-800">{manifestData.defect_summary?.cracks || 0}</strong></span>
                        <span>&bull;</span>
                        <span>Damaged: <strong className="text-slate-800">{manifestData.defect_summary?.damaged_surfaces || 0}</strong></span>
                      </div>
                    </div>

                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100/75 border-b border-slate-200 text-[10px] uppercase font-mono text-slate-600">
                            <th className="py-2.5 px-3">Issue ID</th>
                            <th className="py-2.5 px-3">Defect Type</th>
                            <th className="py-2.5 px-3">Severity</th>
                            <th className="py-2.5 px-3">Confidence</th>
                            <th className="py-2.5 px-3">Status</th>
                            <th className="py-2.5 px-3 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(manifestData.defects || []).length === 0 ? (
                            <tr>
                              <td colSpan={6} className="py-6 text-center text-slate-400 font-mono text-xs">
                                ✨ No open distress defects logged on this 500m road chunk.
                              </td>
                            </tr>
                          ) : (
                            manifestData.defects.map((def: any) => (
                              <tr key={def.id} className="hover:bg-slate-50/70 transition-colors">
                                <td className="py-2.5 px-3 font-mono font-bold text-blue-700">
                                  {def.issue_id || def.id.slice(0, 8)}
                                </td>
                                <td className="py-2.5 px-3 font-medium text-slate-800">
                                  <div className="flex items-center gap-1.5">
                                    <span>{ISSUE_ICON[def.issue_type] || "⚠️"}</span>
                                    <span>{def.issue_type?.replace(/_/g, " ")}</span>
                                  </div>
                                </td>
                                <td className="py-2.5 px-3">
                                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase font-mono ${
                                    def.severity === "CRITICAL"
                                      ? "bg-red-100 text-red-800 border border-red-200"
                                      : def.severity === "HIGH"
                                      ? "bg-orange-100 text-orange-800 border border-orange-200"
                                      : "bg-yellow-100 text-yellow-800 border border-yellow-200"
                                  }`}>
                                    {def.severity}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 font-mono text-slate-600">
                                  {def.confidence ? `${Math.round(def.confidence * 100)}%` : "N/A"}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-[10px]">
                                  <span className={`px-2 py-0.5 rounded font-bold ${
                                    def.status === "RESOLVED"
                                      ? "bg-emerald-100 text-emerald-800"
                                      : def.status === "IN_PROGRESS" || def.status === "ASSIGNED"
                                      ? "bg-blue-100 text-blue-800"
                                      : "bg-amber-100 text-amber-800"
                                  }`}>
                                    {def.status}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  <Link
                                    href={`/issues/${def.id}`}
                                    target="_blank"
                                    className="text-blue-600 hover:text-blue-800 font-semibold hover:underline text-[11px]"
                                  >
                                    Inspect &rarr;
                                  </Link>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <div className="py-12 text-center text-red-600 text-xs">
                  Failed to load engineering manifest for chunk {selectedManifestChunkId}.
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Link
                  href={`/issues?chunk=${selectedManifestChunkId}`}
                  className="text-xs text-blue-700 hover:text-blue-900 font-bold hover:underline flex items-center gap-1"
                >
                  <span>Filter in Issues Desk</span>
                  <span>&rarr;</span>
                </Link>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedManifestChunkId(null)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer border border-slate-300"
                >
                  Close
                </button>
                {manifestData && manifestData.defects?.length > 0 && (
                  <button
                    onClick={async () => {
                      if (!selectedManifestChunkId) return;
                      try {
                        const res = await api.dispatchChunk(selectedManifestChunkId);
                        setDispatchMessage(`✅ ${res.message} (Work Order: ${res.work_order_id})`);
                        fetchMapData();
                        // Refresh manifest
                        api.getChunkManifest(selectedManifestChunkId).then(setManifestData).catch(() => {});
                        setTimeout(() => setDispatchMessage(null), 6000);
                      } catch (e: any) {
                        alert(`Dispatch failed: ${e?.message || e}`);
                      }
                    }}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>⚡ Dispatch Remediation Crew</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
