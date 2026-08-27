from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from edge.detection.vehicle_detector import Detection


class RoadDefectDetector:
    def detect(self, frame: np.ndarray) -> list[Detection]:
        raise NotImplementedError


class MockRoadDefectDetector(RoadDefectDetector):
    def __init__(self, confidence_threshold: float = 0.5) -> None:
        self.confidence_threshold = confidence_threshold
        self._frame_count = 0

    def detect(self, frame: np.ndarray) -> list[Detection]:
        self._frame_count += 1
        if self._frame_count % 120 < 5:
            h, w = frame.shape[:2]
            return [Detection(
                class_name="pothole",
                confidence=0.91,
                bbox=(w // 3, h // 2, 2 * w // 3, h - 20),
                metadata={"source": "SIMULATED"},
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
