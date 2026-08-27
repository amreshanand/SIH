from __future__ import annotations

import math
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from edge.detection.vehicle_detector import Detection
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
        }


class EventEngine:
    DEFAULT_SEVERITY_MAP = {
        "pothole": "HIGH",
        "waterlogging": "HIGH",
        "damaged_road": "HIGH",
        "road_crack": "MEDIUM",
        "missing_sign": "MEDIUM",
        "missing_crossing": "MEDIUM",
        "damaged_sign": "MEDIUM",
        "street_light": "MEDIUM",
        "pedestrian_risk": "HIGH",
        "rash_driving": "CRITICAL",
        "hit_and_run": "CRITICAL",
        "collision": "CRITICAL",
    }

    SEVERITY_ORDER = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}

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
        self._pending: dict[str, list[dict[str, Any]]] = {}
        self._event_counter = 0

    def process_detection(
        self,
        detection: Detection,
        gps: GPSData | None,
        frame_metadata: dict[str, Any] | None = None,
        frame_width: int = 640,
        frame_height: int = 480,
    ) -> Event | None:
        if detection.confidence < self.min_confidence:
            return None

        key = detection.class_name
        now = time.time()

        if key not in self._pending:
            self._pending[key] = []

        self._pending[key].append({
            "confidence": detection.confidence,
            "timestamp": now,
            "bbox": detection.bbox,
            "area": detection.area,
        })

        cutoff = now - self.temporal_window
        self._pending[key] = [o for o in self._pending[key] if o["timestamp"] > cutoff]

        if len(self._pending[key]) >= self.min_observations:
            observations = self._pending[key]
            avg_conf = sum(o["confidence"] for o in observations) / len(observations)
            self._event_counter += 1
            event_id = f"EVT-{int(time.time())}-{self._event_counter:04d}"

            max_area_ratio = max(
                (o["area"] / (frame_width * frame_height)) for o in observations
            )
            severity = self.score_severity(
                class_name=detection.class_name,
                confidence=avg_conf,
                area_ratio=max_area_ratio,
                observation_count=len(observations),
            )

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
                    "observations": len(observations),
                    "bbox": detection.bbox,
                    "gps_source": gps.source if gps else "UNKNOWN",
                    "area_ratio": round(max_area_ratio, 4),
                    **(frame_metadata or {}),
                },
            )

            self._pending[key] = []
            log.info("[EVENT] %s detected (conf=%.2f, sev=%s, obs=%d)",
                     event.event_type, avg_conf, severity, len(observations))
            return event

        return None

    def score_severity(
        self,
        class_name: str,
        confidence: float,
        area_ratio: float,
        observation_count: int,
    ) -> str:
        base = self.DEFAULT_SEVERITY_MAP.get(class_name, "MEDIUM")
        base_level = self.SEVERITY_ORDER.get(base, 1)

        adjusted = base_level

        if confidence >= 0.92:
            adjusted = min(adjusted + 1, 3)
        elif confidence < 0.6:
            adjusted = max(adjusted - 1, 0)

        if area_ratio > 0.15:
            adjusted = min(adjusted + 1, 3)
        elif area_ratio < 0.01:
            adjusted = max(adjusted - 1, 0)

        if observation_count >= 4:
            adjusted = min(adjusted + 1, 3)

        severity_map = {0: "LOW", 1: "MEDIUM", 2: "HIGH", 3: "CRITICAL"}
        return severity_map[adjusted]

    def process_traffic(
        self, vehicle_count: int, vehicle_dist: dict[str, int], gps: GPSData,
        congestion_threshold: int = 5,
    ) -> Event | None:
        if vehicle_count < congestion_threshold:
            return None

        congestion = min(100, int(vehicle_count * 5))

        self._event_counter += 1
        return Event(
            event_id=f"EVT-TRAFFIC-{int(time.time())}-{self._event_counter:04d}",
            event_type="TRAFFIC_CONGESTION",
            bus_id=self.bus_id,
            camera_id=self.camera_id,
            severity="MEDIUM" if congestion < 60 else "HIGH",
            confidence=0.9,
            latitude=gps.latitude,
            longitude=gps.longitude,
            metadata={
                "vehicle_count": vehicle_count,
                "vehicle_distribution": vehicle_dist,
                "congestion_score": congestion,
                "gps_source": gps.source,
            },
        )
