"""Road-defect detection (compatibility module).

The production real road-damage detector lives in
``edge.inference.yoloframe.RoadDamageDetector``. This module exists only as a
backwards-compatible re-export so legacy imports keep working.

There is deliberately NO simulated/mock detector here: the platform performs
real inference only. Any prior mock detected classes (a cadence-driven sequence
mislabeled ``REAL_AI``) have been removed because they contradict the
real-inference guarantee.
"""

from __future__ import annotations

import numpy as np

from edge.inference.yoloframe import RoadDamageDetector
from edge.detection.classes import (
    ROAD_DAMAGE_CLASSES,
    ROAD_DAMAGE_LABELS,
    normalize_road_damage_class,
)

__all__ = [
    "RoadDamageDetector",
    "ROAD_DAMAGE_CLASSES",
    "ROAD_DAMAGE_LABELS",
    "normalize_road_damage_class",
    "RealRoadDefectDetector",
]


class RealRoadDefectDetector(RoadDamageDetector):
    """Alias for the canonical real road-damage detector (YOLOv8)."""

    def __init__(self, model_path: str, confidence_threshold: float = 0.5) -> None:
        super().__init__(model_path, confidence_threshold)

    def detect(self, frame: np.ndarray):
        return super().detect(frame)
