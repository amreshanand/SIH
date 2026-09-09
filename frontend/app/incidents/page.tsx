"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/Card";
import Link from "next/link";
import type { Incident } from "@/types";

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getIncidents()
      .then((r) => setIncidents(r?.incidents || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Traffic Incident & Safety Registry</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Automated collision, rash driving, and traffic enforcement telemetry
          </p>
        </div>
        <div className="text-xs text-slate-500 font-mono">
          {incidents.length} incident record(s) logged
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-500 text-xs font-mono">Loading incident telemetry...</div>
        ) : incidents.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">No traffic safety incidents recorded.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px] tracking-wider">
                  <th className="py-2.5 px-4">Incident ID</th>
                  <th className="py-2.5 px-4">Type</th>
                  <th className="py-2.5 px-4">Severity</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Vehicle Plate</th>
                  <th className="py-2.5 px-4">Confidence</th>
                  <th className="py-2.5 px-4">Coordinates</th>
                  <th className="py-2.5 px-4">Logged</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {incidents.map((inc) => (
                  <tr key={inc.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-4 font-mono font-medium text-slate-900">
                      <Link href={`/incidents/${inc.id}`} className="hover:text-blue-700 hover:underline">
                        {inc.incident_id}
                      </Link>
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-800">
                      {inc.incident_type}
                    </td>
                    <td className="py-2.5 px-4">
                      <Badge text={inc.severity} variant={inc.severity.toLowerCase()} />
                    </td>
                    <td className="py-2.5 px-4">
                      <Badge text={inc.status} variant="default" />
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-800">
                      {inc.plate_text ? (
                        <span className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                          {inc.plate_text}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">None</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-700">
                      {inc.confidence != null ? `${(inc.confidence * 100).toFixed(0)}%` : "N/A"}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 text-[11px]">
                      {inc.latitude?.toFixed(4)}, {inc.longitude?.toFixed(4)}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-500 text-[11px]">
                      {new Date(inc.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <Link
                        href={`/incidents/${inc.id}`}
                        className="text-blue-700 hover:underline font-medium text-xs"
                      >
                        Inspect →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
