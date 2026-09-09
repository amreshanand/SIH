"use client";

import { ReactNode } from "react";

const toneMap: Record<string, { border: string; text: string }> = {
  cyan: { border: "border-slate-200", text: "text-blue-700" },
  blue: { border: "border-slate-200", text: "text-blue-700" },
  red: { border: "border-slate-200", text: "text-red-700" },
  orange: { border: "border-slate-200", text: "text-amber-700" },
  green: { border: "border-slate-200", text: "text-emerald-700" },
  amber: { border: "border-slate-200", text: "text-amber-700" },
  emerald: { border: "border-slate-200", text: "text-emerald-700" },
  purple: { border: "border-slate-200", text: "text-indigo-700" },
};

export function KpiCard({
  label,
  value,
  color = "blue",
  subtitle,
  icon,
}: {
  label: string;
  value: string | number;
  color?: string;
  subtitle?: string;
  icon?: ReactNode;
}) {
  const tone = toneMap[color] || toneMap.blue;
  return (
    <div className="bg-white border border-slate-200 rounded p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
          <div className="text-2xl font-bold mt-1 text-slate-900">{value}</div>
          {subtitle && <div className="text-[11px] text-slate-500 mt-1">{subtitle}</div>}
        </div>
        {icon && <div className="text-slate-400 mt-0.5">{icon}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value, tone = "default" }: { label: string; value: string | number; tone?: string }) {
  const tones: Record<string, string> = {
    default: "text-slate-900",
    green: "text-emerald-700",
    red: "text-red-700",
    amber: "text-amber-700",
    cyan: "text-blue-700",
    blue: "text-blue-700",
  };
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${tones[tone] || tones.default}`}>{value}</div>
    </div>
  );
}

export function Badge({ text, variant = "default" }: { text: string; variant?: string }) {
  const styles: Record<string, string> = {
    default: "bg-slate-100 text-slate-700 border-slate-200",
    critical: "bg-red-50 text-red-700 border-red-200 font-semibold",
    danger: "bg-red-50 text-red-700 border-red-200 font-semibold",
    high: "bg-amber-50 text-amber-800 border-amber-200 font-medium",
    medium: "bg-amber-50 text-amber-700 border-amber-200",
    low: "bg-slate-100 text-slate-700 border-slate-200",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200 font-medium",
    warning: "bg-amber-50 text-amber-700 border-amber-200 font-medium",
    info: "bg-blue-50 text-blue-700 border-blue-200 font-medium",
    online: "bg-emerald-50 text-emerald-700 border-emerald-200 font-medium",
    detected: "bg-amber-50 text-amber-800 border-amber-200 font-medium",
    confirmed: "bg-blue-50 text-blue-700 border-blue-200 font-medium",
    reopened: "bg-rose-50 text-rose-700 border-rose-200 font-medium",
  };
  return (
    <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded border ${styles[variant.toLowerCase()] || styles.default}`}>
      {text}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-slate-200 rounded shadow-none ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/50 ${className}`}>{children}</div>;
}

