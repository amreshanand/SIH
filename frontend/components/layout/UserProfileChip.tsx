"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { auth, type AuthUser } from "@/lib/api";

const DEMO_PERSONAS = [
  { label: "Admin", username: "admin", pass: "admin123", role: "ADMIN" },
  { label: "Road Authority PMC", username: "authority_road", pass: "auth123", role: "AUTHORITY" },
  { label: "Traffic Police", username: "authority_traffic", pass: "auth123", role: "AUTHORITY" },
  { label: "Public Viewer", username: "viewer1", pass: "view123", role: "VIEWER" },
];

export default function UserProfileChip() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setUser(auth.user);
    const handler = () => setUser(auth.user);
    window.addEventListener("auth-changed", handler);
    return () => window.removeEventListener("auth-changed", handler);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSwitchPersona = async (persona: typeof DEMO_PERSONAS[0]) => {
    setSwitching(true);
    try {
      await auth.login(persona.username, persona.pass);
      setOpen(false);
    } catch (err) {
      console.error("Failed to switch persona:", err);
    } finally {
      setSwitching(false);
    }
  };

  const handleLogout = () => {
    auth.clear();
    setOpen(false);
  };

  if (!user) {
    return (
      <Link
        href="/login"
        className="flex items-center justify-center gap-1.5 w-full py-1.5 px-3 rounded-lg text-xs font-medium text-cyan-300 border border-slate-800 bg-slate-900/80 hover:bg-slate-800 transition-colors"
      >
        <span>Sign In</span>
      </Link>
    );
  }

  const roleColor =
    user.role === "ADMIN"
      ? "bg-purple-500/20 text-purple-300 border-purple-500/30"
      : user.role === "AUTHORITY"
      ? "bg-blue-500/20 text-blue-300 border-blue-500/30"
      : "bg-slate-800 text-slate-300 border-slate-700";

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-900/80 border border-slate-800 hover:border-slate-700 hover:bg-slate-850 transition-colors text-left cursor-pointer"
      >
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-cyan-400 shrink-0">
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div className="truncate">
            <div className="text-xs font-semibold text-white truncate font-sans">{user.username}</div>
            <div className="text-[9px] text-slate-400 truncate font-mono">{user.department || user.role}</div>
          </div>
        </div>
        <span className={`text-[9px] px-1.5 py-0.5 rounded border uppercase shrink-0 font-mono font-bold ${roleColor}`}>
          {user.role}
        </span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-56 p-2 rounded-xl bg-[#0c1322] border border-slate-700/80 shadow-2xl z-50 space-y-1 backdrop-blur-md">
          <div className="px-2 py-1 border-b border-slate-800 text-[10px] text-slate-400 uppercase font-mono font-semibold tracking-wider">
            Switch Operator Persona
          </div>
          <div className="space-y-0.5">
            {DEMO_PERSONAS.map((p) => {
              const isCurrent = user.username === p.username;
              return (
                <button
                  key={p.username}
                  onClick={() => handleSwitchPersona(p)}
                  disabled={switching || isCurrent}
                  className={`w-full text-left px-2 py-1.5 rounded-lg text-xs flex items-center justify-between transition-colors cursor-pointer ${
                    isCurrent
                      ? "bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/30"
                      : "text-slate-300 hover:bg-slate-800/60"
                  }`}
                >
                  <span className="truncate">{p.label}</span>
                  {isCurrent && <span className="text-[10px] font-mono font-bold text-cyan-400">Active</span>}
                </button>
              );
            })}
          </div>
          <div className="pt-1.5 border-t border-slate-800 flex justify-between gap-2">
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="text-[11px] text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-slate-800 transition-colors"
            >
              All Personas
            </Link>
            <button
              onClick={handleLogout}
              className="text-[11px] text-rose-400 hover:text-rose-300 px-2 py-1 rounded hover:bg-rose-500/10 transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

