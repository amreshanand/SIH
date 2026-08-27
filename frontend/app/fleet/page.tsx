"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Bus } from "@/types";
import { Card, CardHeader, Badge } from "@/components/ui/Card";

export default function FleetPage() {
  const [buses, setBuses] = useState<Bus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getBuses().then(setBuses).catch((e) => { console.error(e); setError("Failed to load fleet"); }).finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Fleet Management</h1>
        <p className="text-sm text-gray-500">All registered buses and their status</p>
      </div>

      {loading && <div className="text-gray-500 text-sm">Loading fleet...</div>}
      {error && <div className="text-red-400 text-sm">{error}</div>}

      <div className="grid grid-cols-3 gap-4">
        {buses.map((bus) => (
          <Card key={bus.id}>
            <CardHeader>
              <span className="text-sm font-medium text-white">{bus.bus_number}</span>
              <Badge text={bus.status} variant={bus.status === "ACTIVE" ? "success" : "default"} />
            </CardHeader>
            <div className="p-4 space-y-2">
              <div className="text-[10px] text-gray-500">
                <p>ID: {bus.id}</p>
                <p>Route: {bus.route_id || "Not assigned"}</p>
                <p>Created: {new Date(bus.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          </Card>
        ))}
        {buses.length === 0 && (
          <Card><div className="p-6 text-center text-gray-600 col-span-3">No buses registered</div></Card>
        )}
      </div>
    </div>
  );
}
