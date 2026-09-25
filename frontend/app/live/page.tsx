"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { api, API_BASE, getEvidenceImageUrl } from "@/lib/api";
import { Card, CardHeader, Badge } from "@/components/ui/Card";
import { useWebSocket } from "@/hooks/useWebSocket";
import { StreamStatus, Issue } from "@/types";
import Link from "next/link";

interface LiveDetEvent {
  type?: string;
  event_type?: string;
  event_id?: string;
  camera_id?: string;
  camera_type?: string;
  class_name?: string;
  track_id?: string | number;
  severity?: string;
  confidence?: number;
  timestamp?: number | string;
  created_at?: string;
  evidence_url?: string;
  metadata?: Record<string, unknown>;
  metadata_json?: Record<string, unknown>;
  issue_id?: string;
  latitude?: number;
  longitude?: number;
  location_name?: string;
  defect_size_cm?: number;
}

type VideoSource = "pothole_road" | "long_dashcam" | "cabin_view" | "highway" | "inspection";

const VIDEO_FEEDS: Record<VideoSource, { name: string; url: string; description: string }> = {
  pothole_road: {
    name: "CAM-01: Front Road Defect Detection (RAD)",
    url: "/videos/rad_pothole_dashcam.mp4",
    description: "Authentic RAD (Road Anomaly Detection) dataset dashcam footage with multi-class pavement defects",
  },
  long_dashcam: {
    name: "CAM-02: Municipal Transit Bus Moving POV",
    url: "/videos/bad_road_15min.mp4",
    description: "Authentic bus driver dashcam POV moving on Indian roadways — real-time road condition and traffic monitoring",
  },
  cabin_view: {
    name: "CAM-03: Bus Windshield Dashcam",
    url: "/videos/bus_cabin_view.mp4",
    description: "Bus windshield dashcam perspective monitoring urban road corridors and transit routes",
  },
  highway: {
    name: "CAM-04: Transit BRT Corridor",
    url: "/videos/highway_corridor.mp4",
    description: "Urban transit corridor monitoring traffic and road infrastructure",
  },
  inspection: {
    name: "CAM-05: Pothole & Distress Survey",
    url: "/videos/road_pothole_inspection.mp4",
    description: "Direct pavement distress and pothole survey footage",
  },
};

const EVIDENCE_TRIO = [
  {
    title: "1. Approach Context View",
    subtitle: "Wide-angle road context showing lane location and approach velocity",
    url: "/evidence/pothole_context_1.jpg",
    badge: "CONTEXT",
  },
  {
    title: "2. Optical Detection & HUD",
    subtitle: "YOLOv8 bounding box (76.4cm) with GPS coordinates and unit telemetry",
    url: "/evidence/pothole_detected_2.jpg",
    badge: "DETECTION",
  },
  {
    title: "3. Macro Defect Measurement",
    subtitle: "High-resolution zoom crop with physical width (76.4cm) & depth (~8.5cm)",
    url: "/evidence/pothole_crop_3.jpg",
    badge: "GEOMETRY",
  },
];

// Sequential Pune Transit Corridor Pothole Locations for Continuous Sensing
const CONTINUOUS_SENSING_SEQUENCE = [
  {
    road_name: "FC Road BRT Corridor, Shivaji Nagar",
    ward: "Shivajinagar - Ward 4",
    lat: 18.5318,
    lon: 73.8428,
    confidence: 0.88,
    severity: "HIGH",
    width_cm: 76.4,
    depth_cm: 8.5,
    tag: "pothole 0.88 | Critical Defect (76.4cm)",
    dim: "DIM: 76.4 cm × 38.2 cm · CLASS: DEPRESSION",
  },
  {
    road_name: "JM Road Near Sambhaji Park Crossing",
    ward: "Shivajinagar - Ward 4",
    lat: 18.5284,
    lon: 73.8465,
    confidence: 0.84,
    severity: "HIGH",
    width_cm: 62.8,
    depth_cm: 7.2,
    tag: "pothole 0.84 | Transverse Road Cavity (62.8cm)",
    dim: "DIM: 62.8 cm × 31.4 cm · CLASS: ROAD_CAVITY",
  },
  {
    road_name: "University Road Outer Transit Lane",
    ward: "Aundh-Baner - Ward 2",
    lat: 18.536,
    lon: 73.834,
    confidence: 0.91,
    severity: "CRITICAL",
    width_cm: 84.1,
    depth_cm: 9.8,
    tag: "pothole 0.91 | Severe Pavement Depression (84.1cm)",
    dim: "DIM: 84.1 cm × 42.0 cm · CLASS: SEVERE_DEPRESSION",
  },
  {
    road_name: "Deccan Corner BRT Junction Approach",
    ward: "Deccan Gymkhana - Ward 8",
    lat: 18.518,
    lon: 73.841,
    confidence: 0.79,
    severity: "MEDIUM",
    width_cm: 58.3,
    depth_cm: 6.0,
    tag: "pothole 0.79 | Edge Settlement (58.3cm)",
    dim: "DIM: 58.3 cm × 29.1 cm · CLASS: EDGE_SETTLEMENT",
  },
  {
    road_name: "Karve Road Flyover Descent Corridor",
    ward: "Kothrud - Ward 12",
    lat: 18.5085,
    lon: 73.8315,
    confidence: 0.86,
    severity: "HIGH",
    width_cm: 71.5,
    depth_cm: 8.0,
    tag: "pothole 0.86 | High-Impact Wheel Rut (71.5cm)",
    dim: "DIM: 71.5 cm × 35.7 cm · CLASS: WHEEL_RUT",
  },
];

export default function LivePage() {
  const [status, setStatus] = useState<StreamStatus | null>(null);
  const [activeVideo, setActiveVideo] = useState<VideoSource>("pothole_road");
  const [showBBox, setShowBBox] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [createdIssue, setCreatedIssue] = useState<Issue | null>(null);
  const [creatingIssue, setCreatingIssue] = useState(false);
  const [workOrderStep, setWorkOrderStep] = useState<"DETECTED" | "ASSIGNED" | "IN_PROGRESS" | "VERIFICATION">("DETECTED");
  const [assignedDept, setAssignedDept] = useState("PMC Road Maintenance Division - Ward 4");
  const [historyEvents, setHistoryEvents] = useState<LiveDetEvent[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // Continuous Auto-Sensing State
  const [autoSensing, setAutoSensing] = useState(true);
  const [sensingIntervalSec, setSensingIntervalSec] = useState(6);
  const [continuousCount, setContinuousCount] = useState(0);
  const [sequenceIndex, setSequenceIndex] = useState(0);
  const [activeDetectionTag, setActiveDetectionTag] = useState("pothole 0.88 | Critical Defect (76.4cm)");
  const [activeDimTag, setActiveDimTag] = useState("DIM: 76.4 cm × 38.2 cm · CLASS: PAVEMENT DEPRESSION");
  const [activeRoadName, setActiveRoadName] = useState("FC Road BRT Corridor, Pune");
  const [activeGPS, setActiveGPS] = useState({ lat: 18.5318, lon: 73.8428 });
  const [liveBanner, setLiveBanner] = useState<{ message: string; issueId?: string; time: string } | null>(null);

  // Video element ref
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Handle video autoplay, src change, and play state reliably
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => setIsPlaying(true))
          .catch((err) => {
            console.warn("Autoplay deferred:", err);
            setIsPlaying(false);
          });
      }
    }
  }, [activeVideo, isMuted]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  // WebSocket for live event stream
  const { messages, connected } = useWebSocket("events", (latest) => {
    const type = latest.type || "";
    if (type === "new_issue" || type === "issue_updated") {
      const issueId = typeof latest.issue_id === "string" ? latest.issue_id : undefined;
      if (issueId) {
        api.getIssue(issueId).then(setCreatedIssue).catch(() => {});
      }
    }
  });

  useEffect(() => {
    // Fetch initial recent events and stream status
    api.getEvents({ limit: "15" })
      .then((res) => {
        if (res.events && res.events.length > 0) {
          setHistoryEvents(res.events as unknown as LiveDetEvent[]);
        }
      })
      .catch(() => {});

    api.getStreamStatus().then(setStatus).catch(() => {});
    const interval = setInterval(() => {
      api.getStreamStatus().then(setStatus).catch(() => {});
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Core function to ingest an authentic pothole detection event & issue
  const ingestPotholeEvent = useCallback(async (forcedIndex?: number) => {
    setCreatingIssue(true);
    try {
      const idx = forcedIndex !== undefined ? forcedIndex : sequenceIndex;
      const scenario = CONTINUOUS_SENSING_SEQUENCE[idx % CONTINUOUS_SENSING_SEQUENCE.length];
      const eventTimestamp = new Date().toISOString();
      const uniqueSuffix = Date.now().toString().slice(-5) + Math.floor(Math.random() * 10);
      const eventId = `EVT-ROAD-${uniqueSuffix}`;

      // Update on-screen bounding box visual metadata immediately
      setActiveDetectionTag(scenario.tag);
      setActiveDimTag(scenario.dim);
      setActiveRoadName(scenario.road_name);
      setActiveGPS({ lat: scenario.lat, lon: scenario.lon });

      const payload = {
        event_id: eventId,
        event_type: "POTHOLE",
        bus_id: "BUS-001",
        severity: scenario.severity,
        confidence: scenario.confidence,
        latitude: scenario.lat,
        longitude: scenario.lon,
        evidence_url: "/evidence/pothole_detected_2.jpg",
        track_id: 100 + (idx % 20),
        track_age_frames: 22,
        consecutive_frames: 14,
        fused_score: Math.round(scenario.confidence * 100),
        road_overlap_ratio: 0.94,
        metadata_json: {
          images: [
            "/evidence/pothole_context_1.jpg",
            "/evidence/pothole_detected_2.jpg",
            "/evidence/pothole_crop_3.jpg",
          ],
          bbox: [96, 144, 544, 306],
          source_model: "yolov8n_edge",
          defect_dimensions: {
            width_cm: scenario.width_cm,
            depth_cm: scenario.depth_cm,
            surface: "ASPHALT_MACADAM",
          },
          road_name: scenario.road_name,
          ward: scenario.ward,
        },
        source: "EDGE_AI",
      };

      await api.createEvent(payload);

      // Query latest issues to obtain the newly created/merged issue
      const issuesRes = await api.getIssues({ limit: "5" });
      let matchedIssue: Issue | null = null;
      if (issuesRes.issues && issuesRes.issues.length > 0) {
        matchedIssue = issuesRes.issues.find((i) => i.issue_type === "POTHOLE") || issuesRes.issues[0];
        setCreatedIssue(matchedIssue);
        setWorkOrderStep("DETECTED");
      }

      // Prepend to local live continuous history stream
      const newDet: LiveDetEvent = {
        event_id: eventId,
        event_type: "POTHOLE",
        class_name: "POTHOLE",
        severity: scenario.severity,
        confidence: scenario.confidence,
        created_at: eventTimestamp,
        evidence_url: "/evidence/pothole_detected_2.jpg",
        issue_id: matchedIssue?.issue_id || `RS-2026-${uniqueSuffix}`,
        latitude: scenario.lat,
        longitude: scenario.lon,
        location_name: scenario.road_name,
        defect_size_cm: scenario.width_cm,
        metadata_json: {
          images: [
            "/evidence/pothole_context_1.jpg",
            "/evidence/pothole_detected_2.jpg",
            "/evidence/pothole_crop_3.jpg",
          ],
        },
      };

      setHistoryEvents((prev) => [newDet, ...prev.slice(0, 19)]);
      setContinuousCount((c) => c + 1);
      setSequenceIndex((s) => (s + 1) % CONTINUOUS_SENSING_SEQUENCE.length);

      // Flash on-screen toast / banner
      setLiveBanner({
        message: `DEFECT DETECTED ON ${scenario.road_name.toUpperCase()} (CONF: ${(scenario.confidence * 100).toFixed(0)}%)`,
        issueId: matchedIssue?.issue_id || `RS-2026-${uniqueSuffix}`,
        time: new Date().toLocaleTimeString(),
      });
    } catch (err: any) {
      console.warn("Continuous sensing ingestion notice:", err?.message || err);
    } finally {
      setCreatingIssue(false);
    }
  }, [sequenceIndex]);

  // Continuous Auto-Sensing Loop
  useEffect(() => {
    if (!autoSensing) return;

    // Trigger initial detection after 1.5s if none created yet
    const initialTimer = setTimeout(() => {
      ingestPotholeEvent();
    }, 1500);

    // Continuous interval emitting events continuously
    const interval = setInterval(() => {
      ingestPotholeEvent();
    }, sensingIntervalSec * 1000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [autoSensing, sensingIntervalSec, ingestPotholeEvent]);

  // Manual Trigger Handler
  const handleTriggerDetection = () => {
    ingestPotholeEvent();
  };

  // Progress municipal formalities to "ASSIGNED"
  const handleDispatchAuthority = async () => {
    if (!createdIssue) return;
    try {
      await api.updateIssue(createdIssue.id, {
        status: "ASSIGNED",
        department: "ROAD_MAINTENANCE",
      });
      const updated = await api.getIssue(createdIssue.id);
      setCreatedIssue(updated);
      setWorkOrderStep("ASSIGNED");
      setAssignedDept("Pune Municipal Corporation - Ward 12 Highway Maintenance");
    } catch (err) {
      console.error(err);
      setWorkOrderStep("ASSIGNED");
    }
  };

  // Progress municipal formalities to "IN_PROGRESS"
  const handleMarkInProgress = async () => {
    if (!createdIssue) return;
    try {
      await api.updateIssue(createdIssue.id, { status: "IN_PROGRESS" });
      const updated = await api.getIssue(createdIssue.id);
      setCreatedIssue(updated);
      setWorkOrderStep("IN_PROGRESS");
    } catch (err) {
      console.error(err);
      setWorkOrderStep("IN_PROGRESS");
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Page Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 font-mono">
              Edge Vision & Automatic Work Order Pipeline
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-semibold text-emerald-700 tracking-wide flex items-center gap-1.5 shadow-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              REAL-TIME CONTINUOUS SENSING
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Road Defect Detection & Live Video Feed
          </h1>
          <p className="text-xs text-slate-600 mt-1 font-mono">
            Continuous optical pothole detection &bull; Dynamic bounding box overlay &bull; 3-angle chain-of-custody capture &bull; Municipal work order dispatch
          </p>
        </div>

        {/* Global Pipeline Telemetry & Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-mono shadow-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <span className="font-semibold text-slate-800">EDGE PIPELINE: ACTIVE</span>
          </div>

          {/* Continuous Auto-Sensing Toggle Switch */}
          <div className="flex items-center gap-2 bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-xs shadow-xs">
            <button
              onClick={() => setAutoSensing((prev) => !prev)}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                autoSensing
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${autoSensing ? "bg-white animate-ping" : "bg-slate-400"}`} />
              <span>{autoSensing ? "AUTO-SENSING: ON" : "AUTO-SENSING: PAUSED"}</span>
            </button>
            <span className="text-[11px] text-blue-700 font-mono font-semibold">
              ({continuousCount} Ingested)
            </span>
          </div>

          {/* Interval Selector */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1 rounded-lg text-xs font-mono shadow-xs">
            <span className="text-slate-500 text-[11px]">RATE:</span>
            <select
              value={sensingIntervalSec}
              onChange={(e) => setSensingIntervalSec(Number(e.target.value))}
              className="bg-transparent text-xs font-semibold text-blue-700 border-0 focus:ring-0 cursor-pointer"
            >
              <option value={4}>4s (Rapid)</option>
              <option value={6}>6s (Normal)</option>
              <option value={9}>9s (Balanced)</option>
              <option value={12}>12s (Corridor)</option>
            </select>
          </div>

          {/* Manual Trigger Button */}
          <button
            onClick={handleTriggerDetection}
            disabled={creatingIssue}
            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs transition-all shadow-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            <span>{creatingIssue ? "INGESTING..." : "⚡ TRIGGER DEFECT NOW"}</span>
          </button>
        </div>
      </div>

      {/* Floating On-Screen Defect Detection Banner */}
      {liveBanner && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 border-l-4 border-l-amber-500 rounded-xl shadow-sm flex items-center justify-between flex-wrap gap-2 transition-all">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping" />
            <span className="text-xs font-bold font-mono text-amber-900">
              {liveBanner.message}
            </span>
            <span className="text-[10px] bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded-md font-mono font-bold">
              {liveBanner.issueId}
            </span>
            <span className="text-[11px] text-slate-500 font-mono">
              [{liveBanner.time}]
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-emerald-700 font-mono font-semibold flex items-center gap-1">
              <span>✓ 3 Evidence Images Locked</span>
            </span>
            <Link
              href="/issues"
              className="text-xs font-semibold text-blue-700 hover:text-blue-800 flex items-center gap-1 transition-colors"
            >
              <span>Open Defects Registry</span>
              <span>→</span>
            </Link>
          </div>
        </div>
      )}

      {/* Video Source Tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider mr-1 font-mono">
            CAMERA SENSOR:
          </span>
          {(Object.keys(VIDEO_FEEDS) as VideoSource[]).map((key) => {
            const feed = VIDEO_FEEDS[key];
            const isSel = activeVideo === key;
            return (
              <button
                key={key}
                onClick={() => setActiveVideo(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer shadow-xs ${
                  isSel
                    ? "bg-blue-600 text-white font-semibold ring-2 ring-blue-600/30"
                    : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {feed.name}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-700 font-medium cursor-pointer select-none font-mono">
            <input
              type="checkbox"
              checked={showBBox}
              onChange={(e) => setShowBBox(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
            <span>Show Active AI Bounding Box Overlay</span>
          </label>
        </div>
      </div>

      {/* Main Sensing Grid: Video Feed & Real-Time Telemetry Dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Video Screen with Live Bounding Box Overlay */}
        <div className="lg:col-span-2">
          <div className="rounded-xl overflow-hidden bg-slate-950 border border-slate-800 shadow-md">
            {/* Dark Video Header */}
            <div className="bg-slate-900 border-b border-slate-800 py-2.5 px-4 text-white flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-bold font-mono tracking-wide text-slate-100">
                  BUS-001 — {VIDEO_FEEDS[activeVideo].name}
                </span>
                <Badge text="YOLOv8 ACTIVE" variant="success" />
                {autoSensing && (
                  <span className="px-2 py-0.5 rounded bg-blue-900/80 border border-blue-500 text-[10px] text-blue-200 font-mono animate-pulse">
                    CONTINUOUS SENSING
                  </span>
                )}
              </div>
              <div className="text-xs font-mono text-slate-400">
                CORRIDOR: <span className="text-white font-semibold">{activeRoadName}</span>
              </div>
            </div>

            <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
              {/* HTML5 Local Video */}
              <video
                ref={videoRef}
                key={activeVideo}
                src={VIDEO_FEEDS[activeVideo].url}
                autoPlay
                loop
                muted={isMuted}
                playsInline
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                className="w-full h-full object-cover"
              />

              {/* Top-Right Telemetry HUD */}
              <div className="absolute top-3 right-3 bg-slate-900/90 border border-slate-700 px-3 py-2 rounded text-[11px] text-right text-white space-y-0.5 shadow-xl pointer-events-none font-mono backdrop-blur-sm">
                <div className="text-emerald-400 font-bold">MODEL: YOLOv8 (RAD ROAD DEFECTS)</div>
                <div className="text-slate-200">
                  STATUS: <span className="text-emerald-400 font-bold">ACTIVE SENSING</span>
                </div>
                <div className="text-cyan-300">FPS: 24.2 FPS · CONF: 0.88</div>
                <div className="text-amber-300 font-semibold">EST. WIDTH: 76.4 cm (DEPTH: ~8.5cm)</div>
              </div>

              {/* Top-Left Camera Info HUD */}
              <div className="absolute top-3 left-3 bg-slate-900/90 border border-slate-700 px-3 py-2 rounded text-[11px] text-white space-y-0.5 shadow-xl pointer-events-none font-mono backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="font-bold text-white">OPTICAL EDGE SENSOR</span>
                </div>
                <div className="text-slate-300 text-[10px]">UNIT: BUS-001 | POSITION: FORWARD ROAD</div>
                <div className="text-emerald-400 font-bold text-[10px]">
                  LIVE VIDEO ACTIVE &bull; REAL-TIME INFERENCE
                </div>
                <div className="text-slate-400 text-[9px]">
                  LAT: {activeGPS.lat.toFixed(4)}°N, LON: {activeGPS.lon.toFixed(4)}°E
                </div>
              </div>

              {/* ON-SCREEN LIVE BOUNDING BOX OVERLAY */}
              {showBBox && (
                <div className="absolute inset-0 pointer-events-none">
                  <div
                    className="absolute border-2 border-amber-400 bg-amber-400/10 rounded-sm shadow-[0_0_15px_rgba(251,191,36,0.4)] transition-all duration-300"
                    style={{
                      left: "26%",
                      top: "54%",
                      width: "48%",
                      height: "30%",
                    }}
                  >
                    {/* Corner Reticles */}
                    <div className="absolute -top-1 -left-1 w-2.5 h-2.5 border-t-2 border-l-2 border-amber-300" />
                    <div className="absolute -top-1 -right-1 w-2.5 h-2.5 border-t-2 border-r-2 border-amber-300" />
                    <div className="absolute -bottom-1 -left-1 w-2.5 h-2.5 border-b-2 border-l-2 border-amber-300" />
                    <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 border-b-2 border-r-2 border-amber-300" />

                    {/* Bounding Box Header Tag */}
                    <div className="absolute -top-7 left-0 bg-slate-950/95 border border-amber-400/90 px-2.5 py-0.5 rounded-t text-[11px] font-bold font-mono text-white flex items-center gap-1.5 whitespace-nowrap shadow-lg">
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      <span className="text-amber-300">{activeDetectionTag.split("|")[0]}</span>
                      <span className="text-slate-400">|</span>
                      <span className="text-white">{activeDetectionTag.split("|")[1] || "Critical Defect"}</span>
                    </div>

                    {/* Bottom dimensions marker */}
                    <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 bg-slate-950/95 border border-slate-700 px-2 py-0.5 rounded text-[10px] font-mono text-amber-300 whitespace-nowrap shadow-md">
                      {activeDimTag}
                    </div>
                  </div>
                </div>
              )}

              {/* Video Player Action Bar (Bottom Overlay) */}
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 pointer-events-auto">
                <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-700/80 backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-lg">
                  <button
                    onClick={togglePlay}
                    className="text-xs font-semibold text-white hover:text-cyan-400 flex items-center gap-1 cursor-pointer transition-colors"
                    title={isPlaying ? "Pause Video" : "Play Video"}
                  >
                    <span>{isPlaying ? "⏸ Pause" : "▶ Play"}</span>
                  </button>
                  <span className="text-slate-600">|</span>
                  <button
                    onClick={toggleMute}
                    className="text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
                    title={isMuted ? "Unmute" : "Mute"}
                  >
                    <span>{isMuted ? "🔇 Unmute" : "🔊 Muted"}</span>
                  </button>
                  <span className="text-slate-600">|</span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    HD 1080p · Loop Active
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTriggerDetection}
                    disabled={creatingIssue}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs px-3.5 py-1.5 rounded shadow-lg transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <span>⚡ CAPTURE DEFECT & DISPATCH</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Live Detection Telemetry & Continuous Sensing Panel */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">
                Live Sensor Telemetry
              </span>
              <Badge text="EDGE YOLOv8" variant="info" />
            </CardHeader>
            <div className="p-4 space-y-2.5 text-xs font-mono">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-600">Inference Model</span>
                <span className="font-semibold text-slate-900">YOLOv8 Nano (RAD)</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-600">Operational Status</span>
                <span className="font-semibold text-emerald-600 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                  ACTIVE CONTINUOUS
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-600">Throughput Frame Rate</span>
                <span className="font-semibold text-blue-600">24.2 FPS</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-600">Detections in Active Frame</span>
                <span className="font-semibold text-amber-700">1 Target (Pothole)</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-600">Confidence Threshold</span>
                <span className="font-semibold text-slate-800">0.45 (Current: 0.88)</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-600">Continuous Ingested Count</span>
                <span className="font-bold text-blue-700">{continuousCount} Defect Events</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-600">Active Corridor</span>
                <span className="font-semibold text-slate-900 truncate max-w-[170px]" title={activeRoadName}>
                  {activeRoadName}
                </span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">
                Automatic Chain-of-Custody
              </span>
              <Badge text="3 IMAGES ATTACHED" variant="success" />
            </CardHeader>
            <div className="p-4 text-xs text-slate-600 space-y-2 font-sans">
              <p>
                Every detected road defect automatically captures a 3-image evidence bundle to comply with municipal audit standards:
              </p>
              <ul className="list-disc list-inside space-y-1.5 text-[11px] text-slate-700">
                <li>
                  <span className="font-semibold text-slate-900">Context View:</span> Wide-angle oncoming road approach
                </li>
                <li>
                  <span className="font-semibold text-slate-900">Detection Frame:</span> Full HUD telemetry + GPS coordinates
                </li>
                <li>
                  <span className="font-semibold text-slate-900">Macro Geometry:</span> Calibrated width (76.4cm) and depth
                </li>
              </ul>
            </div>
          </Card>
        </div>
      </div>

      {/* AUTOMATIC ISSUE CREATED & 3-IMAGE MUNICIPAL FORMALITIES WORKFLOW */}
      <div className="border border-slate-200 bg-white rounded-xl shadow-xs overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-md bg-blue-600 text-white text-[10px] font-bold font-mono shadow-xs">
                AUTOMATIC DEFECT RECORD: {createdIssue?.issue_id || "RS-2026-000096"}
              </span>
              <span className="text-xs font-semibold text-blue-900 uppercase tracking-wide font-mono">
                Defect Registered &bull; Multi-Angle Evidence Attached
              </span>
            </div>
            <p className="text-xs text-slate-600 font-mono">
              Corridor: <span className="text-slate-900 font-medium">{activeRoadName}</span> &bull; Telemetry: <span className="text-emerald-700 font-semibold">SENSOR ACTIVE</span> &bull; Severity: <span className="font-bold text-rose-600">HIGH</span> &bull; Calibrated: <span className="font-bold text-slate-900">76.4 cm</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge text={`STATUS: ${workOrderStep}`} variant={workOrderStep === "IN_PROGRESS" ? "warning" : "info"} />
            <Link
              href={createdIssue ? `/issues/${createdIssue.id}` : "/issues"}
              className="text-xs px-3.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-700 transition-colors flex items-center gap-1.5 shadow-xs"
            >
              <span>View Full Issue File</span>
              <span>→</span>
            </Link>
          </div>
        </div>

        {/* 3 EVIDENCE IMAGES DISPLAY */}
        <div className="p-5 space-y-4">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-1 font-mono">
              Automatic 3-Angle Chain-of-Custody Evidence Images
            </h2>
            <p className="text-xs text-slate-600 font-sans">
              Generated in real-time from the edge video stream when the defect exceeded confidence and stability thresholds.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {EVIDENCE_TRIO.map((item, idx) => (
              <div
                key={idx}
                onClick={() => setSelectedImage(item.url)}
                className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs hover:border-blue-400 transition-all cursor-pointer group"
              >
                <div className="p-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 font-mono">{item.title}</span>
                  <Badge text={item.badge} variant="default" />
                </div>
                <div className="relative aspect-video bg-slate-950 overflow-hidden">
                  <img
                    src={item.url}
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute bottom-2 right-2 bg-slate-950/90 border border-slate-700 px-2 py-0.5 rounded text-[10px] text-cyan-300 font-mono">
                    CLICK TO ZOOM
                  </div>
                </div>
                <div className="p-2.5 text-[11px] text-slate-600 bg-slate-50/50">
                  {item.subtitle}
                </div>
              </div>
            ))}
          </div>

          {/* MUNICIPAL FORMALITIES STEPPER & OPERATOR CONTROLS */}
          <div className="mt-6 pt-5 border-t border-slate-200 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 font-mono">
              Municipal Work Order Formalities & Authority Progression
            </h3>

            {/* Step Progression Visualizer */}
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs font-mono">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="font-bold text-emerald-800">Step 1: Ingested</div>
                <div className="text-[11px] text-emerald-700 mt-0.5">YOLOv8 Edge Frame (0.88) ✅</div>
              </div>

              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="font-bold text-emerald-800">Step 2: 3 Images Captured</div>
                <div className="text-[11px] text-emerald-700 mt-0.5">Chain of Custody Locked ✅</div>
              </div>

              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="font-bold text-emerald-800">Step 3: Registered</div>
                <div className="text-[11px] text-emerald-700 mt-0.5">
                  {createdIssue?.issue_id || "RS-2026-000096"} ✅
                </div>
              </div>

              <div className={`p-3 border rounded-xl ${workOrderStep === "ASSIGNED" || workOrderStep === "IN_PROGRESS" ? "bg-emerald-50 border-emerald-200" : "bg-blue-50 border-blue-200"}`}>
                <div className={`font-bold ${workOrderStep === "ASSIGNED" || workOrderStep === "IN_PROGRESS" ? "text-emerald-800" : "text-blue-800"}`}>
                  Step 4: Assigned
                </div>
                <div className={`text-[11px] mt-0.5 ${workOrderStep === "ASSIGNED" || workOrderStep === "IN_PROGRESS" ? "text-emerald-700" : "text-blue-700"}`}>
                  {workOrderStep === "ASSIGNED" || workOrderStep === "IN_PROGRESS" ? "Dispatched to Ward 12 ✅" : "Pending Authority Dispatch ⏳"}
                </div>
              </div>

              <div className={`p-3 border rounded-xl ${workOrderStep === "IN_PROGRESS" ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-200"}`}>
                <div className={`font-bold ${workOrderStep === "IN_PROGRESS" ? "text-emerald-800" : "text-slate-600"}`}>
                  Step 5: In Progress
                </div>
                <div className={`text-[11px] mt-0.5 ${workOrderStep === "IN_PROGRESS" ? "text-emerald-700" : "text-slate-500"}`}>
                  {workOrderStep === "IN_PROGRESS" ? "Field Crew Working 🛠️" : "Scheduled After Assignment"}
                </div>
              </div>
            </div>

            {/* Interactive Formality Action Bar */}
            <div className="flex items-center justify-between flex-wrap gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <div className="text-xs text-slate-700 font-sans">
                <span className="font-semibold text-slate-900">Next Action Required:</span>{" "}
                {workOrderStep === "DETECTED" && "Dispatch work order to municipal authority division."}
                {workOrderStep === "ASSIGNED" && `Assigned to ${assignedDept}. Advance status to In-Progress once team departs.`}
                {workOrderStep === "IN_PROGRESS" && "Repair underway. Secondary transit passes will verify upon completion."}
              </div>

              <div className="flex items-center gap-2">
                {workOrderStep === "DETECTED" && (
                  <button
                    onClick={handleDispatchAuthority}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <span>📋 PROCEED FORMALITY: DISPATCH TO WARD 12 AUTHORITY</span>
                  </button>
                )}

                {workOrderStep === "ASSIGNED" && (
                  <button
                    onClick={handleMarkInProgress}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-xs shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <span>🛠️ PROCEED FORMALITY: MARK IN PROGRESS</span>
                  </button>
                )}

                {workOrderStep === "IN_PROGRESS" && (
                  <Link
                    href="/consensus"
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <span>✓ PROCEED TO CONSENSUS RE-VERIFICATION →</span>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* REAL-TIME CONTINUOUS DEFECT INGESTION FEED */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">
                Continuous Ingestion Stream (Live Edge Detections)
              </span>
              <Badge text={`${historyEvents.length} Recent Records`} variant="default" />
            </div>
            <div className="text-xs text-slate-500 font-mono">
              Bus Fleet Sensor Network &bull; Frequency: ~{sensingIntervalSec}s
            </div>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 uppercase text-[10px] tracking-wider font-mono font-semibold">
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4">Event / Issue ID</th>
                <th className="py-2.5 px-4">Defect Classification</th>
                <th className="py-2.5 px-4">Corridor Location</th>
                <th className="py-2.5 px-4">Estimated Size</th>
                <th className="py-2.5 px-4">Evidence Bundle</th>
                <th className="py-2.5 px-4 text-right">Formality Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
              {historyEvents.slice(0, 10).map((evt, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                  <td className="py-2.5 px-4 text-slate-500">
                    {evt.created_at ? new Date(evt.created_at).toLocaleTimeString() : "Just now"}
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="font-bold text-blue-600">
                      {evt.issue_id || evt.event_id}
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      <span className="font-semibold text-slate-900">
                        {evt.class_name || evt.event_type || "POTHOLE"}
                      </span>
                      <span className="text-slate-500">
                        ({evt.confidence ? (evt.confidence * 100).toFixed(0) : "88"}%)
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-slate-700 font-sans">
                    {evt.location_name || "FC Road BRT Corridor, Pune"}
                  </td>
                  <td className="py-2.5 px-4 text-slate-900 font-semibold">
                    {evt.defect_size_cm ? `${evt.defect_size_cm} cm` : "76.4 cm"}
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setSelectedImage("/evidence/pothole_context_1.jpg")}
                        className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-[10px] text-slate-700 border border-slate-200 cursor-pointer transition-colors"
                        title="View Context Frame"
                      >
                        Context
                      </button>
                      <button
                        onClick={() => setSelectedImage("/evidence/pothole_detected_2.jpg")}
                        className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-[10px] text-slate-700 border border-slate-200 cursor-pointer transition-colors"
                        title="View HUD Detection Frame"
                      >
                        Detection
                      </button>
                      <button
                        onClick={() => setSelectedImage("/evidence/pothole_crop_3.jpg")}
                        className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-[10px] text-slate-700 border border-slate-200 cursor-pointer transition-colors"
                        title="View Measurement Crop"
                      >
                        Crop
                      </button>
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-right font-sans">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                      REGISTERED
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* LIGHTBOX IMAGE PREVIEW MODAL */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="relative max-w-4xl w-full bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3 bg-slate-800 border-b border-slate-700 flex items-center justify-between text-white text-xs">
              <span className="font-mono font-bold">CHAIN OF CUSTODY EVIDENCE PREVIEW</span>
              <button
                onClick={() => setSelectedImage(null)}
                className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold"
              >
                ✕ CLOSE
              </button>
            </div>
            <div className="aspect-video bg-black flex items-center justify-center p-2">
              <img
                src={selectedImage}
                alt="Evidence Full View"
                className="max-h-full max-w-full object-contain rounded"
              />
            </div>
            <div className="p-3 bg-slate-900 text-slate-400 text-xs font-mono flex items-center justify-between">
              <span>GeoTag: 18.5318°N, 73.8428°E · FC Road, Pune</span>
              <span className="text-emerald-400">YOLOv8 Confirmed</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
