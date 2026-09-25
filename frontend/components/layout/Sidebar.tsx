"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SystemStatusBadge from "./SystemStatusBadge";
import NotificationBell from "./NotificationBell";
import UserProfileChip from "./UserProfileChip";

interface NavGroup {
  title: string;
  items: {
    label: string;
    href: string;
    icon: (active: boolean) => React.ReactNode;
    badge?: string;
  }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "OPERATIONS",
    items: [
      {
        label: "Overview",
        href: "/",
        icon: (a) => (
          <svg className={`w-4 h-4 ${a ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        ),
      },
      {
        label: "Command Center",
        href: "/command-center",
        badge: "LIVE",
        icon: (a) => (
          <svg className={`w-4 h-4 ${a ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        ),
      },
      {
        label: "Live Feeds",
        href: "/live",
        badge: "STREAM",
        icon: (a) => (
          <svg className={`w-4 h-4 ${a ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        ),
      },
      {
        label: "Fleet Telemetry",
        href: "/fleet",
        icon: (a) => (
          <svg className={`w-4 h-4 ${a ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        ),
      },
      {
        label: "GIS Map",
        href: "/map",
        icon: (a) => (
          <svg className={`w-4 h-4 ${a ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
    ],
  },
  {
    title: "DEFECT INTELLIGENCE",
    items: [
      {
        label: "Road Issues",
        href: "/issues",
        icon: (a) => (
          <svg className={`w-4 h-4 ${a ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        ),
      },
      {
        label: "Consensus Timeline",
        href: "/consensus",
        icon: (a) => (
          <svg className={`w-4 h-4 ${a ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        ),
      },
      {
        label: "Verification",
        href: "/verification",
        icon: (a) => (
          <svg className={`w-4 h-4 ${a ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        ),
      },
      {
        label: "Incidents",
        href: "/incidents",
        badge: "ALERT",
        icon: (a) => (
          <svg className={`w-4 h-4 ${a ? "text-rose-400" : "text-slate-400 group-hover:text-slate-200"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        ),
      },
    ],
  },
  {
    title: "MUNICIPAL MANAGEMENT",
    items: [
      {
        label: "Traffic Analytics",
        href: "/traffic",
        icon: (a) => (
          <svg className={`w-4 h-4 ${a ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        ),
      },
      {
        label: "Authorities Portal",
        href: "/authorities",
        icon: (a) => (
          <svg className={`w-4 h-4 ${a ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        ),
      },
      {
        label: "Macro Analytics",
        href: "/analytics",
        icon: (a) => (
          <svg className={`w-4 h-4 ${a ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
          </svg>
        ),
      },
    ],
  },
  {
    title: "ADMINISTRATION & GOVERNANCE",
    items: [
      {
        label: "Admin Console",
        href: "/admin",
        badge: "CONTROL",
        icon: (a) => (
          <svg className={`w-4 h-4 ${a ? "text-purple-400" : "text-slate-400 group-hover:text-slate-200"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        ),
      },
      {
        label: "Audit Logs",
        href: "/audit-logs",
        badge: "AUDIT",
        icon: (a) => (
          <svg className={`w-4 h-4 ${a ? "text-cyan-400" : "text-slate-400 group-hover:text-slate-200"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
      },
      {
        label: "Settings",
        href: "/settings",
        icon: (a) => (
          <svg className={`w-4 h-4 ${a ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
      {
        label: "System Status",
        href: "/system",
        icon: (a) => (
          <svg className={`w-4 h-4 ${a ? "text-emerald-400" : "text-slate-400 group-hover:text-slate-200"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
          </svg>
        ),
      },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 bg-[#0a0f1d] border-r border-slate-800/80 flex flex-col h-screen fixed left-0 top-0 z-40 select-none shadow-xl">
      {/* Brand Header */}
      <div className="p-3.5 border-b border-slate-800/80 bg-gradient-to-b from-slate-900/90 to-[#0a0f1d]">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/40 via-indigo-500/20 to-cyan-500/40 p-[1.5px] shadow-[0_0_15px_rgba(37,99,235,0.35)] flex-shrink-0 group-hover:scale-105 transition-all">
              <div className="w-full h-full bg-white rounded-[10px] flex items-center justify-center p-1 overflow-hidden shadow-inner">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo.png"
                  alt="UrbanSense Logo"
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm font-black text-white tracking-tight font-sans">
                  UrbanSense
                </h1>
                <span className="text-[10px] px-1 py-0.2 rounded font-mono font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  AI
                </span>
              </div>
              <p className="text-[9px] text-slate-400 uppercase tracking-widest font-mono font-medium">
                Autonomous Transit Fleet
              </p>
            </div>
          </Link>
          <NotificationBell />
        </div>
      </div>

      {/* Nav List with Sections */}
      <nav className="flex-1 px-2.5 py-2 space-y-2.5 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="space-y-1">
            <div className="px-2.5 pb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400 font-mono">
              {group.title}
            </div>
            {group.items.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all duration-200 ${
                    active
                      ? "bg-gradient-to-r from-blue-600/25 via-blue-500/15 to-transparent text-white font-semibold border-l-2 border-blue-500 shadow-xs"
                      : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/40"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {item.icon(active)}
                    <span className="truncate">{item.label}</span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.badge && (
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.2 rounded font-mono ${
                          item.badge === "LIVE" || item.badge === "STREAM"
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : item.badge === "ALERT"
                            ? "bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse"
                            : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                    {active && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shadow-xs shadow-blue-400" />
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer Profile & Status */}
      <div className="p-3 border-t border-slate-800/80 space-y-2 bg-[#080d19]/90">
        <UserProfileChip />
        <SystemStatusBadge />
        <div className="text-[9px] text-slate-400 uppercase tracking-widest font-mono flex items-center justify-between px-1">
          <span>Pune Municipal Corp</span>
          <span className="text-emerald-400 flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
            99.98%
          </span>
        </div>
      </div>
    </aside>
  );
}
