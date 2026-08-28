export interface Bus {
  id: string;
  bus_number: string;
  route_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface BusLocation {
  bus_id: string;
  bus_number: string;
  status: string;
  route_id: string | null;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  heading: number | null;
  last_updated: string | null;
  source: string | null;
}


export interface Event {
  id: string;
  event_id: string;
  event_type: string;
  bus_id: string;
  camera_id: string | null;
  severity: string;
  confidence: number;
  latitude: number;
  longitude: number;
  evidence_url: string | null;
  metadata_json: Record<string, unknown> | null;
  source: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Issue {
  id: string;
  issue_id: string;
  issue_type: string;
  severity: string;
  confidence: number;
  latitude: number;
  longitude: number;
  first_seen: string;
  last_seen: string;
  observation_count: number;
  affected_road: string | null;
  department: string | null;
  status: string;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Incident {
  id: string;
  incident_id: string;
  incident_type: string;
  bus_id: string;
  severity: string;
  confidence: number;
  latitude: number;
  longitude: number;
  plate_text: string | null;
  plate_confidence: number | null;
  evidence_url: string | null;
  source?: string;
  status: string;
  created_at: string;
}

export interface DashboardStats {
  active_buses: number;
  events_today: number;
  open_issues: number;
  critical_incidents: number;
  traffic_hotspots: number;
  resolved_issues: number;
  total_events: number;
  total_issues: number;
  total_incidents: number;
}

export interface Notification {
  id: string;
  user_id: string;
  notification_type: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
}

export interface TrafficRecord {
  id: string;
  road_segment: string;
  vehicle_count: number;
  average_speed: number;
  congestion_score: number;
  latitude: number;
  longitude: number;
  created_at: string;
}

export interface IssueTimeline {
  issue_id: string;
  status: string;
  timeline: Array<{
    type: string;
    timestamp: string;
    data: Record<string, unknown>;
  }>;
}

export interface DemoStep {
  step: number;
  action: string;
  message: string;
  [key: string]: unknown;
}

export interface CapabilityBadge {
  mode: string;
  detail: string;
  live: boolean;
  simulated?: boolean;
  [key: string]: unknown;
}

export interface SystemHealth {
  status: "ok" | "degraded";
  timestamp: number;
  database: { status: string; latency_ms: number };
  postgis: { status: string };
  ai_mode: string;
  gps_mode: string;
  demo_mode: boolean;
  debug: boolean;
  bus_id: string | null;
  camera: string | null;
  spatial_engine: string;
  pipeline: string;
  capabilities: Record<string, CapabilityBadge>;
  production: boolean;
}

export interface SpatialStatus {
  engine: string;
  postgis_installed: boolean;
  geometry_tables: string[];
  gist_indexes: string[];
  cluster_distance_meters: number;
  note: string;
}

export interface Insights {
  range_days: number;
  detections_per_day: Array<{ day: string; count: number }>;
  issue_trend: Array<{ day: string; count: number }>;
  severity_distribution: Record<string, number>;
  resolution: Record<string, unknown>;
  verification: Record<string, unknown>;
  road_health: Record<string, unknown>;
  traffic: Record<string, unknown>;
  hotspots: Array<{ latitude: number; longitude: number; count: number }>;
  sentences: string[];
}

