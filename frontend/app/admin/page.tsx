"use client";

import { useCallback, useEffect, useState } from "react";
import { api, APIError, auth } from "@/lib/api";
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
  const [currentUser] = useState(auth.user);
  const isAdmin = currentUser?.role === "ADMIN";

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

  if (!isAdmin) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-100 mb-4">Admin</h1>
        <Card className="p-6">
          <div className="text-amber-400">Admin access required — your role is {currentUser?.role ?? "none"}.</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Admin Panel</h1>
        <p className="text-sm text-gray-500">User management and role-based access control</p>
      </div>

      {notice && (
        <Card className="p-4 border-cyan-500/40">
          <span className="text-sm text-cyan-300">{notice}</span>
        </Card>
      )}
      {error && (
        <Card className="p-4">
          <span className="text-sm text-red-400">{error}</span>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <span className="text-sm font-semibold text-gray-200">Create user</span>
            <Badge text="NEW" variant="info" />
          </CardHeader>
          <div className="p-4 space-y-3">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min 8 chars)"
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              onClick={create}
              className="w-full px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-sm text-white font-medium"
            >
              Create user
            </button>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <span className="text-sm font-semibold text-gray-200">Users</span>
            <Badge text={`${total} total`} variant="default" />
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-gray-500 border-b border-gray-800">
                  <th className="px-4 py-2">Username</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Department</th>
                  <th className="px-4 py-2">Created</th>
                  <th className="px-4 py-2">Change role</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-gray-800/60 text-sm hover:bg-gray-800/20">
                    <td className="px-4 py-2 text-gray-200">
                      {u.username}
                      {u.id === currentUser?.id && <span className="text-gray-600 ml-1">(you)</span>}
                    </td>
                    <td className="px-4 py-2">
                      <Badge text={u.role} variant={roleVariant(u.role)} />
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-400">{u.department ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={u.role}
                        disabled={busyId === u.id}
                        onChange={(e) => changeRole(u, e.target.value)}
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 disabled:opacity-50"
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
            <div className="p-8 text-center text-sm text-gray-500">No users.</div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="ADMIN" value={users.filter((u) => u.role === "ADMIN").length} tone="red" />
        <Stat label="AUTHORITY" value={users.filter((u) => u.role === "AUTHORITY").length} tone="cyan" />
        <Stat label="VIEWER" value={users.filter((u) => u.role === "VIEWER").length} tone="default" />
      </div>
    </div>
  );
}