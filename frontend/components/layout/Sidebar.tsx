"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SystemStatusBadge from "./SystemStatusBadge";

const NAV_ITEMS = [
  { label: "Overview", href: "/", icon: "◆" },
  { label: "Live Fleet", href: "/live", icon: "▶" },
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
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-lg font-bold text-cyan-400">UrbanSense AI</h1>
        <p className="text-[10px] text-gray-500 uppercase tracking-widest">Mobility Intelligence</p>
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
                  ? "bg-cyan-500/10 text-cyan-400 border-l-2 border-cyan-400"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
              }`}
            >
              <span className="text-xs">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-gray-800">
        <div className="text-[10px] text-gray-600 uppercase tracking-wider">Prototype v0.1</div>
        <SystemStatusBadge />
      </div>
    </aside>
  );
}
