"use client";

import { ReactNode } from "react";

const toneMap: Record<string, { border: string; text: string }> = {
  cyan: { border: "border-cyan-500/30", text: "text-cyan-400" },
  red: { border: "border-red-500/30", text: "text-red-400" },
  orange: { border: "border-orange-500/30", text: "text-orange-400" },
  green: { border: "border-green-500/30", text: "text-green-400" },
  blue: { border: "border-blue-500/30", text: "text-blue-400" },
  purple: { border: "border-purple-500/30", text: "text-purple-400" },
  amber: { border: "border-amber-500/30", text: "text-amber-400" },
  emerald: { border: "border-emerald-500/30", text: "text-emerald-400" },
};

export function KpiCard({
  label,
  value,
  color = "cyan",
  subtitle,
  icon,
}: {
  label: string;
  value: string | number;
  color?: string;
  subtitle?: string;
  icon?: ReactNode;
}) {
  const tone = toneMap[color] || toneMap.cyan;
  return (
    <div className={`relative bg-gray-900 border ${tone.border} rounded-lg p-4 overflow-hidden`}>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
          <div className={`text-2xl font-bold mt-1 ${tone.text}`}>{value}</div>
          {subtitle && <div className="text-[10px] text-gray-500 mt-1">{subtitle}</div>}
        </div>
        {icon && <div className="text-gray-600 mt-0.5">{icon}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value, tone = "default" }: { label: string; value: string | number; tone?: string }) {
  const tones: Record<string, string> = {
    default: "text-gray-200",
    green: "text-emerald-400",
    red: "text-red-400",
    amber: "text-amber-400",
    cyan: "text-cyan-400",
  };
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${tones[tone] || tones.default}`}>{value}</div>
    </div>
  );
}

export function Badge({ text, variant = "default" }: { text: string; variant?: string }) {
  const styles: Record<string, string> = {
    default: "bg-gray-700/60 text-gray-300 border border-gray-600/50",
    critical: "bg-red-500/20 text-red-400 border border-red-500/30",
    high: "bg-orange-500/20 text-orange-400 border border-orange-500/30",
    medium: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
    low: "bg-green-500/20 text-green-400 border border-green-500/30",
    success: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
    warning: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
    info: "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30",
    online: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25",
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${styles[variant] || styles.default}`}>{text}</span>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-gray-900/70 border border-gray-800 rounded-lg backdrop-blur-sm shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ children }: { children: ReactNode }) {
  return <div className="px-4 py-3 border-b border-gray-800/80 flex items-center justify-between">{children}</div>;
}
