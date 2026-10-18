"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { SystemHealth } from "@/types";

/**
 * Truthful system status badge.
 *
 * Renders the backend-computed `operational_state` instead of a
 * hardcoded "PIPELINE ACTIVE" label. Maps each state to a color:
 *   REAL          → green
 *   SIMULATED     → blue
 *   DEMO          → blue
 *   DEGRADED      → amber
 *   MODEL_MISSING → amber (pulsing)
 *   OFFLINE       → red (pulsing)
 *   (error/unknown) → amber "SYSTEM UNREACHABLE"
 */

const STATE_DISPLAY: Record<string, { label: string; dot: string; text: string }> = {
  REAL:          { label: "REAL INFERENCE",       dot: "bg-emerald-600",                   text: "text-emerald-700" },
  SIMULATED:     { label: "SIMULATED TELEMETRY",  dot: "bg-sky-500",                       text: "text-sky-700" },
  DEMO:          { label: "DEMO MODE",            dot: "bg-sky-500",                       text: "text-sky-700" },
  DEGRADED:      { label: "DEGRADED",             dot: "bg-amber-500",                     text: "text-amber-700" },
  MODEL_MISSING: { label: "MODEL MISSING",        dot: "bg-amber-500 animate-pulse",       text: "text-amber-700" },
  OFFLINE:       { label: "SYSTEM OFFLINE",        dot: "bg-rose-500 animate-pulse",        text: "text-rose-700" },
};

const FALLBACK = { label: "SYSTEM UNREACHABLE", dot: "bg-amber-500 animate-pulse", text: "text-amber-700" };

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

  const display = error
    ? FALLBACK
    : health?.operational_state
      ? STATE_DISPLAY[health.operational_state] ?? FALLBACK
      : FALLBACK;

  return (
    <div className="flex items-center gap-1.5 mt-1">
      <span className={`w-1.5 h-1.5 rounded-full ${display.dot}`} />
      <span className={`text-[10px] font-medium ${display.text}`}>{display.label}</span>
    </div>
  );
}
