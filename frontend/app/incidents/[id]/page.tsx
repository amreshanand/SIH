"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, getEvidenceImageUrl } from "@/lib/api";
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
    return <div className="p-6 text-red-700 bg-red-50 border border-red-200 rounded text-xs">Error: {error}</div>;
  }

  if (!incident) {
    return <div className="p-6 text-slate-500 text-xs font-mono">Loading incident record...</div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div className="flex items-center gap-3">
          <Link href="/incidents" className="text-slate-500 hover:text-slate-800 text-xs font-medium">
            ← Incidents Registry
          </Link>
          <span className="text-slate-300">/</span>
          <h1 className="text-xl font-bold font-mono text-slate-900">{incident.incident_id}</h1>
          <Badge text={incident.severity} variant={incident.severity.toLowerCase()} />
          <Badge text={incident.status} variant="default" />
        </div>
        <span className="text-xs px-2.5 py-1 rounded bg-slate-100 border border-slate-200 text-slate-700 font-mono">
          {incident.incident_type}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><span className="text-xs font-semibold uppercase tracking-wider text-slate-700">Incident Telemetry</span></CardHeader>
          <div className="p-4 space-y-2.5 text-xs">
            <div className="flex justify-between border-b border-slate-100 pb-1.5"><span className="text-slate-500">Classification</span><span className="font-semibold text-slate-800">{incident.incident_type}</span></div>
            <div className="flex justify-between border-b border-slate-100 pb-1.5"><span className="text-slate-500">Confidence</span><span className="font-mono text-slate-800">{(incident.confidence * 100).toFixed(0)}%</span></div>
            <div className="flex justify-between border-b border-slate-100 pb-1.5"><span className="text-slate-500">GPS Coordinates</span><span className="font-mono text-slate-800">{incident.latitude?.toFixed(5)}°N, {incident.longitude?.toFixed(5)}°E</span></div>
            <div className="flex justify-between border-b border-slate-100 pb-1.5"><span className="text-slate-500">Timestamp</span><span className="font-mono text-slate-800">{new Date(incident.created_at).toLocaleString()}</span></div>
          </div>
        </Card>

        <Card>
          <CardHeader><span className="text-xs font-semibold uppercase tracking-wider text-slate-700">Vehicle Identification & OCR</span></CardHeader>
          <div className="p-4 space-y-2.5 text-xs">
            {incident.plate_text ? (
              <>
                <div className="flex justify-between border-b border-slate-100 pb-1.5">
                  <span className="text-slate-500">License Plate (Automated Read)</span>
                  <span className="font-mono font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-300">{incident.plate_text}</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-1.5">
                  <span className="text-slate-500">OCR Recognition Confidence</span>
                  <span className="font-mono text-slate-800">{((incident.plate_confidence || 0) * 100).toFixed(0)}%</span>
                </div>
                <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded text-amber-800 text-[11px] font-medium leading-relaxed">
                  Automated optical plate candidate logged for law enforcement triage. Subject to human operator verification.
                </div>
              </>
            ) : (
              <p className="text-slate-500 py-4 text-center">No license plate OCR detected in optical crop.</p>
            )}
          </div>
        </Card>
      </div>

      {incident.evidence_url && (() => {
        const imageUrl = getEvidenceImageUrl(incident.evidence_url);
        return (
          <Card>
            <CardHeader><span className="text-xs font-semibold uppercase tracking-wider text-slate-700">Optical Evidence Frame</span></CardHeader>
            <div className="p-4">
              <div className="bg-slate-100 rounded border border-slate-200 overflow-hidden max-w-2xl mx-auto">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt={`Evidence capture for incident ${incident.incident_id}`}
                  className="w-full h-auto object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='225' viewBox='0 0 400 225'><rect fill='%23f1f5f9' width='400' height='225'/><text fill='%2394a3b8' font-family='sans-serif' font-size='12' x='50%25' y='50%25' text-anchor='middle' dy='.3em'>Evidence Frame Unavailable</text></svg>`;
                  }}
                />
              </div>
            </div>
          </Card>
        );
      })()}
    </div>
  );
}
