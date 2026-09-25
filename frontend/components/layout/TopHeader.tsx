"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";

export default function TopHeader() {
  const pathname = usePathname();
  const [timeStr, setTimeStr] = useState("");
  const [continuousRunning, setContinuousRunning] = useState(true);
  const [eventCount, setEventCount] = useState<number | null>(null);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const checkStatus = () => {
      api.getContinuousSensingStatus()
        .then((res) => {
          if (res) {
            setContinuousRunning(res.is_running);
            setEventCount(res.events_emitted);
          }
        })
        .catch(() => {});
    };
    checkStatus();
    const interval = setInterval(checkStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  const toggleContinuous = async () => {
    try {
      if (continuousRunning) {
        await api.stopContinuousSensing();
        setContinuousRunning(false);
      } else {
        await api.startContinuousSensing(5.0);
        setContinuousRunning(true);
      }
    } catch (err) {
      console.error("Failed to toggle continuous sensing:", err);
    }
  };

  // Convert pathname to clean breadcrumb
  const pageTitle =
    pathname === "/"
      ? "Operations Overview"
      : pathname
          .split("/")[1]
          ?.replace(/-/g, " ")
          ?.replace(/\b\w/g, (c) => c.toUpperCase()) || "UrbanSense AI";

  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200/80 px-6 py-2.5 flex items-center justify-between shadow-2xs">
      {/* Left: Breadcrumbs & System Tag */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono text-slate-400 font-semibold">PUNE MUNICIPAL</span>
          <span className="text-slate-300">/</span>
          <span className="font-bold text-slate-900 tracking-tight">{pageTitle}</span>
        </div>
      </div>

      {/* Right: Live Telemetry Status & Controls */}
      <div className="flex items-center gap-3">
        {/* Continuous Sensing Live Indicator */}
        <button
          onClick={toggleContinuous}
          title="Click to toggle continuous sensing loop"
          className={`flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-mono border transition-all cursor-pointer ${
            continuousRunning
              ? "bg-emerald-50 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100/60 shadow-xs"
              : "bg-amber-50 text-amber-700 border-amber-200/80 hover:bg-amber-100/60"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              continuousRunning ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
            }`}
          />
          <span className="font-bold tracking-tight">
            {continuousRunning ? "LIVE CONTINUOUS SENSING" : "SENSING PAUSED"}
          </span>
          {eventCount !== null && (
            <span className="text-[10px] bg-white/80 px-1.5 py-0.2 rounded font-extrabold text-slate-700 border border-slate-200/60">
              {eventCount}
            </span>
          )}
        </button>

        {/* Fleet Active Badge */}
        <div className="hidden sm:flex items-center gap-1.5 bg-slate-100/80 border border-slate-200/70 px-2.5 py-1 rounded-lg text-xs font-mono text-slate-700 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          <span>6 BUSES SENSING</span>
        </div>

        {/* Live Clock */}
        <div className="hidden md:flex items-center gap-1.5 bg-slate-900 text-cyan-400 border border-slate-800 px-2.5 py-1 rounded-lg text-xs font-mono font-bold tracking-wider shadow-xs">
          <span>{timeStr || "00:00:00"}</span>
          <span className="text-[9px] text-slate-400 font-sans">IST</span>
        </div>


      </div>
    </header>
  );
}
