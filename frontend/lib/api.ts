const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TOKEN_KEY = "urbansense_token";

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
  setToken(token: string) {
    if (typeof window !== "undefined") window.localStorage.setItem(TOKEN_KEY, token);
  },
  clear() {
    if (typeof window !== "undefined") window.localStorage.removeItem(TOKEN_KEY);
  },
  async login(username: string, password: string) {
    const res = await fetchAPI<{ access_token: string; token_type: string; user: Record<string, unknown> }>(
      "/api/auth/login",
      { method: "POST", auth: false, body: JSON.stringify({ username, password }) }
    );
    this.setToken(res.access_token);
    return res;
  },
};

export const api = {
  getDashboardStats: () => fetchAPI<import("../types").DashboardStats>("/api/dashboard/stats"),

  getSystemHealth: () =>
    fetchAPI<import("../types").SystemHealth>("/api/system/health", { auth: false }),

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

  getBusLocations: () => fetchAPI<import("../types").BusLocation[]>("/api/buses/locations"),

  getBusLocation: (busId: string) => fetchAPI<import("../types").BusLocation>(`/api/buses/${busId}/location`),


  getNotifications: () => fetchAPI<{ notifications: import("../types").Notification[]; total: number; unread: number }>("/api/notifications"),

  getAuthorities: () => fetchAPI<{ authorities: Array<{ id: string; username: string; department: string | null }> }>("/api/authorities"),

  getStreamStatus: () => fetchAPI<import("../types").StreamStatus>("/api/stream/status"),

  getVerificationHistory: (issueId: string) => fetchAPI(`/api/verification/issue/${issueId}`),

  getTraffic: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchAPI<{ traffic: Array<{ id: string; road_segment: string; vehicle_count: number; average_speed: number; congestion_score: number; latitude: number; longitude: number; created_at: string }>; total: number }>(`/api/traffic${q}`);
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

  runDemo: () => fetchAPI<{ status: string; total_steps: number; steps_completed: Array<{ step: number; action: string; message: string; [key: string]: unknown }>; issue_created: string | null }>("/api/demo/run", { method: "POST" }),

  getRoadHealth: () =>
    fetchAPI<{ roads: Array<{ department: string; issue_count: number; health_score: number }> }>("/api/analytics/road-health"),

  getRoutePerformance: () =>
    fetchAPI<{ total_detections: number; total_issues: number; resolved_issues: number; resolution_rate: number }>("/api/analytics/route-performance"),
};

export const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";
