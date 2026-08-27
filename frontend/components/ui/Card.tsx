"use client";

import { ReactNode } from "react";

export function KpiCard({ label, value, color = "cyan", subtitle }: { label: string; value: string | number; color?: string; subtitle?: string }) {
  const colors: Record<string, string> = {
    cyan: "border-cyan-500/30 text-cyan-400",
    red: "border-red-500/30 text-red-400",
    orange: "border-orange-500/30 text-orange-400",
    green: "border-green-500/30 text-green-400",
    blue: "border-blue-500/30 text-blue-400",
    purple: "border-purple-500/30 text-purple-400",
  };
  return (
    <div className={`bg-gray-900 border ${colors[color] || colors.cyan} rounded-lg p-4`}>
      <div className="text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${colors[color]?.split(" ")[1] || "text-cyan-400"}`}>{value}</div>
      {subtitle && <div className="text-[10px] text-gray-500 mt-1">{subtitle}</div>}
    </div>
  );
}

export function Badge({ text, variant = "default" }: { text: string; variant?: string }) {
  const styles: Record<string, string> = {
    default: "bg-gray-700 text-gray-300",
    critical: "bg-red-500/20 text-red-400 border border-red-500/30",
    high: "bg-orange-500/20 text-orange-400 border border-orange-500/30",
    medium: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
    low: "bg-green-500/20 text-green-400 border border-green-500/30",
    success: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded-full ${styles[variant] || styles.default}`}>{text}</span>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-gray-900 border border-gray-800 rounded-lg ${className}`}>{children}</div>;
}

export function CardHeader({ children }: { children: ReactNode }) {
  return <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">{children}</div>;
}
