"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SystemStatusBadge from "./SystemStatusBadge";

const NAV_ITEMS = [
  { label: "Overview", href: "/", icon: "◆" },
  { label: "Live Fleet", href: "/live", icon: "▶" },
  { label: "Command Center", href: "/command-center", icon: "▦" },
  { label: "GIS Map", href: "/map", icon: "◎" },
  { label: "Road Issues", href: "/issues", icon: "▲" },
  { label: "Incidents", href: "/incidents", icon: "⚡" },
  { label: "Traffic", href: "/traffic", icon: "◇" },
  { label: "Fleet", href: "/fleet", icon: "■" },
  { label: "Authorities", href: "/authorities", icon: "◈" },
  { label: "Analytics", href: "/analytics", icon: "◐" },
  { label: "Demo", href: "/demo", icon: "▶" },
  { label: "System", href: "/system", icon: "◉" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-56 bg-gray-950 border-r border-gray-800 flex flex-col h-screen fixed left-0 top-0 z-40">
      <div className="p-4 border-b border-gray-800/80">
        <h1 className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
          UrbanSense AI
        </h1>
        <div className="flex items-center justify-between mt-0.5">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest">Mobility Intelligence</p>
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" title="RTIS Core Online" />
        </div>
      </div>
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                active
                  ? "bg-gradient-to-r from-cyan-500/15 to-transparent text-cyan-400 border-l-2 border-cyan-400"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
              }`}
            >
              <span className="text-xs">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-gray-800/80 space-y-2">
        <SystemStatusBadge />
        <div className="text-[10px] text-gray-600 uppercase tracking-wider flex items-center justify-between">
          <span>Prototype v0.1</span>
          <span className="text-gray-700">SIH Track</span>
        </div>
      </div>
    </aside>
  );
}
