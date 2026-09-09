"""UrbanSense AI — real edge inference pipeline (no simulations).

Frame flow:

    Video Frame
      -> YOLO inference (vehicle COCO + road-damage model)
      -> ByteTrack multi-object tracking (persistent IDs)
      -> Event validation (temporal confirmation, dedup by track/class)
      -> GPS attachment (phone / NMEA / simulated fallback)
      -> Evidence capture (annotated JPEG w/ GPS+metadata)
      -> Upload queue (persistent, crash-safe)
      -> Backend ingestion

There is no mock/demo detection, no periodic incident generator, and no fake
congestion. Every emitted event derives from the real models below.
"""

from __future__ import annotations

import asyncio
import signal
import time
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2
import httpx

from edge.camera.base import VideoSource
from edge.camera.factory import CameraFactory, CameraSpec
from edge.config.settings import settings, CameraPosition
from edge.detection.classes import (
    VEHICLE_CLASSES,
    PEDESTRIAN_CLASS,
    NEGATIVE_EXCLUSION_CLASSES,
)
from edge.inference.yoloframe import FrameInferenceEngine
from edge.inference.result import InferenceResult
from edge.tracking.bytetrack_engine import ByteTrackEngine
from edge.gps import build_gps_provider, RouteHistory
from edge.gps.base import GPSData
from edge.events.engine import Event, EventEngine
from edge.events.upload_queue import EventUploadQueue
from edge.edge_state import edge_state
from edge.streaming.server import MjpegStreamServer
from edge.evidence.capture import EvidenceCapture
from edge.ocr.provider import build_ocr_provider
from edge.segmentation import RoadSegmenter
from edge.validation import AreaValidator, TemporalValidator, ConfidenceFusionEngine, FusionFactors
from edge.utils.logger import log

# Road-damage classes are all treated as infrastructure issues routed by the
# backend. Incident classes are emergencies promoted to command-center alerts.
INCIDENT_TYPES = {"RASH_DRIVING", "HIT_AND_RUN", "COLLISION", "PEDESTRIAN_RISK"}


class EdgePipeline:
    def __init__(self) -> None:
        self._running = False
        self._frame_count = 0
        self._total_frames = 0
        self._fps_time = time.time()
        self._fps = 0.0
        self._frame_latency_ms = 0.0
        self._inference_latency_ms = 0.0
        self._tracking_latency_ms = 0.0
        self._unique_vehicles: dict[int, str] = {}
        self._session_id: str | None = None
        self._session_event_count = 0
        self._session_upload_count = 0
        self._session_error_count = 0

        # ---- Video sources (CameraFactory; multi-camera capable) ----
        self._cameras: dict[str, tuple[VideoSource, str]] = self._build_cameras()
        if not self._cameras:
            raise RuntimeError("No cameras configured — the front camera is mandatory.")
        front_pos = self._front_camera_position
        source, source_label = self._cameras[front_pos]
        self.source: VideoSource = source
        self._source_label = source_label
        self._camera_position = front_pos

        # ---- Real inference (vehicle + road damage) ----
        self.inference = FrameInferenceEngine(
            vehicle_model_path=str(settings.resolve_path(settings.yolo_model_path)),
            road_damage_model_path=str(settings.resolve_path(settings.road_damage_model_path)),
            vehicle_confidence=settings.confidence_threshold,
            road_damage_confidence=settings.road_defect_confidence_threshold,
            state_tracker=edge_state,
        )

        # ---- Multi-object tracking ----
        self.tracker = ByteTrackEngine()

        # ---- GPS (phone/NMEA primary, simulated explicit fallback) ----
        self._gps_primary = self._build_real_gps()
        self._gps_fallback = self._build_simulated_fallback()
        self._gps = self._gps_primary

        # ---- Event engines (per camera position, so multi-cam is isolated) ----
        self._event_engines: dict[str, EventEngine] = {
            self._front_camera_position: EventEngine(
                bus_id=settings.bus_id,
                camera_id=self._front_camera_position,
                min_confidence=settings.event_min_confidence,
                temporal_window=settings.event_temporal_window,
                min_observations=settings.event_min_observations,
                cluster_distance_meters=settings.cluster_distance_meters,
            )
        }

        self.evidence_capture = EvidenceCapture(
            settings.evidence_dir,
            max_width=settings.evidence_max_width,
            thumbnail_width=settings.evidence_thumbnail_width,
            archive_dir=settings.evidence_archive_dir if settings.evidence_archive_enabled else None,
        )
        self._last_archive_run = 0.0
        self._route_history = RouteHistory(max_points=settings.gps_route_history_max)

        # ---- Real OCR (optional) ----
        self.ocr = None
        if settings.ocr_enabled:
            self.ocr = build_ocr_provider(settings.ocr_provider.value)
            if self.ocr is None:
                log.warning("[OCR] OCR enabled but provider '%s' is unsupported/disabled — plate reading off",
                            settings.ocr_provider.value)

        self.upload_queue = EventUploadQueue(
            max_retries=settings.event_upload_max_retries,
        )

        # ---- Precision Validation Engines (False-Positive Elimination) ----
        self.road_segmenter = RoadSegmenter(
            min_overlap_ratio=0.80,
            enable_seg_model=False,
        )
        self.area_validator = AreaValidator()
        self.temporal_validator = TemporalValidator(
            min_consecutive_frames=5,
            min_track_age_frames=15,
            window_seconds=3.0,
        )
        self.confidence_fusion = ConfidenceFusionEngine()

        self._vehicle_counts: dict[str, int] = {}
        self._http_client: httpx.AsyncClient | None = None
        self._auth_headers = {"X-API-Key": settings.backend_api_key}
        self._last_pedestrian_risk = 0.0
        self._last_rash_driving = 0.0
        self._track_motion: dict[int, dict] = {}
        self._mjpeg_server = MjpegStreamServer(settings.edge_host, settings.edge_port)

    # -------------------------- Cameras --------------------------
    @property
    def _front_camera_position(self) -> str:
        return CameraPosition.FRONT.value

    def _default_front_source_type(self) -> str:
        return settings.video_source.value

    def _default_front_url(self) -> str:
        if settings.rtsp_front_url:
            return settings.rtsp_front_url
        if settings.video_source.value in ("phone", "rtsp"):
            return settings.phone_stream_url
        if settings.video_source.value == "youtube":
            return settings.youtube_live_url or settings.video_file_path
        return settings.video_file_path

    def _build_cameras(self) -> dict[str, tuple[VideoSource, str]]:
        """Construct up to 5 position-bound cameras (front mandatory).

        Returns a mapping position -> (source, source_type_label). When
        multi-camera mode is off, a single front camera is built from
        ``video_source``. Otherwise each enabled position (rear/left/right/
        cabin) gets its own dedicated source via the CameraFactory.
        """
        cameras: dict[str, tuple[VideoSource, str]] = {}

        def build(position: str, stype: str, url: str, mandatory: bool) -> None:
            if stype in ("", "off", "none", "disabled"):
                return
            source = CameraFactory.create(
                CameraSpec(
                    position=position,
                    source_type=stype,
                    url=url,
                    width=settings.frame_width,
                    height=settings.frame_height,
                    mandatory=mandatory,
                )
            )
            if source is not None:
                cameras[position] = (source, stype)

        # Front is always present (mandatory).
        front_type = settings.cam_front_source or self._default_front_source_type()
        front_url = settings.cam_front_url or self._default_front_url()
        build(CameraPosition.FRONT.value, front_type, front_url, mandatory=True)

        if settings.multi_camera_enabled:
            build(CameraPosition.REAR.value, settings.cam_rear_source, settings.cam_rear_url, False)
            build(CameraPosition.LEFT.value, settings.cam_left_source, settings.cam_left_url, False)
            build(CameraPosition.RIGHT.value, settings.cam_right_source, settings.cam_right_url, False)
            build(CameraPosition.CABIN.value, settings.cam_cabin_source, settings.cam_cabin_url, False)

        return cameras

    def _iter_cameras(self):
        """Yield (position, source, source_type) for each configured camera."""
        for pos, (src, stype) in self._cameras.items():
            yield pos, src, stype

    def _open_all_cameras(self) -> None:
        for pos, (src, stype) in self._cameras.items():
            try:
                src.open()
                edge_state.component(f"CAMERA-{pos}").mark_online(
                    f"source={stype}", 
                )
            except Exception as e:  # noqa: BLE001
                edge_state.component(f"CAMERA-{pos}").mark_failure(str(e))
                log.error("[CAMERA] %s failed to open: %s", pos, e)

    def _release_all_cameras(self) -> None:
        for pos, (src, _stype) in self._cameras.items():
            try:
                src.release()
            except Exception:  # noqa: BLE001
                pass

    # ----------------------------- GPS -----------------------------
    def _build_real_gps(self):
        if settings.gps_mode.value == "phone":
            return build_gps_provider(
                "phone",
                phone_gps_url=settings.phone_gps_url,
                gps_update_interval=settings.gps_update_interval,
            )
        if settings.gps_mode.value == "nmea":
            return build_gps_provider(
                "nmea",
                nmea_device=settings.gps_nmea_device,
                nmea_baudrate=settings.gps_nmea_baudrate,
                nmea_host=settings.gps_nmea_host or None,
                nmea_port=settings.gps_nmea_port or None,
                gps_update_interval=settings.gps_update_interval,
            )
        # Explicit simulated mode.
        return build_gps_provider(
            "simulated",
            simulated_route=settings.gps_simulated_route,
            gps_update_interval=settings.gps_update_interval,
        )

    def _build_simulated_fallback(self):
        return build_gps_provider(
            "simulated",
            simulated_route=settings.gps_simulated_route,
            gps_update_interval=settings.gps_update_interval,
        )

    def _init_gps(self) -> None:
        self._gps_primary.initialize()
        if self._gps_primary.is_available:
            self._gps = self._gps_primary
            edge_state.component("GPS").mark_online(f"mode={settings.gps_mode.value}")
            log.info("[GPS] Primary %s online", settings.gps_mode.value)
            return
        if settings.gps_allow_simulated_fallback:
            self._gps_fallback.initialize()
            if self._gps_fallback.is_available:
                self._gps = self._gps_fallback
                edge_state.component("GPS").mark_degraded(
                    f"primary {settings.gps_mode.value} failed -> SIMULATED fallback"
                )
                log.warning("[GPS] Primary GPS unavailable; using SIMULATED fallback")
                return
        edge_state.component("GPS").mark_failure(
            f"primary {settings.gps_mode.value} unavailable, no fallback"
        )
        log.error("[GPS] No GPS available")

    def _current_gps(self) -> GPSData | None:
        gps = self._gps.get_location()
        # If the primary recovers, switch back.
        if self._gps is self._gps_fallback and self._gps_primary.is_available:
            self._gps = self._gps_primary
            edge_state.component("GPS").mark_online("recovered to primary")
        if gps is not None:
            self._route_history.record(gps)
            if gps.fixed and gps.source in ("NMEA",):
                edge_state.component("GPS").mark_online(
                    f"mode={settings.gps_mode.value} utm={gps.signal_quality} "
                    f"sats={gps.satellites}"
                )
        return gps

    # --------------------------- lifecycle ---------------------------
    async def start(self) -> None:
        log.info("[EDGE] Starting UrbanSense Edge Pipeline (REAL inference)")
        log.info("[EDGE] Source: %s | Models: %s + %s | GPS: %s | Bus: %s",
                 settings.video_source.value, settings.yolo_model_path,
                 settings.road_damage_model_path, settings.gps_mode.value, settings.bus_id)

        import uuid as _uuid
        self._session_id = f"SESSION-{settings.bus_id}-{int(time.time())}-{_uuid.uuid4().hex[:6]}"
        edge_state.set_session(self._session_id)

        self._open_all_cameras()
        if not any(src.is_opened() for _pos, (src, _lbl) in self._cameras.items()):
            edge_state.component("CAMERA").mark_failure(
                f"no camera opened (source={settings.video_source.value})"
            )
            log.error("[CAMERA] No camera could be opened — stopping pipeline")
            self._running = False
            return
        edge_state.component("CAMERA").mark_online(
            f"active={len(self._cameras)} cameras"
        )

        self._init_gps()
        self._running = True
        self._http_client = httpx.AsyncClient(timeout=10)
        await self._start_sensing_session()

        try:
            self._mjpeg_server.start()
            edge_state.component("STREAM").mark_online(
                f"mjpeg://{settings.edge_host}:{settings.edge_port}/stream.mjpg"
            )
        except Exception as e:
            log.error("[STREAM] MJPEG server failed to start: %s", e)
            edge_state.component("STREAM").mark_failure(str(e))

        loop = asyncio.get_event_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, self.stop)
            except NotImplementedError:
                pass

        log.info("[EDGE] Pipeline ONLINE — processing frames (session %s)", self._session_id)
        await asyncio.gather(
            self._process_loop(),
            self._upload_loop(),
            self._heartbeat_loop(),
        )

    async def _start_sensing_session(self) -> None:
        if not self._session_id or not self._http_client:
            return
        try:
            resp = await self._http_client.post(
                f"{settings.backend_url}/api/sensing/sessions/start",
                json={
                    "session_id": self._session_id,
                    "bus_id": settings.bus_id,
                    "camera_id": settings.camera_position.value,
                    "gps_source": settings.gps_mode.value,
                    "ai_mode": "LIVE",
                    "model_name": settings.yolo_model_path,
                    "road_damage_model": settings.road_damage_model_path,
                },
                headers=self._auth_headers,
            )
            if resp.status_code in (200, 201, 409):
                edge_state.component("BACKEND").mark_online("sensing session registered")
        except Exception as e:
            log.warning("[SENSING] Session start failed: %s", e)

    # -------------------------- frame loop --------------------------
    def _event_engine_for(self, camera_pos: str) -> EventEngine:
        """Return (creating if needed) the event engine for a camera position."""
        engine = self._event_engines.get(camera_pos)
        if engine is None:
            engine = EventEngine(
                bus_id=settings.bus_id,
                camera_id=camera_pos,
                min_confidence=settings.event_min_confidence,
                temporal_window=settings.event_temporal_window,
                min_observations=settings.event_min_observations,
                cluster_distance_meters=settings.cluster_distance_meters,
            )
            self._event_engines[camera_pos] = engine
        return engine

    async def _process_loop(self) -> None:
        while self._running:
            t0 = time.time()
            try:
                # Multi-camera: process each configured camera in turn. In
                # single-camera mode this yields exactly one (front) source.
                for pos, src, _stype in self._iter_cameras():
                    self._process_frame(src, pos)
            except Exception as e:
                log.error("[EDGE] Frame processing error: %s", e)
                import traceback
                log.debug(traceback.format_exc())
            self._frame_latency_ms = (time.time() - t0) * 1000
            await asyncio.sleep(max(0, 1.0 / settings.inference_fps - (time.time() - t0)))

    def _process_frame(self, source: VideoSource, camera_pos: str) -> None:
        ret, frame = source.read()
        if not ret or frame is None:
            return
        self._frame_count += 1
        self._total_frames += 1
        now = time.time()
        if now - self._fps_time >= 1.0:
            self._fps = self._frame_count / (now - self._fps_time)
            self._frame_count = 0
            self._fps_time = now

        gps = self._current_gps()

        # ---- Real inference ----
        t_inf = time.time()
        try:
            vehicles, defects = self.inference.infer(frame)
            self._inference_latency_ms = (time.time() - t_inf) * 1000
            edge_state.component("AI").mark_online(f"inference={self._inference_latency_ms:.0f}ms")
        except Exception as e:
            log.error("[AI] Inference failed: %s", e)
            edge_state.component("AI").mark_failure(str(e))
            vehicles, defects = [], []

        # ---- Tracking (persistent IDs) ----
        t_trk = time.time()
        all_detections = list(vehicles) + list(defects)
        all_detections = self.tracker.process(all_detections, frame)
        self._tracking_latency_ms = (time.time() - t_trk) * 1000

        vehicle_detections = [d for d in all_detections if d.class_name in VEHICLE_CLASSES]
        person_detections = [d for d in all_detections if d.class_name == PEDESTRIAN_CLASS]
        defect_detections = [d for d in all_detections if d.class_name not in (VEHICLE_CLASSES | {PEDESTRIAN_CLASS})]

        self._vehicle_counts = {}
        for d in vehicle_detections:
            self._vehicle_counts[d.class_name] = self._vehicle_counts.get(d.class_name, 0) + 1
            if d.track_id is not None:
                self._unique_vehicles[d.track_id] = d.class_name

        annotated = self._annotate_frame(frame, vehicle_detections, person_detections, defect_detections, gps)

        # ---- Cascaded Precision Validation (Road Mask + Area + Temporal + Confidence Fusion) ----
        road_mask = self.road_segmenter.get_drivable_mask(frame)
        event_engine = self._event_engine_for(camera_pos)

        valid_defects: list[InferenceResult] = []
        defect_overlap_map: dict[int, float] = {}

        for det in defect_detections:
            # Stage 1: Road Segmentation Filter (reject outside drivable road)
            is_on_road, overlap = self.road_segmenter.is_on_drivable_road(det.bbox, road_mask)
            if not is_on_road:
                continue

            # Stage 2: Perspective-Aware Dynamic Area Bounds
            is_valid_area, _ = self.area_validator.validate(det.bbox, frame.shape[0], frame.shape[1])
            if not is_valid_area:
                continue

            # Stage 3: Negative Exclusion Check
            if det.class_name in NEGATIVE_EXCLUSION_CLASSES:
                continue

            valid_defects.append(det)
            if det.track_id is not None:
                defect_overlap_map[det.track_id] = overlap

        # Stage 4: Temporal Persistence Validation (5 consecutive frames, track_age >= 15)
        confirmed_candidates = self.temporal_validator.update_frame(
            valid_defects, defect_overlap_map, timestamp=now
        )

        # Stage 5: Multi-Modal Confidence Fusion (40% YOLO, 20% Track, 15% Temp, 10% Road, 5% GPS, 10% Hist)
        for cand in confirmed_candidates:
            matching_det = next((d for d in valid_defects if d.track_id == cand.track_id), None)
            if matching_det is None:
                continue

            factors = FusionFactors(
                yolo_confidence=cand.average_confidence,
                track_age_frames=cand.track_age_frames,
                consecutive_frames=cand.consecutive_frames,
                road_mask_overlap=cand.average_road_overlap,
                gps_speed_kmh=gps.speed if gps else None,
                gps_accuracy_m=getattr(gps, "accuracy", None) if gps else None,
                historical_observations=1,
            )
            action, fused_score = self.confidence_fusion.evaluate(factors)

            # Strict score gating: Reject if score < 60
            if action == "REJECT":
                log.debug("[FUSION] Dropped track %d (fused_score=%.1f < 60)", cand.track_id, fused_score)
                continue

            event = event_engine.process_detection(
                matching_det, gps,
                frame_width=frame.shape[1],
                frame_height=frame.shape[0],
            )
            if event:
                event.metadata["track_id"] = cand.track_id
                event.metadata["track_age_frames"] = cand.track_age_frames
                event.metadata["consecutive_frames"] = cand.consecutive_frames
                event.metadata["fused_score"] = fused_score
                event.metadata["road_overlap_ratio"] = cand.average_road_overlap
                event.metadata["source_model"] = matching_det.source_model or "models/road_damage.pt"
                event.metadata["bbox"] = list(matching_det.bbox)
                self._queue_event(event, annotated, matching_det)

        # ---- Pedestrian proximity risk (real, rule-based) ----
        self._detect_pedestrian_risk(vehicle_detections, person_detections, gps, frame, annotated, camera_pos)

        # ---- Rash-driving (real, rule-based on tracked motion) ----
        if settings.rash_driving_enabled:
            self._detect_rash_driving(vehicle_detections, gps, frame, annotated, camera_pos)

        self._publish_frame(annotated)

    def _detect_pedestrian_risk(self, vehicles, persons, gps, frame, annotated, camera_pos) -> None:
        for det in persons:
            for veh in vehicles:
                if veh.track_id is None or det.track_id is None:
                    continue
                px = (det.bbox[0] + det.bbox[2]) / 2
                vx = (veh.bbox[0] + veh.bbox[2]) / 2
                py = (det.bbox[1] + det.bbox[3]) / 2
                vy = (veh.bbox[1] + veh.bbox[3]) / 2
                dist = ((px - vx) ** 2 + (py - vy) ** 2) ** 0.5
                if dist < 100:
                    if time.time() - self._last_pedestrian_risk < settings.event_temporal_window:
                        return
                    self._last_pedestrian_risk = time.time()
                    ev = self._build_incident(
                        "PEDESTRIAN_RISK", "HIGH", 0.78, gps, frame,
                        {
                            "pedestrian_track": det.track_id,
                            "vehicle_track": veh.track_id,
                            "proximity_px": round(dist, 1),
                        },
                        plate_bbox=veh.bbox,
                        camera_pos=camera_pos,
                    )
                    if ev:
                        self._queue_event(ev, annotated, veh)
                    return

    def _detect_rash_driving(self, detections, gps, frame, annotated, camera_pos) -> None:
        if not detections:
            self._track_motion.clear()
            return
        now = time.time()
        frame_w = frame.shape[1]
        threshold_px = 0.15 * frame_w
        cooldown_ok = now - self._last_rash_driving > settings.event_temporal_window * 5

        for det in detections:
            if det.track_id is None:
                continue
            tid = det.track_id
            cx = (det.bbox[0] + det.bbox[2]) / 2
            cy = (det.bbox[1] + det.bbox[3]) / 2
            prev = self._track_motion.get(tid)
            if prev is None:
                self._track_motion[tid] = {"t": now, "cx": cx, "cy": cy, "speed": 0.0}
                continue
            dt = now - prev["t"]
            if dt <= 0:
                continue
            dist = ((cx - prev["cx"]) ** 2 + (cy - prev["cy"]) ** 2) ** 0.5
            speed = dist / dt if dt > 0 else 0.0
            prev_speed = prev["speed"]
            prev["t"] = now
            prev["cx"], prev["cy"] = cx, cy
            prev["speed"] = 0.4 * prev_speed + 0.6 * speed

            if prev_speed > 0 and speed > prev_speed * 2.5 and speed > threshold_px and cooldown_ok:
                self._last_rash_driving = now
                severity = "CRITICAL" if speed > threshold_px * 2.5 else "HIGH"
                ev = self._build_incident(
                    "RASH_DRIVING", severity, 0.82, gps, frame,
                    {
                        "vehicle_class": det.class_name,
                        "track_id": tid,
                        "speed_px_s": round(speed, 1),
                        "prev_speed_px_s": round(prev_speed, 1),
                    },
                    plate_bbox=det.bbox,
                    camera_pos=camera_pos,
                )
                if ev:
                    self._queue_event(ev, annotated, det)
                    log.info("[INCIDENT] RASH_DRIVING track=%d speed=%.0fpx/s -> plate+GPS alert",
                             tid, speed)
                return

    def _read_plate(self, frame, bbox) -> tuple[str | None, float | None]:
        if self.ocr is None or bbox is None:
            return None, None
        try:
            result = self.ocr.detect_plate(frame, tuple(bbox))
            if result:
                log.info("[OCR] Plate candidate: %s (%.1f%%)", result.plate_text, (result.confidence or 0) * 100)
                return result.plate_text, result.confidence
        except Exception as e:
            log.debug("[OCR] Plate read failed: %s", e)
        return None, None

    def _build_incident(self, event_type: str, severity: str, confidence: float,
                        gps, frame, metadata: dict, plate_bbox=None,
                        camera_pos: str | None = None) -> Event | None:
        event_id = self._next_event_id()
        plate_text, plate_conf = self._read_plate(frame, plate_bbox)
        pos = camera_pos or self._front_camera_position
        return Event(
            event_id=event_id,
            event_type=event_type,
            bus_id=settings.bus_id,
            camera_id=pos,
            severity=severity,
            confidence=confidence,
            latitude=gps.latitude if gps else 0.0,
            longitude=gps.longitude if gps else 0.0,
            source="EDGE_AI",
            metadata={
                "gps_source": gps.source if gps else "UNKNOWN",
                "plate_text": plate_text,
                "plate_confidence": plate_conf,
                "ai_mode": "LIVE",
                "model_name": settings.yolo_model_path,
                "inference_time_ms": round(self._inference_latency_ms, 1),
                **metadata,
            },
        )

    def _next_event_id(self, prefix: str = "EVT") -> str:
        return f"{prefix}-{settings.bus_id}-{int(time.time())}"

    def _annotate_frame(self, frame, vehicle_detections, person_detections, defects, gps):
        annotated = frame.copy()
        colors = {
            "car": (0, 255, 0), "motorcycle": (255, 255, 0), "bus": (0, 200, 255),
            "truck": (255, 100, 0), "bicycle": (200, 0, 255),
        }
        for det in vehicle_detections:
            x1, y1, x2, y2 = det.bbox
            color = colors.get(det.class_name, (255, 255, 255))
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
            label = f"{det.class_name} {det.confidence:.0%}"
            if det.track_id:
                label += f" #{det.track_id}"
            cv2.putText(annotated, label, (x1, y1 - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
        for det in person_detections:
            x1, y1, x2, y2 = det.bbox
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 255), 2)
            label = f"pedestrian {det.confidence:.0%}"
            if det.track_id:
                label += f" #{det.track_id}"
            cv2.putText(annotated, label, (x1, y1 - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
        for det in defects:
            x1, y1, x2, y2 = det.bbox
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 255), 3)
            label = f"{det.class_name} {det.confidence:.0%}"
            if det.track_id:
                label += f" #{det.track_id}"
            cv2.putText(annotated, label, (x1, y1 - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

        y = 20
        for cls, count in self._vehicle_counts.items():
            cv2.putText(annotated, f"{cls}: {count}", (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            y += 20
        unique = len(self._unique_vehicles)
        cumulative = self.tracker.cumulative_counts
        cv2.putText(annotated, f"Vehicles now: {sum(self._vehicle_counts.values())} | Unique seen: {unique}",
                    (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
        y += 20
        cv2.putText(annotated,
                    f"Pedestrians seen: {cumulative.get('person', 0)} | Veh seen: {sum(v for k, v in cumulative.items() if k != 'person')}",
                    (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        y += 20
        cv2.putText(annotated,
                    f"FPS: {self._fps:.1f} | Inf: {self._inference_latency_ms:.0f}ms | Frame: {self._frame_latency_ms:.0f}ms",
                    (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
        y += 20
        cv2.putText(annotated, "SOURCE: LIVE EDGE AI", (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 200, 255), 1)
        y += 20
        if gps:
            cv2.putText(annotated, f"GPS: {gps.latitude:.4f}, {gps.longitude:.4f} [{gps.source}]",
                        (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1)
        return annotated

    def _publish_frame(self, annotated):
        if not self._mjpeg_server.running:
            return
        try:
            resized = cv2.resize(annotated, (settings.stream_width, settings.stream_height))
            ok, buf = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, settings.stream_quality])
            if ok:
                self._mjpeg_server.publish(buf.tobytes(), self._total_frames)
                edge_state.component("STREAM").mark_online(f"frames={self._total_frames}")
        except Exception as e:
            log.debug("[STREAM] Frame publish failed: %s", e)

    def _queue_event(self, event: Event, frame, detection: InferenceResult | None) -> None:
        bbox = detection.bbox if detection is not None else event.metadata.get("bbox")
        model_name = detection.source_model if (detection and detection.source_model) else settings.yolo_model_path
        track_id = event.metadata.get("track_id") or (detection.track_id if detection else None)
        evidence_path = self.evidence_capture.capture(
            frame=frame,
            event_id=event.event_id,
            event_type=event.event_type,
            confidence=event.confidence,
            gps_source=event.metadata.get("gps_source", "UNKNOWN"),
            bus_id=event.bus_id,
            camera_id=event.camera_id,
            latitude=event.latitude,
            longitude=event.longitude,
            model_name=model_name,
            track_id=track_id,
            bbox=tuple(bbox) if bbox else None,
        )
        event.evidence_url = evidence_path
        event_dict = event.to_dict()
        event_dict["ai_mode"] = "LIVE"
        if bbox:
            event_dict["bbox"] = list(bbox)
        if model_name:
            event_dict["source_model"] = model_name
        if track_id is not None:
            event_dict["track_id"] = track_id
        if "track_age_frames" in event.metadata:
            event_dict["track_age_frames"] = event.metadata["track_age_frames"]
        if "consecutive_frames" in event.metadata:
            event_dict["consecutive_frames"] = event.metadata["consecutive_frames"]
        if "fused_score" in event.metadata:
            event_dict["fused_score"] = event.metadata["fused_score"]
        if "road_overlap_ratio" in event.metadata:
            event_dict["road_overlap_ratio"] = event.metadata["road_overlap_ratio"]

        self.upload_queue.enqueue(event_dict)
        edge_state.component("QUEUE").mark_online(f"pending={self.upload_queue.pending_count}")
        self._session_event_count += 1
        log.info("[EVENT] %s → %s (severity=%s, conf=%.2f) [GPS %.4f,%.4f]",
                 event.event_id, event.event_type, event.severity, event.confidence,
                 event.latitude, event.longitude)

    # -------------------------- upload loop --------------------------
    async def _upload_loop(self) -> None:
        assert self._http_client is not None
        while self._running:
            batch = self.upload_queue.dequeue_batch(settings.event_upload_batch_size)
            if batch:
                succeeded = []
                for event_data in batch:
                    event_id = event_data.get("event_id", "unknown")
                    try:
                        resp = await self._http_client.post(
                            f"{settings.backend_url}/api/events",
                            json=event_data,
                            headers=self._auth_headers,
                        )
                        if resp.status_code in (200, 201):
                            succeeded.append(event_id)
                            self._session_upload_count += 1
                        elif 400 <= resp.status_code < 500:
                            log.warning("[UPLOAD] REJECTED %d (won't retry): %s", resp.status_code, event_id)
                            self.upload_queue.dead_letter(event_id)
                            self._session_error_count += 1
                        else:
                            log.warning("[UPLOAD] FAILED %d: %s", resp.status_code, event_id)
                            self.upload_queue.mark_failed(event_id)
                    except Exception as e:
                        log.warning("[UPLOAD] ERROR %s: %s", event_id, e)
                        self.upload_queue.mark_failed(event_id)
                        self._session_error_count += 1
                if succeeded:
                    self.upload_queue.mark_success(succeeded)
                if self.upload_queue.pending_count > 0:
                    edge_state.component("BACKEND").mark_degraded(
                        f"pending={self.upload_queue.pending_count} dead={self.upload_queue.dead_letter_count}")
                else:
                    edge_state.component("BACKEND").mark_online("queue drained")
            await asyncio.sleep(1)

    async def _heartbeat_loop(self) -> None:
        assert self._http_client is not None
        while self._running:
            try:
                session_id = edge_state.session_id
                if session_id:
                    # Periodic evidence retention (once per hour max).
                    if settings.evidence_archive_enabled and (
                        time.time() - self._last_archive_run > 3600
                    ):
                        self._last_archive_run = time.time()
                        try:
                            self.evidence_capture.archive_old(
                                settings.evidence_retention_days
                            )
                        except Exception:  # noqa: BLE001
                            log.debug("[EVIDENCE] archive run failed")
                    cumulative = self.tracker.cumulative_counts
                    payload = {
                        "frame_count": self._total_frames,
                        "event_count": self._session_event_count,
                        "upload_count": self._session_upload_count,
                        "error_count": self._session_error_count,
                        "metadata": {
                            "vehicle_counts": dict(self._vehicle_counts),
                            "cumulative_track_counts": cumulative,
                            "vehicle_count": cumulative.get("car", 0)
                            + cumulative.get("truck", 0)
                            + cumulative.get("bus", 0)
                            + cumulative.get("motorcycle", 0)
                            + cumulative.get("bicycle", 0),
                            "pedestrian_count": cumulative.get("person", 0),
                            "route_history": self._route_history.recent(limit=50),
                            "gps_fix": (
                                self._gps.get_location().to_dict()
                                if self._gps.get_location()
                                else {}
                            ),
                        },
                    }
                    resp = await self._http_client.post(
                        f"{settings.backend_url}/api/sensing/sessions/{session_id}/update",
                        json=payload,
                        headers=self._auth_headers,
                    )
                    if resp.status_code in (200, 201):
                        edge_state.component("BACKEND").mark_online("heartbeat ok")
            except Exception as e:
                log.debug("[HB] Heartbeat failed: %s", e)
            await asyncio.sleep(3)

    # --------------------------- shutdown ----------------------------
    def stop(self) -> None:
        if not self._running:
            return
        self._running = False
        self._release_all_cameras()
        self.source.release()
        self._gps_primary.shutdown()
        if self._gps is not self._gps_primary:
            self._gps_fallback.shutdown()
        if self._http_client:
            import asyncio
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self._shutdown_http())
            except RuntimeError:
                pass
        log.info("[EDGE] Pipeline stopped (queue pending: %d)", self.upload_queue.pending_count)

    async def _shutdown_http(self) -> None:
        await self._close_session()
        if self._http_client:
            await self._http_client.aclose()

    async def _close_session(self) -> None:
        session_id = edge_state.session_id
        if not session_id or not self._http_client:
            return
        try:
            # Drain any remaining queued events before closing the session.
            for _ in range(60):
                batch = self.upload_queue.dequeue_batch(settings.event_upload_batch_size)
                if not batch:
                    break
                for event_data in batch:
                    try:
                        resp = await self._http_client.post(
                            f"{settings.backend_url}/api/events", json=event_data,
                            headers=self._auth_headers,
                        )
                        if resp.status_code in (200, 201):
                            self.upload_queue.mark_success([event_data["event_id"]])
                        elif not (400 <= resp.status_code < 500):
                            self.upload_queue.mark_failed(event_data["event_id"])
                    except Exception:
                        self.upload_queue.mark_failed(event_data["event_id"])
                await asyncio.sleep(0.2)
            await self._http_client.post(
                f"{settings.backend_url}/api/sensing/sessions/{session_id}/close",
                headers=self._auth_headers,
            )
        except Exception as e:
            log.warning("[SHUTDOWN] drain/close failed: %s", e)


if __name__ == "__main__":
    pipeline = EdgePipeline()
    try:
        asyncio.run(pipeline.start())
    except (KeyboardInterrupt, SystemExit):
        pipeline.stop()
