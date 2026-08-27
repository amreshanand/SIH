"use client";

import { useEffect, useState, useRef } from "react";
import type * as Leaflet from "leaflet";
import { api } from "@/lib/api";
import { Event, Issue, Bus } from "@/types";
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

export default function MapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Leaflet.Map | null>(null);
  const markersRef = useRef<Leaflet.Marker[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [buses, setBuses] = useState<Bus[]>([]);
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

  useEffect(() => {
    if (!mapReady) return;

    api.getEvents().then((r) => setEvents(r.events)).catch(() => {});
    api.getIssues().then((r) => setIssues(r.issues)).catch(() => {});
    api.getBuses().then(setBuses).catch(() => {});
  }, [mapReady]);

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
      events.forEach((e) => {
        const color = SEVERITY_COLORS[e.severity] || "#888";
        const icon = L.divIcon({
          className: "custom-marker",
          html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        const marker = L.marker([e.latitude, e.longitude], { icon })
          .addTo(map)
          .bindPopup(`
            <div style="min-width:180px">
              <b style="font-size:12px">${e.event_type}</b><br/>
              <span style="font-size:10px;color:#888">${e.event_id}</span><br/>
              <span style="font-size:10px">Confidence: ${(e.confidence * 100).toFixed(0)}%</span><br/>
              <span style="font-size:10px">Severity: ${e.severity}</span><br/>
              <span style="font-size:10px">Source: ${e.source}</span><br/>
              <span style="font-size:10px">Time: ${new Date(e.created_at).toLocaleString()}</span>
            </div>
          `);
        markersRef.current.push(marker);
      });
    }

    if (activeLayer === "issues") {
      issues.forEach((i) => {
        const color = STATUS_COLORS[i.status] || "#888";
        const icon = L.divIcon({
          className: "custom-marker",
          html: `<div style="width:18px;height:18px;border-radius:4px;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-size:8px;color:white;font-weight:bold;">▲</div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        const marker = L.marker([i.latitude, i.longitude], { icon })
          .addTo(map)
          .bindPopup(`
            <div style="min-width:200px">
              <b style="font-size:12px">${i.issue_id}</b><br/>
              <span style="font-size:10px;color:#888">${i.issue_type}</span><br/>
              <span style="font-size:10px">Status: ${i.status}</span><br/>
              <span style="font-size:10px">Dept: ${i.department || "N/A"}</span><br/>
              <span style="font-size:10px">Observations: ${i.observation_count}</span><br/>
              <a href="/issues/${i.id}" style="font-size:10px;color:#3b82f6">View Details →</a>
            </div>
          `);
        markersRef.current.push(marker);
      });
    }

    if (activeLayer === "buses") {
      buses.forEach((b) => {
        const icon = L.divIcon({
          className: "custom-marker",
          html: `<div style="width:20px;height:20px;border-radius:50%;background:#06b6d4;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-size:8px;color:white;font-weight:bold;">🚌</div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        });
        const lat = 18.52 + Math.random() * 0.03;
        const lon = 73.85 + Math.random() * 0.04;
        const marker = L.marker([lat, lon], { icon })
          .addTo(map)
          .bindPopup(`
            <div style="min-width:160px">
              <b style="font-size:12px">${b.bus_number}</b><br/>
              <span style="font-size:10px">Status: ${b.status}</span><br/>
              <span style="font-size:10px">Route: ${b.route_id || "Not assigned"}</span>
            </div>
          `);
        markersRef.current.push(marker);
      });
    }
    })();
    return () => {
      cancelled = true;
    };
  }, [events, issues, buses, activeLayer, mapReady]);

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
              <div className="flex items-center gap-2 text-[10px]"><span className="w-3 h-3 rounded-full bg-cyan-500" /> Bus</div>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <span className="text-xs text-gray-400">Stats</span>
            </CardHeader>
            <div className="p-3 space-y-1 text-[10px]">
              <div className="flex justify-between"><span className="text-gray-500">Events</span><span className="text-gray-300">{events.length}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Issues</span><span className="text-gray-300">{issues.length}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Fleet</span><span className="text-gray-300">{buses.length}</span></div>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <span className="text-xs text-gray-400">Filters</span>
            </CardHeader>
            <div className="p-3 space-y-2">
              {["POTHOLE", "WATERLOGGING", "ROAD_CRACK", "INCIDENT"].map((type) => {
                const count = events.filter((e) => e.event_type === type).length;
                return (
                  <div key={type} className="flex items-center justify-between text-[10px]">
                    <span className="text-gray-400">{type.replace("_", " ")}</span>
                    <span className="text-gray-500">{count}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
