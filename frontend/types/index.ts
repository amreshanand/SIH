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
  consensus_level?: string;
  unique_bus_count?: number;
  distinct_buses_observed?: string[];
  fused_confidence_score?: number;
  metadata_json: Record<string, unknown> | null;
  evidence_urls?: string[];
  chunk_id?: string;
  chunk_name?: string;
  chunk_chainage?: string;
  ward?: string;
  created_at: string;
  updated_at: string;
}

export interface RoadChunk {
  chunk_id: string;
  corridor_id: string;
  corridor_name: string;
  chunk_name: string;
  chainage: string;
  chainage_start_m: number;
  chainage_end_m: number;
  length_m: number;
  start_lat: number;
  start_lon: number;
  end_lat: number;
  end_lon: number;
  center_lat: number;
  center_lon: number;
  ward: string;
  polyline: [number, number][];
  health_score: number;
  status: "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
  active_issues_count: number;
  severity_breakdown: {
    CRITICAL: number;
    HIGH: number;
    MEDIUM: number;
    LOW: number;
  };
  issue_types: Record<string, number>;
  top_severity?: string;
  issues_preview?: Array<{
    issue_id: string;
    type: string;
    severity: string;
    status: string;
    lat: number;
    lon: number;
  }>;
}

export interface RoadChunksSummary {
  total_chunks: number;
  total_network_km: number;
  average_pci_health: number;
  total_active_defects: number;
  distribution: {
    excellent: number;
    good: number;
    fair: number;
    poor: number;
  };
  critical_hotspots: RoadChunk[];
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
  data: string | null;
  metadata_json: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
}

export interface TrafficRecord {
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

export interface AdminUser {
  id: string;
  username: string;
  role: string;
  department: string | null;
  created_at: string | null;
}

export interface AuditLogEntry {
  id: string;
  user_id: string | null;
  username: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string | null;
}

export interface Verification {
  id: string;
  issue_id: string;
  bus_id: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  detection_result: string;
  confidence: number;
  evidence_url: string | null;
  result: string;
}

export interface VerificationPostResult {
  issue_id: string;
  bus_id: string;
  detection_result: string;
  confidence: number;
  latitude: number;
  longitude: number;
  status: string;
  reason?: string | null;
  verification_id?: string | null;
  result?: string | null;
  unique_clear_count?: number;
  unique_detected_count?: number;
  issue_status?: string | null;
  timestamp?: string | null;
}

export interface SystemHealth {
  status: "ok" | "degraded";
  timestamp: number;
  database: { status: string; latency_ms: number };
  postgis?: { status: string };
  operational_state: "REAL" | "SIMULATED" | "DEMO" | "OFFLINE" | "MODEL_MISSING" | "DEGRADED";
  ai_state: "LIVE" | "UNAVAILABLE";
  ai_mode: string;
  vehicle_model_available: boolean;
  road_damage_model_available: boolean;
  postgis_available: boolean;
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

export interface OdMatrixEntry {
  route_name: string;
  origin: string;
  destination: string;
  trips: number;
  vehicles_observed: number;
  avg_congestion_score: number;
  est_travel_min: number;
}

export interface OdMatrix {
  label: string;
  matrix: OdMatrixEntry[];
}

export interface RouteDelay {
  route_name: string;
  start_stop: string;
  end_stop: string;
  distance_km: number;
  scheduled_duration_min: number;
  estimated_duration_min: number;
  delay_min: number;
  avg_congestion_score: number;
  avg_speed_kph: number;
  status: "ON_TIME" | "DELAYED" | "SEVERE";
  label: string;
}

export interface InfrastructureDeficiency {
  category: string;
  count: number;
  severity_weight: number;
  deficiency_score: number;
  affected_stops: string[];
  recommendation: string;
}

export interface InfrastructureReport {
  label: string;
  categories: InfrastructureDeficiency[];
}

export interface FleetCamera {
  camera: string;
  url: string;
  active: boolean;
}

export interface FleetEvent {
  event_id: string;
  event_type: string;
  severity: string;
  confidence: number;
  created_at: string;
}

export interface FleetBus {
  bus_id: string;
  route_id: string;
  route_name: string;
  status: "LIVE" | "STANDBY";
  fps: number;
  ai_mode: string;
  gps_mode: string;
  latitude: number;
  longitude: number;
  vehicle_counts: Record<string, number>;
  events_today: number;
  incidents_today: number;
  cameras: FleetCamera[];
  recent_events: FleetEvent[];
}

export interface FleetStatus {
  generated_at: string;
  total_buses: number;
  live_buses: number;
  cameras_online: number;
  buses: FleetBus[];
}

export interface CameraStatusInfo {
  camera_id: string;
  camera_type: string;
  fps?: number;
  counts?: Record<string, number>;
  unique_tracks?: number;
}

export interface StreamStatus {
  running: boolean;
  source: string;
  youtube_live_url?: string;
  youtube_rear_url?: string;
  youtube_left_url?: string;
  youtube_right_url?: string;
  youtube_cabin_url?: string;
  front_stream_url?: string;
  inside_stream_url?: string;
  bus_id: string;
  camera: string;
  fps: number;
  ai_mode?: string;
  gps_mode?: string;
  vehicle_counts?: Record<string, number>;
  unique_tracks?: number;
  cameras?: CameraStatusInfo[];
}

export interface RouteStop {
  name: string;
  lat: number;
  lon: number;
}

export interface RouteResponse {
  id: string;
  route_name: string;
  start_stop: string;
  end_stop: string;
  stops?: RouteStop[] | Record<string, unknown>;
  distance_km?: number;
  scheduled_duration_min?: number;
  created_at: string;
}

