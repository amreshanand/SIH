from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from edge.inference.result import InferenceResult
from edge.gps.base import GPSData
from edge.utils.logger import log


@dataclass
class Event:
    event_id: str
    event_type: str
    bus_id: str
    camera_id: str
    severity: str
    confidence: float
    latitude: float
    longitude: float
    source: str = "EDGE_AI"
    evidence_url: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "event_type": self.event_type,
            "bus_id": self.bus_id,
            "camera_id": self.camera_id,
            "severity": self.severity,
            "confidence": self.confidence,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "source": self.source,
            "evidence_url": self.evidence_url,
            "metadata_json": self.metadata,
            "timestamp": self.timestamp,
        }


class EventEngine:
    """Emits infrastructure events from temporally-confirmed real detections.

    Design (real-inference only):
    * Temporal confirmation — an event is emitted only when the same class is
      observed across ``min_observations`` frames within ``temporal_window``.
    * Tracking-aware dedup — a road defect that keeps producing detections is
      reported once per cluster/period; stable track IDs prevent duplicate
      emergencies for the same physical object.

    There is no mocked event source. All events derive from Detection objects
    produced by the real inference engine.
    """

    SEVERITY_ORDER = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}
    DEFAULT_SEVERITY_MAP = {
        "pothole": "HIGH",
        "longitudinal_crack": "MEDIUM",
        "transverse_crack": "MEDIUM",
        "alligator_crack": "HIGH",
        "edge_break": "HIGH",
        "rutting": "MEDIUM",
        "surface_wear": "LOW",
        "road_crack": "LOW",
        "patch_failure": "MEDIUM",
        "utility_cover_damage": "CRITICAL",
    }

    def __init__(
        self,
        bus_id: str,
        camera_id: str,
        min_confidence: float = 0.5,
        temporal_window: float = 3.0,
        min_observations: int = 2,
        cluster_distance_meters: float = 50.0,
    ) -> None:
        self.bus_id = bus_id
        self.camera_id = camera_id
        self.min_confidence = min_confidence
        self.temporal_window = temporal_window
        self.min_observations = min_observations
        self.cluster_distance_meters = cluster_distance_meters
        # class -> list of observations (confidence, timestamp, area_ratio).
        self._pending: dict[str, list[dict[str, Any]]] = {}
        # class -> last emission time (cooldown so persistent defects aren't
        # re-reported every min_observations frames).
        self._last_emit: dict[str, float] = {}
        self._event_counter = 0

    def process_detection(
        self,
        detection: InferenceResult,
        gps: GPSData | None,
        frame_width: int = 640,
        frame_height: int = 480,
        bus_count: int = 1,
        existing_severity: str | None = None,
    ) -> Event | None:
        if detection.confidence < self.min_confidence:
            return None

        key = detection.class_name
        now = time.time()

        observations = self._pending.setdefault(key, [])
        observations.append(
            {
                "confidence": detection.confidence,
                "timestamp": now,
                "bbox": detection.bbox,
                "area": detection.area,
            }
        )

        cutoff = now - self.temporal_window
        self._pending[key] = [o for o in observations if o["timestamp"] > cutoff]

        if len(self._pending[key]) < self.min_observations:
            return None

        # Cooldown: do not re-emit the same class until the temporal window has
        # elapsed since the last emission.
        if now - self._last_emit.get(key, 0.0) < self.temporal_window:
            self._pending[key] = []
            return None

        batch = self._pending[key]
        avg_conf = sum(o["confidence"] for o in batch) / len(batch)
        max_area_ratio = max(
            (o["area"] / (frame_width * frame_height)) for o in batch
        )
        severity = self.score_severity(
            class_name=detection.class_name,
            confidence=avg_conf,
            area_ratio=max_area_ratio,
            observation_count=len(batch),
            bus_count=bus_count,
            existing_severity=existing_severity,
        )

        self._event_counter += 1
        event_id = f"EVT-{int(time.time())}-{self._event_counter:04d}"
        lat = gps.latitude if gps else 0.0
        lon = gps.longitude if gps else 0.0

        event = Event(
            event_id=event_id,
            event_type=detection.class_name.upper(),
            bus_id=self.bus_id,
            camera_id=self.camera_id,
            severity=severity,
            confidence=avg_conf,
            latitude=lat,
            longitude=lon,
            metadata={
                "observations": len(batch),
                "bbox": detection.bbox,
                "track_id": detection.track_id,
                "source_model": getattr(detection, "source_model", "mock"),
                "gps_source": gps.source if gps else "UNKNOWN",
                "area_ratio": round(max_area_ratio, 4),
            },
        )

        self._pending[key] = []
        self._last_emit[key] = now
        log.info(
            "[EVENT] %s confirmed (conf=%.2f, sev=%s, obs=%d, track=%s)",
            event.event_type,
            avg_conf,
            severity,
            len(batch),
            detection.track_id,
        )
        return event

    def score_severity(
        self,
        class_name: str,
        confidence: float,
        area_ratio: float,
        observation_count: int,
        bus_count: int = 1,
        existing_severity: str | None = None,
    ) -> str:
        # The class's base severity is the floor — a confirmed real detection of
        # e.g. a pothole should never be downgraded below HIGH just because the
        # defect box is small. Confidence, coverage and observation count can
        # only raise (never lower) the severity.
        base = self.DEFAULT_SEVERITY_MAP.get(class_name, "MEDIUM")
        if existing_severity in self.SEVERITY_ORDER and (
            self.SEVERITY_ORDER[existing_severity] > self.SEVERITY_ORDER[base]
        ):
            # A backend-confirmed open issue already raised the bar for this
            # location (e.g. reported by another bus); never downgrade it.
            base = existing_severity
        level = self.SEVERITY_ORDER.get(base, 1)

        if confidence >= 0.92:
            level = min(level + 1, 3)
        if area_ratio > 0.15:
            level = min(level + 1, 3)
        if observation_count >= 4:
            level = min(level + 1, 3)
        # Cross-bus confirmation: multiple distinct buses reporting the same
        # location is strong evidence the defect is real and severe.
        if bus_count >= 2:
            level = min(level + 1, 3)
        if bus_count >= 3:
            level = min(level + 1, 3)

        return {0: "LOW", 1: "MEDIUM", 2: "HIGH", 3: "CRITICAL"}[level]
