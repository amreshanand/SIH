from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

VEHICLE_CLASSES = {"car", "motorcycle", "bus", "truck", "bicycle"}
ALL_DETECTABLE_CLASSES = VEHICLE_CLASSES | {"person"}


@dataclass
class Detection:
    class_name: str
    confidence: float
    bbox: tuple[int, int, int, int]
    track_id: int | None = None
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


class Detector:
    def detect(self, frame: np.ndarray) -> list[Detection]:
        raise NotImplementedError


class MockDetector(Detector):
    def __init__(self, confidence_threshold: float = 0.4) -> None:
        self.confidence_threshold = confidence_threshold
        self._frame_count = 0

    def detect(self, frame: np.ndarray) -> list[Detection]:
        self._frame_count += 1
        h, w = frame.shape[:2]
        detections: list[Detection] = []

        vehicle_configs = [
            ("car", 0.87, (50, 50, 200, 180)),
            ("motorcycle", 0.82, (220, 60, 340, 180)),
            ("car", 0.79, (350, 40, 500, 170)),
            ("truck", 0.85, (480, 30, 620, 200)),
            ("bicycle", 0.75, (100, 100, 180, 200)),
        ]

        if self._frame_count % 30 < 20:
            for cls, conf, bbox in vehicle_configs:
                x_scale = w / 640
                y_scale = h / 480
                scaled = tuple(int(v * s) for v, s in zip(bbox, [x_scale, y_scale, x_scale, y_scale]))
                detections.append(Detection(
                    class_name=cls,
                    confidence=conf,
                    bbox=scaled,
                    metadata={"source": "SIMULATED"},
                ))

            if self._frame_count % 60 < 10:
                ped_scale = (w / 640, h / 480)
                ped_bbox = (280, 120, 320, 240)
                scaled_ped = tuple(int(v * s) for v, s in zip(ped_bbox, [ped_scale[0], ped_scale[1], ped_scale[0], ped_scale[1]]))
                detections.append(Detection(
                    class_name="person",
                    confidence=0.83,
                    bbox=scaled_ped,
                    metadata={"source": "SIMULATED"},
                ))

        return detections


class YOLODetector(Detector):
    def __init__(self, model_path: str, confidence_threshold: float = 0.4) -> None:
        self.model_path = model_path
        self.confidence_threshold = confidence_threshold
        self._model = None
        self._load_attempted = False
        self._load_backoff_until = 0.0

    def load(self) -> None:
        from ultralytics import YOLO
        self._model = YOLO(self.model_path)
        from edge.utils.logger import log
        log.info("[AI] YOLO model loaded: %s", self.model_path)

    def detect(self, frame: np.ndarray) -> list[Detection]:
        import time
        if self._model is None and not self._load_attempted:
            self._load_attempted = True
            try:
                self.load()
            except Exception as e:
                from edge.utils.logger import log
                log.error("[AI] YOLO load failed (will not retry this run): %s", e)
                self._load_backoff_until = time.time() + 30
                return []

        if self._model is None:
            # Model unavailable — back off instead of retrying every frame.
            if time.time() < self._load_backoff_until:
                return []
            self._load_backoff_until = time.time() + 30
            self._load_attempted = False
            try:
                self.load()
            except Exception as e:
                from edge.utils.logger import log
                log.error("[AI] YOLO load retry failed: %s", e)
                return []

        results = self._model(frame, conf=self.confidence_threshold, verbose=False)
        detections: list[Detection] = []

        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                cls_name = self._model.names[cls_id]
                if cls_name not in ALL_DETECTABLE_CLASSES:
                    continue
                conf = float(box.conf[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                detections.append(Detection(
                    class_name=cls_name,
                    confidence=conf,
                    bbox=(x1, y1, x2, y2),
                ))
        return detections
