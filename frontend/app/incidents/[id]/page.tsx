"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { Card, CardHeader, Badge } from "@/components/ui/Card";
import Link from "next/link";
import type { Incident } from "@/types";

export default function IncidentDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [incident, setIncident] = useState<Incident | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.getIncident(id).then(setIncident).catch((e) => setError(String(e)));
  }, [id]);

  if (error) {
    return <div className="p-6 text-red-400">Error: {error}</div>;
  }

  if (!incident) {
    return <div className="p-6 text-gray-500">Loading incident...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/incidents" className="text-gray-500 hover:text-gray-300 text-sm">← Incidents</Link>
        <h1 className="text-2xl font-bold text-white">{incident.incident_id}</h1>
        <Badge text={incident.severity} variant={incident.severity.toLowerCase()} />
        <Badge text={incident.status} variant="default" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader><span className="text-xs text-gray-400">Incident Details</span></CardHeader>
          <div className="p-4 space-y-3 text-[11px]">
            <div className="flex justify-between"><span className="text-gray-500">Type</span><span className="text-gray-200">{incident.incident_type}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Confidence</span><span className="text-gray-200">{(incident.confidence * 100).toFixed(0)}%</span></div>
            <div className="flex justify-between"><span className="text-gray-500">GPS</span><span className="text-gray-200">{incident.latitude?.toFixed(4)}, {incident.longitude?.toFixed(4)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Time</span><span className="text-gray-200">{new Date(incident.created_at).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Source</span><span className="text-gray-200">{incident.source || "N/A"}</span></div>
          </div>
        </Card>

        <Card>
          <CardHeader><span className="text-xs text-gray-400">Vehicle / OCR</span></CardHeader>
          <div className="p-4 space-y-3 text-[11px]">
            {incident.plate_text ? (
              <>
                <div className="flex justify-between"><span className="text-gray-500">Plate (AI Candidate)</span><span className="text-gray-200 font-mono">{incident.plate_text}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">OCR Confidence</span><span className="text-gray-200">{((incident.plate_confidence || 0) * 100).toFixed(0)}%</span></div>
                <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded text-yellow-400 text-[10px]">
                  AI-GENERATED REGISTRATION CANDIDATE — Not legally verified
                </div>
              </>
            ) : (
              <p className="text-gray-600">No plate data captured</p>
            )}
          </div>
        </Card>
      </div>

      {incident.evidence_url && (
        <Card>
          <CardHeader><span className="text-xs text-gray-400">Evidence</span></CardHeader>
          <div className="p-4">
            <div className="bg-gray-800 rounded h-64 flex items-center justify-center">
              <span className="text-gray-600 text-xs">Evidence image: {incident.evidence_url}</span>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
