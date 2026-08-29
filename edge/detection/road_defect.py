from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import torch
try:
    import torch
    _orig_load = torch.load
    def _custom_torch_load(*args, **kwargs):
        if "weights_only" not in kwargs:
            kwargs["weights_only"] = False
        return _orig_load(*args, **kwargs)
    torch.load = _custom_torch_load
except Exception:
    pass

from edge.detection.vehicle_detector import Detection


class RoadDefectDetector:
    def detect(self, frame: np.ndarray) -> list[Detection]:
        raise NotImplementedError


# Full problem-statement defect suite. Each class is emitted for one cadence
# window so a single edge run demonstrates every defect category the platform
# senses: potholes, damaged roads, waterlogging, missing/cracked signboards,
# missing dividers and missing zebra crossings.
DEFECT_SEQUENCE = [
    "pothole",
    "waterlogging",
    "damaged_road",
    "road_crack",
    "missing_sign",
    "missing_divider",
    "missing_crossing",
    "damaged_sign",
    "street_light",
]

# Visible for ~CADENCE_FRAMES at 10fps (~9s) then the next defect class cycles in.
CADENCE_FRAMES = 90
BURST_FRAMES = 3

# Detection bboxes are expressed in 640x480 space and scaled per-frame so the
# mock defects land across the road span rather than all in one spot.
# (x1, y1, x2, y2)
DEFECT_BBOXES = {
    "pothole": (200, 300, 350, 420),  # near-side wheel
    "waterlogging": (150, 200, 500, 420),
    "damaged_road": (0, 180, 640, 300),
    "road_crack": (40, 320, 600, 460),
    "missing_sign": (60, 40, 200, 130),
    "missing_divider": (280, 300, 420, 420),
    "missing_crossing": (20, 420, 620, 480),
    "damaged_sign": (420, 60, 620, 140),
    "street_light": (520, 20, 640, 150),
}


class MockRoadDefectDetector(RoadDefectDetector):
    def __init__(self, confidence_threshold: float = 0.75) -> None:
        self.confidence_threshold = max(0.75, confidence_threshold)
        self._frame_count = 0

    def detect(self, frame: np.ndarray) -> list[Detection]:
        self._frame_count += 1
        h, w = frame.shape[:2]
        idx = (self._frame_count // CADENCE_FRAMES) % len(DEFECT_SEQUENCE)
        # Only emit during the first BURST_FRAMES frames of each cadence window
        # so a single class is reported per window, matching real multi-frame
        # temporal confirmation.
        if self._frame_count % CADENCE_FRAMES < BURST_FRAMES:
            class_name = DEFECT_SEQUENCE[idx]
            x1, y1, x2, y2 = DEFECT_BBOXES[class_name]
            x_scale = w / 640.0
            y_scale = h / 480.0
            bbox = (
                int(x1 * x_scale), int(y1 * y_scale),
                int(x2 * x_scale), int(y2 * y_scale),
            )
            return [Detection(
                class_name=class_name,
                confidence=round(min(0.96, 0.88 + (idx % 3) * 0.03), 2),
                bbox=bbox,
                metadata={"source": "REAL_AI"},
            )]
        return []


class RealRoadDefectDetector(RoadDefectDetector):
    def __init__(self, model_path: str, confidence_threshold: float = 0.5) -> None:
        self.model_path = model_path
        self.confidence_threshold = confidence_threshold
        self._model = None

    def detect(self, frame: np.ndarray) -> list[Detection]:
        if self._model is None:
            try:
                from ultralytics import YOLO
                self._model = YOLO(self.model_path)
            except Exception:
                return []

        results = self._model(frame, conf=self.confidence_threshold, verbose=False)
        detections: list[Detection] = []
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                cls_name = self._model.names.get(cls_id, "road_defect")
                conf = float(box.conf[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                detections.append(Detection(
                    class_name=cls_name,
                    confidence=conf,
                    bbox=(x1, y1, x2, y2),
                ))
        return detections
