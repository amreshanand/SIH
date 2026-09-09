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
        className="flex items-center justify-center gap-1.5 w-full py-1.5 px-3 rounded text-xs font-medium text-blue-700 border border-blue-200 bg-white hover:bg-blue-50 transition-colors"
      >
        <span>Sign In</span>
      </Link>
    );
  }

  const roleColor =
    user.role === "ADMIN"
      ? "bg-purple-50 text-purple-700 border-purple-200"
      : user.role === "AUTHORITY"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : "bg-slate-100 text-slate-700 border-slate-200";

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-2 rounded bg-white border border-slate-200 hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-700 shrink-0">
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div className="truncate">
            <div className="text-xs font-medium text-slate-900 truncate">{user.username}</div>
            <div className="text-[9px] text-slate-500 truncate">{user.department || user.role}</div>
          </div>
        </div>
        <span className={`text-[9px] px-1.5 py-0.5 rounded border uppercase shrink-0 font-medium ${roleColor}`}>
          {user.role}
        </span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-56 p-2 rounded bg-white border border-slate-200 shadow-md z-50 space-y-1">
          <div className="px-2 py-1 border-b border-slate-100 text-[10px] text-slate-500 uppercase font-semibold tracking-wider">
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
                  className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between transition-colors ${
                    isCurrent
                      ? "bg-blue-50 text-blue-700 font-semibold"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="truncate">{p.label}</span>
                  {isCurrent && <span className="text-[10px] font-bold text-blue-600">Active</span>}
                </button>
              );
            })}
          </div>
          <div className="pt-1.5 border-t border-slate-100 flex justify-between gap-2">
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="text-[11px] text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-50 transition-colors"
            >
              All Personas
            </Link>
            <button
              onClick={handleLogout}
              className="text-[11px] text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

