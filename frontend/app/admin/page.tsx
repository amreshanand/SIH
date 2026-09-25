"use client";

import { useCallback, useEffect, useState } from "react";
import { api, APIError, auth, type AuthUser } from "@/lib/api";
import { Card, CardHeader, Badge, Stat } from "@/components/ui/Card";
import type { AdminUser } from "@/types";

const ROLES = ["ADMIN", "AUTHORITY", "VIEWER"];

function roleVariant(role: string): string {
  if (role === "ADMIN") return "critical";
  if (role === "AUTHORITY") return "info";
  return "default";
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState("VIEWER");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setCurrentUser(auth.user);
    setMounted(true);
    const handler = () => setCurrentUser(auth.user);
    window.addEventListener("auth-changed", handler);
    return () => window.removeEventListener("auth-changed", handler);
  }, []);

  const isAdmin = mounted && currentUser?.role === "ADMIN";

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.getUsers({ limit: "200" });
      setUsers(res.users);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof APIError ? `${e.status}: ${e.detail}` : "Failed to load users");
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [isAdmin, load]);

  const create = async () => {
    if (username.trim().length < 3 || password.length < 8) {
      setNotice("Username ≥ 3 chars, password ≥ 8 chars");
      return;
    }
    setNotice(null);
    try {
      await api.createUser({ username: username.trim(), password, role: newRole });
      setUsername("");
      setPassword("");
      setNewRole("VIEWER");
      setNotice(`Created ${username.trim()}`);
      void load();
    } catch (e) {
      setNotice(e instanceof APIError ? `${e.status}: ${e.detail}` : "Create failed");
    }
  };

  const changeRole = async (u: AdminUser, role: string) => {
    if (role === u.role) return;
    if (!window.confirm(`Change ${u.username} role ${u.role} → ${role}?`)) return;
    setBusyId(u.id);
    setNotice(null);
    try {
      await api.updateUserRole(u.id, role);
      setNotice(`${u.username} is now ${role}`);
      void load();
    } catch (e) {
      setNotice(e instanceof APIError ? `${e.status}: ${e.detail}` : "Role change failed");
    } finally {
      setBusyId(null);
    }
  };

  if (!mounted) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-4">Admin</h1>
        <Card className="p-6">
          <div className="text-slate-500 font-mono text-sm animate-pulse">Checking credentials...</div>
        </Card>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-4">Admin</h1>
        <Card className="p-6">
          <div className="text-amber-600 font-medium">Admin access required — your role is {currentUser?.role ?? "none"}.</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Admin Console</h1>
        <p className="text-xs text-slate-500 mt-0.5">Municipal operator permissions, access roles, and account provisioning</p>
      </div>

      {notice && (
        <Card className="p-3 bg-cyan-50 border-cyan-200">
          <span className="text-xs font-semibold text-cyan-800">{notice}</span>
        </Card>
      )}
      {error && (
        <Card className="p-3 bg-rose-50 border-rose-200">
          <span className="text-xs font-semibold text-rose-700">{error}</span>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">Create user</span>
            <Badge text="NEW" variant="info" />
          </CardHeader>
          <div className="p-4 space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. ward_supervisor"
                className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Password (min 8 chars)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white transition-colors"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Assigned Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-colors"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={create}
              className="w-full px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs text-white font-bold transition-colors cursor-pointer shadow-xs"
            >
              Create user
            </button>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">Registered Operator Accounts</span>
            <Badge text={`${total} TOTAL`} variant="default" />
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[10px] uppercase font-bold tracking-wider text-slate-500 border-b border-slate-200 bg-slate-50/70 font-mono">
                  <th className="px-4 py-2.5">Username</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Department</th>
                  <th className="px-4 py-2.5">Created</th>
                  <th className="px-4 py-2.5">Change role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-2.5 font-bold font-mono text-slate-900">
                      {u.username}
                      {u.id === currentUser?.id && (
                        <span className="text-blue-600 ml-1.5 text-[11px] font-sans font-semibold">(you)</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge text={u.role} variant={roleVariant(u.role)} />
                    </td>
                    <td className="px-4 py-2.5 text-slate-700 font-medium">{u.department ?? "—"}</td>
                    <td className="px-4 py-2.5 text-slate-500 font-mono text-[11px]">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={u.role}
                        disabled={busyId === u.id}
                        onChange={(e) => changeRole(u, e.target.value)}
                        className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs font-semibold text-slate-800 disabled:opacity-50 focus:outline-none focus:border-blue-600 cursor-pointer"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {users.length === 0 && (
            <div className="p-8 text-center text-xs text-slate-500 font-mono">No registered users found.</div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3.5 border-l-4 border-l-rose-500">
          <Stat label="ADMINISTRATORS" value={users.filter((u) => u.role === "ADMIN").length} tone="red" />
        </Card>
        <Card className="p-3.5 border-l-4 border-l-blue-500">
          <Stat label="AUTHORITIES" value={users.filter((u) => u.role === "AUTHORITY").length} tone="blue" />
        </Card>
        <Card className="p-3.5 border-l-4 border-l-slate-400">
          <Stat label="VIEWERS" value={users.filter((u) => u.role === "VIEWER").length} tone="default" />
        </Card>
      </div>
    </div>
  );
}