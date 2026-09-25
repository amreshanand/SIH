"use client";

import { ReactNode } from "react";

const colorThemes: Record<
  string,
  { bg: string; text: string; iconBg: string; border: string; glow: string }
> = {
  blue: {
    bg: "bg-blue-500/5",
    text: "text-blue-600",
    iconBg: "bg-gradient-to-br from-blue-50 to-blue-100 text-blue-600 border-blue-200/70",
    border: "border-blue-100",
    glow: "shadow-blue-500/10",
  },
  cyan: {
    bg: "bg-cyan-500/5",
    text: "text-cyan-600",
    iconBg: "bg-gradient-to-br from-cyan-50 to-cyan-100 text-cyan-600 border-cyan-200/70",
    border: "border-cyan-100",
    glow: "shadow-cyan-500/10",
  },
  green: {
    bg: "bg-emerald-500/5",
    text: "text-emerald-600",
    iconBg: "bg-gradient-to-br from-emerald-50 to-emerald-100 text-emerald-600 border-emerald-200/70",
    border: "border-emerald-100",
    glow: "shadow-emerald-500/10",
  },
  emerald: {
    bg: "bg-emerald-500/5",
    text: "text-emerald-600",
    iconBg: "bg-gradient-to-br from-emerald-50 to-emerald-100 text-emerald-600 border-emerald-200/70",
    border: "border-emerald-100",
    glow: "shadow-emerald-500/10",
  },
  amber: {
    bg: "bg-amber-500/5",
    text: "text-amber-600",
    iconBg: "bg-gradient-to-br from-amber-50 to-amber-100 text-amber-700 border-amber-200/70",
    border: "border-amber-100",
    glow: "shadow-amber-500/10",
  },
  orange: {
    bg: "bg-orange-500/5",
    text: "text-orange-600",
    iconBg: "bg-gradient-to-br from-orange-50 to-orange-100 text-orange-700 border-orange-200/70",
    border: "border-orange-100",
    glow: "shadow-orange-500/10",
  },
  red: {
    bg: "bg-rose-500/5",
    text: "text-rose-600",
    iconBg: "bg-gradient-to-br from-rose-50 to-rose-100 text-rose-600 border-rose-200/70",
    border: "border-rose-100",
    glow: "shadow-rose-500/10",
  },
  purple: {
    bg: "bg-purple-500/5",
    text: "text-purple-600",
    iconBg: "bg-gradient-to-br from-purple-50 to-purple-100 text-purple-600 border-purple-200/70",
    border: "border-purple-100",
    glow: "shadow-purple-500/10",
  },
};

export function KpiCard({
  label,
  value,
  color = "blue",
  subtitle,
  icon,
  trend,
}: {
  label: string;
  value: string | number;
  color?: string;
  subtitle?: string;
  icon?: ReactNode;
  trend?: string;
}) {
  const theme = colorThemes[color.toLowerCase()] || colorThemes.blue;

  return (
    <div className="group relative bg-white/95 backdrop-blur-md border border-slate-200/80 hover:border-slate-300 rounded-xl p-4.5 glow-card transition-all duration-300 shadow-xs hover:shadow-md">
      {/* Subtle top ambient accent bar */}
      <div className={`absolute top-0 left-4 right-4 h-[2px] rounded-full bg-gradient-to-r from-transparent via-${color}-500/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity`} />
      
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 font-mono">
            {label}
          </div>
          <div className="text-2xl lg:text-3xl font-black mt-1.5 text-slate-900 tracking-tight font-sans">
            {value}
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {trend && (
              <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/60 font-mono">
                {trend}
              </span>
            )}
            {subtitle && (
              <span className="text-[11px] text-slate-500 truncate font-medium">
                {subtitle}
              </span>
            )}
          </div>
        </div>

        {icon && (
          <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center border shadow-xs transition-transform group-hover:scale-105 ${theme.iconBg}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  const tones: Record<string, string> = {
    default: "text-slate-900",
    green: "text-emerald-600",
    red: "text-rose-600",
    amber: "text-amber-600",
    cyan: "text-cyan-600",
    blue: "text-blue-600",
  };
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
        {label}
      </div>
      <div className={`text-base font-extrabold mt-0.5 font-sans ${tones[tone] || tones.default}`}>
        {value}
      </div>
    </div>
  );
}

export function Badge({
  text,
  variant = "default",
  dot = true,
}: {
  text: string;
  variant?: string;
  dot?: boolean;
}) {
  const v = variant.toLowerCase();

  const styles: Record<
    string,
    { badge: string; dotColor: string }
  > = {
    default: {
      badge: "bg-slate-100 text-slate-700 border-slate-200/90",
      dotColor: "bg-slate-400",
    },
    critical: {
      badge: "bg-rose-50 text-rose-700 border-rose-200 font-bold shadow-xs",
      dotColor: "bg-rose-500 animate-pulse",
    },
    danger: {
      badge: "bg-rose-50 text-rose-700 border-rose-200 font-bold shadow-xs",
      dotColor: "bg-rose-500 animate-pulse",
    },
    high: {
      badge: "bg-amber-50 text-amber-800 border-amber-200/90 font-semibold shadow-xs",
      dotColor: "bg-amber-500",
    },
    medium: {
      badge: "bg-sky-50 text-sky-800 border-sky-200/90 font-medium",
      dotColor: "bg-sky-500",
    },
    low: {
      badge: "bg-slate-100 text-slate-600 border-slate-200 font-medium",
      dotColor: "bg-slate-400",
    },
    success: {
      badge: "bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold shadow-xs",
      dotColor: "bg-emerald-500",
    },
    online: {
      badge: "bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold shadow-xs",
      dotColor: "bg-emerald-500 animate-radar",
    },
    warning: {
      badge: "bg-amber-50 text-amber-700 border-amber-200 font-medium",
      dotColor: "bg-amber-500",
    },
    info: {
      badge: "bg-blue-50 text-blue-700 border-blue-200 font-medium",
      dotColor: "bg-blue-500",
    },
    detected: {
      badge: "bg-orange-50 text-orange-700 border-orange-200 font-semibold",
      dotColor: "bg-orange-500",
    },
    confirmed: {
      badge: "bg-blue-50 text-blue-700 border-blue-200 font-semibold",
      dotColor: "bg-blue-500",
    },
    reopened: {
      badge: "bg-purple-50 text-purple-700 border-purple-200 font-semibold",
      dotColor: "bg-purple-500",
    },
  };

  const current = styles[v] || styles.default;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-0.5 rounded-full border tracking-wide transition-colors ${current.badge}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${current.dotColor}`} />}
      <span>{text}</span>
    </span>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-white/95 backdrop-blur-md border border-slate-200/85 rounded-xl shadow-xs hover:border-slate-300 transition-all ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-slate-50/70 via-white to-slate-50/40 flex items-center justify-between rounded-t-xl ${className}`}
    >
      {children}
    </div>
  );
}
