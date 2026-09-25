"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import { Bus, BusLocation, RouteResponse } from "@/types";
import { Card, CardHeader, Badge, KpiCard } from "@/components/ui/Card";
import { useWebSocket } from "@/hooks/useWebSocket";

interface ExtendedBusLocation extends BusLocation {
  camera_count?: number;
}

export default function FleetPage() {
  const [buses, setBuses] = useState<Bus[]>([]);
  const [locations, setLocations] = useState<Record<string, ExtendedBusLocation>>({});
  const [routes, setRoutes] = useState<RouteResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [newBusNumber, setNewBusNumber] = useState("");
  const [newRouteId, setNewRouteId] = useState("");
  const [newStatus, setNewStatus] = useState("ACTIVE");
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Ping state
  const [pingingBusId, setPingingBusId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [busList, locList, routeList] = await Promise.all([
        api.getBuses().catch(() => [] as Bus[]),
        api.getBusLocations().catch(() => [] as BusLocation[]),
        api.getRoutes().catch(() => [] as RouteResponse[]),
      ]);

      setBuses(busList);
      setRoutes(routeList);

      const locMap: Record<string, ExtendedBusLocation> = {};
      for (const loc of locList) {
        locMap[loc.bus_id] = loc;
      }

      // Fetch camera counts in parallel
      const cameraPromises = busList.map(async (b) => {
        try {
          const cams = await api.getBusCameras(b.id);
          if (locMap[b.id]) {
            locMap[b.id].camera_count = cams.length;
          }
        } catch {
          // Ignore camera error per bus
        }
      });
      await Promise.all(cameraPromises);

      setLocations({ ...locMap });
    } catch (e) {
      console.error(e);
      setError("Failed to load fleet intelligence");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Real-time telemetry updates via WebSocket
  useWebSocket("buses", (message: unknown) => {
    const payload = message as { type?: string; data?: { bus_id?: string; latitude?: number; longitude?: number; speed?: number; heading?: number; timestamp?: string } };
    if (payload?.type === "telemetry" && payload.data?.bus_id) {
      const d = payload.data;
      setLocations((prev) => {
        const existing = prev[d.bus_id!];
        const updated: ExtendedBusLocation = {
          bus_id: d.bus_id!,
          bus_number: existing?.bus_number || "Bus",
          status: existing?.status || "ACTIVE",
          route_id: existing?.route_id ?? null,
          latitude: d.latitude ?? null,
          longitude: d.longitude ?? null,
          speed: d.speed ?? null,
          heading: d.heading ?? null,
          last_updated: d.timestamp ?? null,
          source: "GPS_TELEMETRY",
          camera_count: existing?.camera_count,
        };
        return {
          ...prev,
          [d.bus_id!]: updated,
        };
      });
    }
  });

  const routeMap = useMemo(() => {
    const map: Record<string, RouteResponse> = {};
    for (const r of routes) {
      map[r.id] = r;
    }
    return map;
  }, [routes]);

  const handleRegisterBus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBusNumber.trim()) return;
    setModalLoading(true);
    setModalError(null);
    try {
      await api.createBus({
        bus_number: newBusNumber.trim(),
        route_id: newRouteId || null,
        status: newStatus,
      });
      setShowModal(false);
      setNewBusNumber("");
      setNewRouteId("");
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to register bus";
      setModalError(msg);
    } finally {
      setModalLoading(false);
    }
  };

  const handleSendTelemetryPing = async (bus: Bus) => {
    setPingingBusId(bus.id);
    try {
      const loc = locations[bus.id];
      // Jitter slightly around current or Pune centre
      const baseLat = loc?.latitude ?? 18.5204;
      const baseLon = loc?.longitude ?? 73.8567;
      const newLat = +(baseLat + (Math.random() - 0.5) * 0.005).toFixed(6);
      const newLon = +(baseLon + (Math.random() - 0.5) * 0.005).toFixed(6);
      const speed = +(30 + Math.random() * 25).toFixed(1);
      const heading = Math.floor(Math.random() * 360);

      await api.postBusTelemetry(bus.id, {
        latitude: newLat,
        longitude: newLon,
        speed,
        heading,
      });
    } catch (err) {
      console.error("Failed to send telemetry ping:", err);
    } finally {
      setPingingBusId(null);
    }
  };

  const activeCount = buses.filter((b) => b.status === "ACTIVE").length;
  const totalCams = Object.values(locations).reduce((sum, l) => sum + (l.camera_count || 0), 0);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Banner / Header */}
      <Card className="p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Transit Fleet &amp; Edge Sensing Units
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Pune PMPML mobile transit edge sensors &bull; Real-time GPS telemetry &bull; Multi-camera streaming units
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={loadData}
              disabled={loading}
              className="text-xs px-3.5 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <span className={loading ? "animate-spin" : ""}>↻</span>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="text-xs px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              <span>+</span>
              <span>Register New Bus</span>
            </button>
          </div>
        </div>
      </Card>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <KpiCard label="Total Fleet Units" value={buses.length} color="blue" />
        <KpiCard label="Active Sensing Units" value={activeCount} color="green" />
        <KpiCard label="Optical Video Feeds" value={totalCams || buses.length * 2} color="cyan" />
        <KpiCard label="Monitored Corridors" value={routes.length} color="amber" />
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium">
          {error}
        </div>
      )}

      {/* Bus Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {buses.map((bus) => {
          const loc = locations[bus.id];
          const route = bus.route_id ? routeMap[bus.route_id] : null;
          const isPinging = pingingBusId === bus.id;
          const isOnline = bus.status === "ACTIVE";

          return (
            <Card
              key={bus.id}
              className="overflow-hidden hover:shadow-md transition-all group"
            >
              <div className="p-3.5 border-b border-slate-200/80 flex items-center justify-between bg-slate-50/80">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isOnline ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
                    }`}
                  />
                  <span className="text-xs font-bold text-slate-900 font-mono tracking-wider">{bus.bus_number}</span>
                </div>
                <Badge text={bus.status} variant={isOnline ? "success" : "default"} />
              </div>

              <div className="p-4 space-y-3.5">
                {/* Route Information */}
                <div>
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold block font-mono">
                    Transit Corridor
                  </span>
                  {route ? (
                    <div className="mt-1">
                      <div className="text-xs font-bold text-blue-700">{route.route_name}</div>
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                        {route.start_stop} &rarr; {route.end_stop}
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400 italic mt-0.5 block">Unassigned Corridor</span>
                  )}
                </div>

                {/* Telemetry Metrics */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
                    <span className="text-[9px] text-slate-500 uppercase font-mono font-bold block">Speed</span>
                    <span className="text-xs font-mono font-bold text-emerald-700 mt-0.5 block">
                      {loc?.speed != null ? `${loc.speed.toFixed(1)} km/h` : "Parked"}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
                    <span className="text-[9px] text-slate-500 uppercase font-mono font-bold block">Heading</span>
                    <span className="text-xs font-mono font-bold text-blue-700 mt-0.5 block">
                      {loc?.heading != null ? `${Math.round(loc.heading)}°` : "N/A"}
                    </span>
                  </div>
                </div>

                {/* Location & Sensor Info */}
                <div className="space-y-1.5 text-[11px] font-mono text-slate-600">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-sans">Position:</span>
                    <span className="text-slate-800 font-semibold">
                      {loc?.latitude != null && loc?.longitude != null
                        ? `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`
                        : "No GPS fix"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-sans">Sensors / Cameras:</span>
                    <span className="text-slate-800 font-semibold">
                      {loc?.camera_count ?? 2} Optical Feeds
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-sans">Source:</span>
                    <span className="text-[10px] text-blue-700 font-bold">
                      {loc?.source || "SENSING_ENGINE"}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-mono">
                    {loc?.last_updated ? new Date(loc.last_updated).toLocaleTimeString() : "Awaiting fix"}
                  </span>
                  <button
                    onClick={() => handleSendTelemetryPing(bus)}
                    disabled={isPinging}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-semibold transition-all disabled:opacity-50 cursor-pointer flex items-center gap-1 shadow-xs"
                  >
                    <span>{isPinging ? "📡" : "⚡"}</span>
                    <span>{isPinging ? "Broadcasting..." : "Ingest Telemetry"}</span>
                  </button>
                </div>
              </div>
            </Card>
          );
        })}

        {buses.length === 0 && !loading && (
          <div className="col-span-3 p-12 text-center text-slate-500 text-xs rounded-xl bg-white border border-slate-200">
            No buses registered in fleet. Click &ldquo;+ Register New Bus&rdquo; to add a unit.
          </div>
        )}
      </div>

      {/* Register Bus Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-600" />
                <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-mono">
                  Register Mobile Sensing Unit
                </h2>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-700 text-xs cursor-pointer font-bold"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div className="m-4 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
                {modalError}
              </div>
            )}

            <form onSubmit={handleRegisterBus} className="p-4 space-y-3.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Bus Registration Number
                </label>
                <input
                  type="text"
                  value={newBusNumber}
                  onChange={(e) => setNewBusNumber(e.target.value)}
                  placeholder="e.g. MH-12-RN-7001"
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 border border-slate-300 text-slate-900 font-mono placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Transit Corridor
                </label>
                <select
                  value={newRouteId}
                  onChange={(e) => setNewRouteId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 border border-slate-300 text-slate-900 font-semibold focus:border-blue-600 focus:bg-white focus:outline-none"
                >
                  <option value="">Unassigned</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.route_name} ({r.start_stop} &rarr; {r.end_stop})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Operational Status
                </label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 border border-slate-300 text-slate-900 font-semibold focus:border-blue-600 focus:bg-white focus:outline-none"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                  <option value="MAINTENANCE">MAINTENANCE</option>
                </select>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalLoading}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs text-white font-bold transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  {modalLoading ? "Registering..." : "Register Bus"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
