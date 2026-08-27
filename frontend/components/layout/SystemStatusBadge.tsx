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
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        <span className="text-[10px] text-red-400">BACKEND OFFLINE</span>
      </div>
    );
  }

  const live = health ? health.pipeline === "LIVE" : false;
  const label = live ? "EDGE PIPELINE LIVE" : "PIPELINE SIMULATED";
  const pulse = live ? "animate-pulse" : "";

  return (
    <div className="flex items-center gap-1.5 mt-1">
      <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-amber-400"} ${pulse}`} />
      <span className={`text-[10px] ${live ? "text-emerald-400" : "text-amber-400"}`}>{label}</span>
    </div>
  );
}
