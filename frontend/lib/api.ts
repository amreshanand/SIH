export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TOKEN_KEY = "urbansense_token";
const USER_KEY = "urbansense_user";

export function getEvidenceImageUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) {
    return url;
  }
  const cleanPath = url.startsWith("/") ? url.slice(1) : url;
  return `${API_BASE}/${cleanPath}`;
}

export interface AuthUser {
  id: string;
  username: string;
  role: string;
  department: string | null;
}

export class APIError extends Error {
  status: number;
  detail: string;

  constructor(status: number, message: string) {
    super(message);
    this.name = "APIError";
    this.status = status;
    this.detail = message;
  }
}

interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  auth?: boolean;
}

async function fetchAPI<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { timeoutMs = 15000, auth = true, headers, ...rest } = options;

  const mergedHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers as Record<string, string>),
  };

  if (auth) {
    const token = typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : null;
    if (token) mergedHeaders["Authorization"] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: mergedHeaders,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new APIError(408, `Request timed out after ${timeoutMs}ms`);
    }
    throw new APIError(0, "Network error — backend unreachable");
  }
  clearTimeout(timer);

  if (!res.ok) {
    let detail = `API error: ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new APIError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const auth = {
  get token() {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(TOKEN_KEY);
  },
  get user(): AuthUser | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  },
  setToken(token: string) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TOKEN_KEY, token);
      window.dispatchEvent(new Event("auth-changed"));
    }
  },
  setUser(user: AuthUser) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(USER_KEY, JSON.stringify(user));
      window.dispatchEvent(new Event("auth-changed"));
    }
  },
  clear() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(USER_KEY);
      window.dispatchEvent(new Event("auth-changed"));
    }
  },
  async login(username: string, password: string) {
    const res = await fetchAPI<{ access_token: string; token_type: string; user: AuthUser }>(
      "/api/auth/login",
      { method: "POST", auth: false, body: JSON.stringify({ username, password }) }
    );
    this.setToken(res.access_token);
    this.setUser(res.user);
    return res;
  },
};

export const api = {
  getDashboardStats: () => fetchAPI<import("../types").DashboardStats>("/api/dashboard/stats"),

  getSystemHealth: () =>
    fetchAPI<import("../types").SystemHealth>("/api/system/health", { auth: false }),

  getSystemModels: () =>
    fetchAPI<{
      vehicle_model: { name: string; path: string; status: string; available: boolean; size_bytes: number };
      road_damage_model: { name: string; path: string; status: string; available: boolean; size_bytes: number; note: string };
    }>("/api/system/models", { auth: false }),

  getSpatialStatus: () =>
    fetchAPI<import("../types").SpatialStatus>("/api/system/spatial", { auth: false }),

  getInsights: (days = 7) => fetchAPI<import("../types").Insights>(`/api/analytics/insights?days=${days}`),

  getEvents: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchAPI<{ events: import("../types").Event[]; total: number }>(`/api/events${q}`);
  },

  createEvent: (data: Record<string, unknown>) =>
    fetchAPI("/api/events", { method: "POST", body: JSON.stringify(data) }),

  getIssues: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchAPI<{ issues: import("../types").Issue[]; total: number }>(`/api/issues${q}`);
  },

  getIssue: (id: string) => fetchAPI<import("../types").Issue>(`/api/issues/${id}`),

  getIssueTimeline: (id: string) =>
    fetchAPI<{ issue_id: string; status: string; timeline: Array<{ type: string; timestamp: string; data: Record<string, unknown> }> }>(
      `/api/issues/${id}/timeline`
    ),

  updateIssue: (id: string, data: Record<string, unknown>) =>
    fetchAPI<import("../types").Issue>(`/api/issues/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  assignIssue: (id: string, data: { authority_id: string; notes?: string }) =>
    fetchAPI(`/api/issues/${id}/assign`, { method: "POST", body: JSON.stringify(data) }),

  getIncidents: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchAPI<{ incidents: import("../types").Incident[]; total: number }>(`/api/incidents${q}`);
  },

  getIncident: (id: string) => fetchAPI<import("../types").Incident>(`/api/incidents/${id}`),

  getBuses: () => fetchAPI<import("../types").Bus[]>("/api/buses"),

  createBus: (data: { bus_number: string; route_id?: string | null; status?: string }) =>
    fetchAPI<import("../types").Bus>("/api/buses", { method: "POST", body: JSON.stringify(data) }),

  getBusLocations: () => fetchAPI<import("../types").BusLocation[]>("/api/buses/locations"),

  getBusLocation: (busId: string) => fetchAPI<import("../types").BusLocation>(`/api/buses/${busId}/location`),

  getBusCameras: (busId: string) =>
    fetchAPI<Array<{ id: string; bus_id: string; position: string; status: string; stream_url: string | null }>>(
      `/api/buses/${busId}/cameras`
    ),

  postBusTelemetry: (
    busId: string,
    data: { latitude: number; longitude: number; speed?: number; heading?: number; timestamp?: string }
  ) =>
    fetchAPI<{ status: string; telemetry: unknown }>(`/api/buses/${busId}/telemetry`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getRoutes: () => fetchAPI<import("../types").RouteResponse[]>("/api/buses/routes/all"),


  getNotifications: () => fetchAPI<{ notifications: import("../types").Notification[]; total: number; unread: number }>("/api/notifications"),

  markNotificationRead: (id: string) => fetchAPI<{ status: string }>(`/api/notifications/${id}/read`, { method: "PATCH" }),

  markAllNotificationsRead: () => fetchAPI<{ status: string }>("/api/notifications/read-all", { method: "POST" }),

  getAuthorities: () => fetchAPI<{ authorities: Array<{ id: string; username: string; department: string | null }> }>("/api/authorities"),

  getStreamStatus: () => fetchAPI<import("../types").StreamStatus>("/api/stream/status"),

  getFleet: () => fetchAPI<import("../types").FleetStatus>("/api/stream/fleet"),

  getVerificationHistory: (issueId: string) => fetchAPI<import("../types").Verification[]>(`/api/verification/issue/${issueId}`),

  getTraffic: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchAPI<{
      traffic: Array<{
        id: string;
        bus_id: string;
        road_segment: string;
        vehicle_count: number;
        vehicle_distribution: Record<string, number> | null;
        average_speed: number;
        congestion_score: number;
        latitude: number;
        longitude: number;
        bus_speed: number | null;
        created_at: string;
      }>; total: number
    }>(`/api/traffic${q}`);
  },

  getTrafficHeatmap: () =>
    fetchAPI<{ heatmap: Array<{ road_segment: string; avg_congestion: number; record_count: number; latitude: number; longitude: number }> }>("/api/traffic/heatmap"),

  getDemoStatus: () =>
    fetchAPI<{ buses: number; events: number; issues: number; incidents: number; lifecycle_steps: number }>("/api/demo/status"),

  seedDemo: () => fetchAPI<{ status: string } & Record<string, unknown>>("/api/demo/seed", { method: "POST" }),

  resetDemo: () => fetchAPI<{ status: string; message: string }>("/api/demo/reset", { method: "POST" }),

  stepDemo: (step: number) =>
    fetchAPI<Record<string, unknown>>("/api/demo/step", { method: "POST", body: JSON.stringify({ step }) }),

  runSihMode: () =>
    fetchAPI<{ status: string; total_steps: number; steps_completed: Array<Record<string, unknown>>; issue_created: string | null }>("/api/demo/sih", { method: "POST" }),

  runDemo: () => fetchAPI<{ status: string; total_steps: number; steps_completed: Array<{ step: number; action: string; message: string;[key: string]: unknown }>; issue_created: string | null }>("/api/demo/run", { method: "POST" }),

  getRoadHealth: () =>
    fetchAPI<{ roads: Array<{ department: string; issue_count: number; health_score: number }> }>("/api/analytics/road-health"),

  getRoutePerformance: () =>
    fetchAPI<{ total_detections: number; total_issues: number; resolved_issues: number; resolution_rate: number }>("/api/analytics/route-performance"),

  getOdMatrix: (days = 7) =>
    fetchAPI<import("../types").OdMatrix>(`/api/analytics/od-matrix?days=${days}`),

  getRouteDelays: () =>
    fetchAPI<{ routes: import("../types").RouteDelay[] }>("/api/analytics/route-delays"),

  getInfrastructure: () =>
    fetchAPI<import("../types").InfrastructureReport>("/api/analytics/infrastructure"),

  getUsers: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchAPI<{ users: import("../types").AdminUser[]; total: number }>(`/api/admin/users${q}`);
  },

  createUser: (data: { username: string; password?: string; role: string; department?: string }) =>
    fetchAPI<{ id: string; username: string; role: string }>("/api/admin/users", { method: "POST", body: JSON.stringify(data) }),

  updateUserRole: (userId: string, role: string) =>
    fetchAPI<{ id: string; role: string }>(`/api/admin/users/${userId}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),

  getAuditLogs: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchAPI<{ logs: import("../types").AuditLogEntry[]; total: number }>(`/api/admin/audit-logs${q}`);
  },

  createVerification: (data: Record<string, unknown>) =>
    fetchAPI<import("../types").VerificationPostResult>("/api/verification", { method: "POST", body: JSON.stringify(data) }),
};

export const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";
