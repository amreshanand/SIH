"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { SystemHealth } from "@/types";

export default function SystemStatusBadge() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getSystemHealth()
      .then((h) => {
        if (!cancelled) setHealth(h);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    const id = window.setInterval(() => {
      api
        .getSystemHealth()
        .then((h) => {
          if (!cancelled) {
            setHealth(h);
            setError(false);
          }
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
    }, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (error) {
    return (
      <div className="flex items-center gap-1.5 mt-1">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
        <span className="text-[10px] font-medium text-amber-700">PIPELINE ACTIVE</span>
      </div>
    );
  }

  const live = health ? health.pipeline === "LIVE" : false;
  const label = live ? "EDGE PIPELINE LIVE" : "PIPELINE ACTIVE";

  return (
    <div className="flex items-center gap-1.5 mt-1">
      <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-emerald-600" : "bg-amber-600"}`} />
      <span className={`text-[10px] font-medium ${live ? "text-emerald-700" : "text-amber-700"}`}>{label}</span>
    </div>
  );
}

