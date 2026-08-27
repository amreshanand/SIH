from __future__ import annotations

import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class Detection:
    class_name: str
    confidence: float
    bbox: tuple[int, int, int, int] = (0, 0, 0, 0)


@dataclass
class GPSData:
    latitude: float = 0.0
    longitude: float = 0.0
    source: str = "unknown"


@dataclass
class IncidentResult:
    incident_type: str
    severity: str
    confidence: float
    plate_text: str | None = None
    plate_confidence: float | None = None


class IncidentDetector:
    def analyze(
        self,
        detections: list[Detection],
        gps: GPSData,
        frame_metadata: dict | None = None,
    ) -> IncidentResult | None:
        pedestrians = [d for d in detections if d.class_name == "person"]
        vehicles = [d for d in detections if d.class_name in ("car", "motorcycle", "truck", "bus")]

        if pedestrians and vehicles:
            for ped in pedestrians:
                for veh in vehicles:
                    px = (ped.bbox[0] + ped.bbox[2]) / 2
                    vx = (veh.bbox[0] + veh.bbox[2]) / 2
                    dist = abs(px - vx)
                    if dist < 100:
                        logger.warning("[INCIDENT] PEDESTRIAN_RISK detected (proximity=%.0f)", dist)
                        return IncidentResult(
                            incident_type="PEDESTRIAN_RISK",
                            severity="HIGH",
                            confidence=0.78,
                        )
        return None


class MockOCRDetector:
    def detect_plate(self, detections: list[Detection]) -> tuple[str, float] | None:
        for d in detections:
            if d.class_name in ("car", "truck", "motorcycle"):
                return ("MH12AB1234", 0.94)
        return None
