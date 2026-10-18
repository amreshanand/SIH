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
      <div
        className="flex items-center gap-1.5 mt-1"
        title="Backend server is unreachable. Verify that backend is running on http://localhost:8000"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        <span className="text-[10px] font-semibold text-red-600 tracking-wide">BACKEND OFFLINE</span>
      </div>
    );
  }

  const opState = health?.operational_state || health?.ai_mode || "ONLINE";
  const isMissing = opState === "MODEL_MISSING";
  const isReal = opState === "REAL" || health?.pipeline === "LIVE";
  const isDemo = opState === "DEMO" || opState === "SIMULATED";

  let dotColor = "bg-emerald-600";
  let textColor = "text-emerald-700";
  let label = "PIPELINE LIVE";

  if (isMissing) {
    dotColor = "bg-amber-500";
    textColor = "text-amber-700";
    label = "AI: MODEL MISSING";
  } else if (isDemo) {
    dotColor = "bg-blue-500";
    textColor = "text-blue-700";
    label = `MODE: ${opState}`;
  } else if (!isReal) {
    dotColor = "bg-amber-600";
    textColor = "text-amber-700";
    label = "PIPELINE ACTIVE";
  }

  return (
    <div
      className="flex items-center gap-1.5 mt-1"
      title={`Operational State: ${opState} | Database: ${health?.database?.status || "online"}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span className={`text-[10px] font-medium ${textColor}`}>{label}</span>
    </div>
  );
}

