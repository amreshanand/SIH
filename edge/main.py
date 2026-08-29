from __future__ import annotations

import asyncio
import signal
import time
from pathlib import Path

import cv2
import httpx
import numpy as np

from edge.camera.base import VideoSource
from edge.camera.phone_stream import PhoneStreamSource
from edge.camera.webcam import WebcamSource
from edge.camera.file_video import FileVideoSource
from edge.camera.youtube import YouTubeSource
from edge.config.settings import settings
from edge.detection.vehicle_detector import Detection, MockDetector, YOLODetector, VEHICLE_CLASSES, ALL_DETECTABLE_CLASSES
from edge.detection.road_defect import MockRoadDefectDetector, RealRoadDefectDetector
from edge.tracking.vehicle_tracker import MockTracker, ByteTrackTracker
from edge.gps.base import GPSData
from edge.gps.phone_gps import PhoneGPSProvider
from edge.gps.simulated import SimulatedGPSProvider
from edge.events.engine import Event, EventEngine
from edge.events.upload_queue import EventUploadQueue
from edge.edge_state import edge_state
from edge.evidence.capture import EvidenceCapture
from edge.ocr.provider import MockOCRProvider, PaddleOCRProvider
from edge.utils.logger import log


class EdgePipeline:
    def __init__(self) -> None:
        self._running = False
        self._frame_count = 0
        self._total_frames = 0
        self._fps_time = time.time()
        self._fps = 0.0
        self._frame_latency_ms = 0.0
        self._detection_latency_ms = 0.0
        self._unique_vehicles: dict[int, str] = {}
        self._event_counter = 0
        self._session_id: str | None = None
        self._session_event_count = 0
        self._session_upload_count = 0
        self._session_error_count = 0

        source_map = {
            "phone": lambda: PhoneStreamSource(settings.phone_stream_url, settings.frame_width, settings.frame_height),
            "webcam": lambda: WebcamSource(0, settings.frame_width, settings.frame_height),
            "file": lambda: FileVideoSource(settings.video_file_path, settings.frame_width, settings.frame_height),
            "mock": lambda: FileVideoSource(settings.video_file_path, settings.frame_width, settings.frame_height),
            "youtube": lambda: YouTubeSource(settings.youtube_live_url, settings.frame_width, settings.frame_height),
        }
        self.source: VideoSource = source_map.get(settings.video_source.value, source_map["file"])()

        if settings.model_mode.value == "real":
            self.detector = YOLODetector(settings.yolo_model_path, settings.confidence_threshold)
        else:
            self.detector = MockDetector(settings.confidence_threshold)

        if settings.model_mode.value == "real":
            p = Path(settings.road_damage_model_path)
            self.road_defect_detector = RealRoadDefectDetector(str(p), settings.road_defect_confidence_threshold) if p.exists() else MockRoadDefectDetector(settings.road_defect_confidence_threshold)
        else:
            self.road_defect_detector = MockRoadDefectDetector(settings.road_defect_confidence_threshold)

        if settings.model_mode.value == "real":
            self.tracker = ByteTrackTracker()
        else:
            self.tracker = MockTracker()

        if settings.gps_mode.value == "phone":
            self.gps = PhoneGPSProvider(settings.phone_gps_url, settings.gps_update_interval)
        else:
            self.gps = SimulatedGPSProvider(settings.gps_simulated_route, settings.gps_update_interval)

        self.event_engine = EventEngine(
            bus_id=settings.bus_id,
            camera_id=settings.camera_position.value,
            min_confidence=settings.event_min_confidence,
            temporal_window=settings.event_temporal_window,
            min_observations=settings.event_min_observations,
            cluster_distance_meters=settings.cluster_distance_meters,
        )

        self.evidence_capture = EvidenceCapture(settings.evidence_dir, settings.evidence_max_width)

        if settings.ocr_enabled and settings.ocr_provider.value == "paddle":
            self.ocr = PaddleOCRProvider()
        else:
            self.ocr = MockOCRProvider()

        self.upload_queue = EventUploadQueue(
            max_retries=settings.event_upload_max_retries,
        )

        self._vehicle_counts: dict[str, int] = {}
        self._http_client: httpx.AsyncClient | None = None
        self._auth_headers = {"X-API-Key": settings.backend_api_key}
        self._last_pedestrian_risk = 0.0
        self._last_rash_driving = 0.0
        # track_id -> {t, cx, cy, speed} for motion-anomaly (rash driving) detection.
        self._track_motion: dict[int, dict] = {}

    def _next_event_id(self, prefix: str = "EVT") -> str:
        self._event_counter += 1
        return f"{prefix}-{settings.bus_id}-{int(time.time())}-{self._event_counter:04d}"

    async def start(self) -> None:
        log.info("[EDGE] Starting UrbanSense Edge Pipeline")
        log.info("[EDGE] Source: %s | Model: %s | GPS: %s | Bus: %s",
                 settings.video_source.value, settings.model_mode.value,
                 settings.gps_mode.value, settings.bus_id)

        import uuid as _uuid
        self._session_id = f"SESSION-{settings.bus_id}-{int(time.time())}-{_uuid.uuid4().hex[:6]}"
        edge_state.set_session(self._session_id)

        try:
            self.source.open()
            if self.source.is_opened():
                edge_state.component("CAMERA").mark_online(f"source={settings.video_source.value}")
            else:
                edge_state.component("CAMERA").mark_degraded(
                    f"source={settings.video_source.value} not opened — retrying"
                )
        except Exception as e:
            log.error("[CAMERA] Failed to open source %s: %s", settings.video_source.value, e)
            edge_state.component("CAMERA").mark_failure(str(e))
            self._running = False
            return
        try:
            self.gps.initialize()
            edge_state.component("GPS").mark_online(f"mode={settings.gps_mode.value}")
        except Exception as e:
            log.error("[GPS] Initialization failed: %s", e)
            edge_state.component("GPS").mark_degraded(str(e))
        self._running = True
        self._http_client = httpx.AsyncClient(timeout=10)
        await self._start_sensing_session()

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
                    "ai_mode": settings.model_mode.value,
                    "model_name": settings.yolo_model_path if settings.model_mode.value == "real" else "mock",
                },
                headers=self._auth_headers,
            )
            if resp.status_code in (200, 201, 409):
                edge_state.component("BACKEND").mark_online("sensing session registered")
            else:
                log.warning("[SENSING] Session start rejected %d", resp.status_code)
        except Exception as e:
            log.warning("[SENSING] Session start failed: %s", e)

    async def _process_loop(self) -> None:
        while self._running:
            t0 = time.time()
            try:
                self._process_frame()
            except Exception as e:
                log.error("[EDGE] Frame processing error: %s", e)
                import traceback
                log.debug(traceback.format_exc())
            self._frame_latency_ms = (time.time() - t0) * 1000
            await asyncio.sleep(max(0, 1.0 / settings.inference_fps - (time.time() - t0)))

    def _process_frame(self) -> None:
        ret, frame = self.source.read()
        if not ret or frame is None:
            return

        self._frame_count += 1
        self._total_frames += 1
        now = time.time()
        if now - self._fps_time >= 1.0:
            self._fps = self._frame_count / (now - self._fps_time)
            self._frame_count = 0
            self._fps_time = now

        gps = self.gps.get_location()
        if gps:
            log.debug("[GPS] %.4f, %.4f [%s]", gps.latitude, gps.longitude, gps.source)

        det_start = time.time()
        try:
            detections = self.detector.detect(frame)
            self._detection_latency_ms = (time.time() - det_start) * 1000
            edge_state.component("AI").mark_online(f"detect={self._detection_latency_ms:.0f}ms")
        except Exception as e:
            log.error("[AI] Detection failed: %s", e)
            edge_state.component("AI").mark_failure(str(e))
            detections = []
        detections = self.tracker.update(detections, frame)

        vehicle_detections = [d for d in detections if d.class_name in VEHICLE_CLASSES]
        person_detections = [d for d in detections if d.class_name == "person"]

        if vehicle_detections:
            log.debug("[AI] %d vehicles detected (%.1fms)", len(vehicle_detections), self._detection_latency_ms)

        self._vehicle_counts = {}
        for d in vehicle_detections:
            self._vehicle_counts[d.class_name] = self._vehicle_counts.get(d.class_name, 0) + 1
            if d.track_id is not None:
                self._unique_vehicles[d.track_id] = d.class_name

        try:
            road_defects = self.road_defect_detector.detect(frame)
        except Exception as e:
            log.error("[AI] Road defect detection failed: %s", e)
            road_defects = []

        annotated = self._annotate_frame(frame, vehicle_detections, person_detections, road_defects, gps)

        for det in road_defects:
            log.info("[AI] %s confidence=%.3f", det.class_name.upper(), det.confidence)
            event = self.event_engine.process_detection(
                det, gps,
                frame_width=frame.shape[1],
                frame_height=frame.shape[0],
            )
            if event:
                self._queue_event(event, annotated, det)

        for det in person_detections:
            for veh in vehicle_detections:
                if veh.track_id and det.track_id:
                    px = (det.bbox[0] + det.bbox[2]) / 2
                    vx = (veh.bbox[0] + veh.bbox[2]) / 2
                    py = (det.bbox[1] + det.bbox[3]) / 2
                    vy = (veh.bbox[1] + veh.bbox[3]) / 2
                    dist = ((px - vx) ** 2 + (py - vy) ** 2) ** 0.5
                    if dist < 100:
                        # Cooldown: avoid flooding identical PEDESTRIAN_RISK
                        # incidents every frame while a person lingers near a car.
                        if time.time() - self._last_pedestrian_risk < settings.event_temporal_window:
                            break
                        self._last_pedestrian_risk = time.time()
                        ev = self._create_incident_event(
                            "PEDESTRIAN_RISK", "HIGH", 0.78, gps, frame,
                            {"pedestrian_track": det.track_id, "vehicle_track": veh.track_id, "proximity_px": round(dist, 1)},
                            plate_bbox=veh.bbox,
                        )
                        if ev:
                            self._queue_event(ev, annotated, None)
                        break

        vehicle_count = len(vehicle_detections)
        if vehicle_count >= settings.traffic_detection_threshold:
            traffic_event = self.event_engine.process_traffic(
                vehicle_count, self._vehicle_counts, gps or GPSData(0, 0),
                congestion_threshold=settings.traffic_congestion_threshold,
            )
            if traffic_event:
                self._queue_event(traffic_event, annotated, None)

        # Unsafe-driving detection: any tracked vehicle that shows a sudden
        # strong acceleration spike gets reported as RASH_DRIVING with the
        # plate attempt, timestamp and GPS attached (the incident-alert flow).
        self._detect_rash_driving(vehicle_detections, gps, frame, annotated)

    def _detect_rash_driving(
        self,
        detections: list[Detection],
        gps: GPSData | None,
        frame: np.ndarray,
        annotated: np.ndarray,
    ) -> None:
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
            speed = dist / dt
            prev_speed = prev["speed"]
            prev["t"] = now
            prev["cx"], prev["cy"] = cx, cy
            prev["speed"] = 0.4 * prev_speed + 0.6 * speed

            if prev_speed > 0 and speed > prev_speed * 2.5 and speed > threshold_px and cooldown_ok:
                self._last_rash_driving = now
                severity = "CRITICAL" if speed > threshold_px * 2.5 else "HIGH"
                ev = self._create_incident_event(
                    "RASH_DRIVING", severity, 0.82, gps, frame,
                    {
                        "vehicle_class": det.class_name,
                        "track_id": tid,
                        "speed_px_s": round(speed, 1),
                        "prev_speed_px_s": round(prev_speed, 1),
                    },
                    plate_bbox=det.bbox,
                )
                if ev:
                    self._queue_event(ev, annotated, det)
                    log.info("[INCIDENT] RASH_DRIVING track=%d speed=%.0fpx/s (prev %.0f) -> plate+GPS alert",
                             tid, speed, prev_speed)
                return

    def _create_incident_event(
        self, event_type: str, severity: str, confidence: float,
        gps: GPSData | None, frame: np.ndarray, metadata: dict,
        plate_bbox: tuple[int, int, int, int] | None = None,
    ) -> Event | None:
        event_id = self._next_event_id()

        plate_text = None
        plate_confidence = None
        if settings.ocr_enabled:
            # OCR the vehicle region (the detection that triggered the incident),
            # never an arbitrary hardcoded rectangle.
            crop = plate_bbox or metadata.get("vehicle_bbox")
            if crop:
                ocr_result = self.ocr.detect_plate(frame, tuple(crop))
                if ocr_result:
                    plate_text = ocr_result.plate_text
                    plate_confidence = ocr_result.confidence
                    log.info("[OCR] Plate candidate: %s (%.1f%%)", plate_text, (plate_confidence or 0) * 100)

        return Event(
            event_id=event_id,
            event_type=event_type,
            bus_id=settings.bus_id,
            camera_id=settings.camera_position.value,
            severity=severity,
            confidence=confidence,
            latitude=gps.latitude if gps else 0.0,
            longitude=gps.longitude if gps else 0.0,
            source="EDGE_AI" if settings.model_mode.value == "real" else "SIMULATED",
            metadata={
                "gps_source": gps.source if gps else "UNKNOWN",
                "plate_text": plate_text,
                "plate_confidence": plate_confidence,
                "ai_mode": settings.model_mode.value,
                "model_name": settings.yolo_model_path if settings.model_mode.value == "real" else "mock",
                "inference_time_ms": round(self._detection_latency_ms, 1),
                **metadata,
            },
        )

    def _annotate_frame(
        self,
        frame: np.ndarray,
        vehicle_detections: list[Detection],
        person_detections: list[Detection],
        defects: list[Detection],
        gps: GPSData | None,
    ) -> np.ndarray:
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
            cv2.putText(annotated, label, (x1, y1 - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

        y = 20
        for cls, count in self._vehicle_counts.items():
            cv2.putText(annotated, f"{cls}: {count}", (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            y += 20

        total_vehicles = sum(self._vehicle_counts.values())
        unique = len(self._unique_vehicles)
        cv2.putText(annotated, f"Vehicles: {total_vehicles} | Unique: {unique}", (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
        y += 20
        cv2.putText(annotated, f"FPS: {self._fps:.1f} | Detect: {self._detection_latency_ms:.0f}ms | Frame: {self._frame_latency_ms:.0f}ms", (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
        y += 20

        source_label = "LIVE EDGE AI" if settings.model_mode.value == "real" else "SIMULATED DEMO"
        cv2.putText(annotated, f"SOURCE: {source_label}", (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 200, 255), 1)
        y += 20

        if gps:
            gps_label = f"GPS: {gps.latitude:.4f}, {gps.longitude:.4f} [{gps.source}]"
            cv2.putText(annotated, gps_label, (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1)

        return annotated

    def _queue_event(self, event: Event, frame: np.ndarray, detection: Detection | None) -> None:
        real = settings.model_mode.value == "real"
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
            ai_mode=settings.model_mode.value,
            model_name=settings.yolo_model_path if real else "mock",
            metadata={"bbox": detection.bbox} if detection and hasattr(detection, "bbox") else None,
        )
        event.evidence_url = evidence_path
        event_dict = event.to_dict()
        event_dict["ai_mode"] = settings.model_mode.value
        self.upload_queue.enqueue(event_dict)
        edge_state.component("QUEUE").mark_online(f"pending={self.upload_queue.pending_count}")
        self._session_event_count += 1
        log.info("[EVENT] %s → %s (severity=%s, conf=%.2f) [GPS %.4f,%.4f]",
                 event.event_id, event.event_type, event.severity, event.confidence,
                 event.latitude, event.longitude)
        if evidence_path:
            log.info("[EVIDENCE] %s", evidence_path)

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
                            log.info("[UPLOAD] SUCCESS → %s", event_id)
                            succeeded.append(event_id)
                            self._session_upload_count += 1
                        elif 400 <= resp.status_code < 500:
                            # Validation / auth errors: retrying will not help.
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
                        f"pending={self.upload_queue.pending_count} dead={self.upload_queue.dead_letter_count}"
                    )
                else:
                    edge_state.component("BACKEND").mark_online("queue drained")

            await asyncio.sleep(1)

    async def _heartbeat_loop(self) -> None:
        """Periodically report component + session state to the backend."""
        assert self._http_client is not None
        while self._running:
            try:
                session_id = edge_state.session_id
                if session_id:
                    payload = {
                        "frame_count": self._total_frames,
                        "event_count": self._session_event_count,
                        "upload_count": self._session_upload_count,
                        "error_count": self._session_error_count,
                    }
                    resp = await self._http_client.post(
                        f"{settings.backend_url}/api/sensing/sessions/{session_id}/update",
                        json=payload,
                        headers=self._auth_headers,
                    )
                    if resp.status_code in (200, 201):
                        edge_state.component("BACKEND").mark_online("heartbeat ok")
                    else:
                        log.warning("[HB] Heartbeat rejected %d", resp.status_code)
            except Exception as e:
                log.debug("[HB] Heartbeat failed: %s", e)
            await asyncio.sleep(10)

    def stop(self) -> None:
        self._running = False
        self.source.release()
        self.gps.shutdown()
        if self._http_client:
            import asyncio
            try:
                loop = asyncio.get_running_loop()
                # Run sequentially in ONE task: the backend session-close POST
                # round-trip must complete before the client is torn down, or it
                # may never reach the backend (previous two-task race).
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
            await self._http_client.post(
                f"{settings.backend_url}/api/sensing/sessions/{session_id}/close",
                headers=self._auth_headers,
            )
        except Exception:
            pass


if __name__ == "__main__":
    pipeline = EdgePipeline()
    try:
        asyncio.run(pipeline.start())
    except (KeyboardInterrupt, SystemExit):
        pipeline.stop()
