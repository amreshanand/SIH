"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, Badge } from "@/components/ui/Card";
import Link from "next/link";
import type { Incident } from "@/types";

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getIncidents().then((r) => setIncidents(r.incidents)).catch(console.error).finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Incidents</h1>
        <p className="text-sm text-gray-500">Detected traffic incidents and safety events</p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {loading && <div className="text-gray-500 text-sm">Loading incidents...</div>}
        {incidents.length === 0 && !loading && (
          <Card><div className="p-6 text-center text-gray-600">No incidents detected yet</div></Card>
        )}
        {incidents.map((inc) => (
          <Link key={inc.id} href={`/incidents/${inc.id}`}>
            <Card className="hover:border-gray-600 transition-colors cursor-pointer">
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge text={inc.severity} variant={inc.severity.toLowerCase()} />
                    <span className="text-sm font-medium text-white">{inc.incident_id}</span>
                    <span className="text-xs text-gray-400">{inc.incident_type}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {inc.plate_text && (
                      <span className="text-[10px] text-yellow-400 font-mono">{inc.plate_text}</span>
                    )}
                    <Badge text={inc.status} variant="default" />
                    <span className="text-[10px] text-gray-500">{new Date(inc.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-4 text-[10px] text-gray-500">
                  <span>GPS: {inc.latitude?.toFixed(4)}, {inc.longitude?.toFixed(4)}</span>
                  <span>Confidence: {inc.confidence != null ? `${(inc.confidence * 100).toFixed(0)}%` : "N/A"}</span>
                  {inc.plate_confidence && <span>OCR: {(inc.plate_confidence * 100).toFixed(0)}%</span>}
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
