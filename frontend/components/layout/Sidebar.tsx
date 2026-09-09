"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SystemStatusBadge from "./SystemStatusBadge";
import NotificationBell from "./NotificationBell";
import UserProfileChip from "./UserProfileChip";

const NAV_ITEMS = [
  { label: "Overview", href: "/" },
  { label: "Consensus Timeline", href: "/consensus" },
  { label: "Road Issues", href: "/issues" },
  { label: "Verification", href: "/verification" },
  { label: "Incidents", href: "/incidents" },
  { label: "Authorities Portal", href: "/authorities" },
  { label: "Traffic Analytics", href: "/traffic" },
  { label: "Fleet Telemetry", href: "/fleet" },
  { label: "Live Feeds", href: "/live" },
  { label: "Command Center", href: "/command-center" },
  { label: "GIS Map", href: "/map" },
  { label: "Analytics", href: "/analytics" },
  { label: "Demo Workflow", href: "/demo" },
  { label: "System Status", href: "/system" },
  { label: "Settings", href: "/settings" },
  { label: "Admin Console", href: "/admin" },
  { label: "Audit Logs", href: "/audit-logs" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-56 bg-white border-r border-slate-200 flex flex-col h-screen fixed left-0 top-0 z-40 select-none">
      <div className="p-3 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-sm font-bold text-slate-900 tracking-tight">
              UrbanSense AI
            </h1>
            <p className="text-[9px] text-slate-500 uppercase tracking-wider font-medium">
              Municipal Operations
            </p>
          </div>
          <NotificationBell />
        </div>
      </div>
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between px-3 py-1.5 rounded text-xs transition-colors ${
                active
                  ? "bg-blue-50 text-blue-700 font-semibold border-l-2 border-blue-600"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <span>{item.label}</span>
              {active && <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-slate-200 space-y-2 bg-slate-50/50">
        <UserProfileChip />
        <SystemStatusBadge />
        <div className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center justify-between">
          <span>Operations v1.0</span>
          <span>Municipal Cloud</span>
        </div>
      </div>
    </aside>
  );
}


