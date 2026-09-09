from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class InferenceResult:
    """A single detected object produced by real YOLO inference.

    This is the canonical in-pipeline representation shared by the vehicle
    (COCO) and road-damage detectors. Tracking mutates ``track_id`` in place so
    object identities persist across frames.
    """

    class_name: str  # lower-case class label, e.g. "pothole", "car", "person"
    confidence: float
    bbox: tuple[int, int, int, int]  # x1, y1, x2, y2
    track_id: int | None = None
    source_model: str = "UNKNOWN"  # which model produced this detection
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def center(self) -> tuple[int, int]:
        return (
            (self.bbox[0] + self.bbox[2]) // 2,
            (self.bbox[1] + self.bbox[3]) // 2,
        )

    @property
    def area(self) -> int:
        return (self.bbox[2] - self.bbox[0]) * (self.bbox[3] - self.bbox[1])

    def to_dict(self) -> dict[str, Any]:
        return {
            "class_name": self.class_name,
            "confidence": self.confidence,
            "bbox": list(self.bbox),
            "track_id": self.track_id,
            "source_model": self.source_model,
            "metadata": self.metadata,
        }
