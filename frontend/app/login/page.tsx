"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/api";
import { Card } from "@/components/ui/Card";

interface Persona {
  label: string;
  role: string;
  dept?: string;
  username: string;
  pass: string;
  desc: string;
}

const DEMO_PERSONAS: Persona[] = [
  {
    label: "City Administrator",
    role: "ADMIN",
    username: "admin",
    pass: "admin123",
    desc: "Full administrative oversight, system health diagnostics, models, and audit logs.",
  },
  {
    label: "Road Authority PMC",
    role: "AUTHORITY",
    dept: "ROAD_MAINTENANCE",
    username: "authority_road",
    pass: "auth123",
    desc: "Road defect work order prioritization, contractor verification, asphalt repairs.",
  },
  {
    label: "Traffic Police Control",
    role: "AUTHORITY",
    dept: "TRAFFIC_MANAGEMENT",
    username: "authority_traffic",
    pass: "auth123",
    desc: "Live intersection congestion telemetry, incident dispatch, traffic flow.",
  },
  {
    label: "Public / Citizen Viewer",
    role: "VIEWER",
    username: "viewer1",
    pass: "view123",
    desc: "Read-only access to public road safety metrics and transit corridor heatmap.",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    setError(null);
    try {
      await auth.login(username, password);
      router.push("/");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid credentials";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (persona: Persona) => {
    setUsername(persona.username);
    setPassword(persona.pass);
    setLoading(true);
    setError(null);
    try {
      await auth.login(persona.username, persona.pass);
      router.push("/");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Quick login failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-100">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-white p-1.5 shadow-md border border-slate-200 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="UrbanSense Logo" className="w-full h-full object-contain" />
          </div>
          <div className="text-[11px] font-semibold text-blue-700 uppercase tracking-wider">
            Municipal Mobility Operations Gateway
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            UrbanSense AI Access
          </h1>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Authorized municipal personnel sign-in and operator persona management.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Direct Credentials Card */}
          <Card className="p-5 bg-white border border-slate-200">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 pb-2 border-b border-slate-100">
              Direct Sign In
            </h2>
            {error && (
              <div className="mb-3 p-2.5 rounded bg-red-50 border border-red-200 text-xs text-red-700">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. admin"
                  className="w-full px-3 py-1.5 text-xs rounded bg-white border border-slate-300 focus:border-blue-600 focus:outline-none text-slate-900 placeholder-slate-400"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-1.5 text-xs rounded bg-white border border-slate-300 focus:border-blue-600 focus:outline-none text-slate-900 placeholder-slate-400"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 px-4 rounded bg-blue-600 hover:bg-blue-700 font-medium text-xs text-white uppercase tracking-wider transition-colors disabled:opacity-50"
              >
                {loading ? "Authenticating..." : "Sign In"}
              </button>
            </form>
          </Card>

          {/* Quick Demo Personas */}
          <div className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 px-1">
              Operator Role Personas
            </h2>
            {DEMO_PERSONAS.map((persona) => (
              <button
                key={persona.username}
                type="button"
                onClick={() => handleQuickLogin(persona)}
                disabled={loading}
                className="w-full text-left p-3 rounded bg-white border border-slate-200 hover:border-blue-400 hover:bg-blue-50/20 transition-colors"
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-semibold text-xs text-slate-900">{persona.label}</span>
                  <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-200">
                    {persona.role}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-normal">
                  {persona.desc}
                </p>
                <div className="mt-1.5 text-[10px] text-slate-400 font-mono">
                  user: <span className="text-slate-700">{persona.username}</span> • pass: <span className="text-slate-700">{persona.pass}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

