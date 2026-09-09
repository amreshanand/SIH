"""Real YOLOv8 frame inference for UrbanSense AI.

Runs two YOLO models over each frame:

1. ``VehicleModel`` — a COCO-pretrained model (yolov8n.pt / any COCO weights)
   producing bus, car, truck, motorcycle, bicycle and person detections.
2. ``RoadDamageModel`` — a custom-trained road-damage model producing defect
   classes (pothole, crack, patch, rutting, edge break, surface failure, ...).

No simulated detections exist in this module. If a model cannot be loaded the
module reports the failure loudly through the edge state tracker rather than
silently fabricating detections.
"""

from __future__ import annotations

import threading
import time
from typing import Callable

import numpy as np

from edge.inference.result import InferenceResult
from edge.detection.classes import (
    ROAD_DAMAGE_CLASSES,
    normalize_road_damage_class,
)

# COCO class ids we care about for vehicle/pedestrian monitoring.
# See https://github.com/ultralytics/ultralytics/blob/main/ultralytics/cfg/datasets/coco.yaml
COCO_VEHICLE_IDS = {
    1: "bicycle",
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
    0: "person",
}
# Always monitor pedestrians (person) plus the five vehicle classes.
COCO_TARGETS = {"bicycle", "car", "motorcycle", "bus", "truck", "person"}


class _ModelHandle:
    """Wraps an ultralytics YOLO model with lazy load + backoff-on-failure.

    Loading a YOLO model is expensive (torch init). We attempt the load once,
    then back off for ``backoff_seconds`` between retries so a missing/corrupt
    weights file doesn't hammer the disk/GPU every frame.
    """

    def __init__(
        self,
        model_path: str,
        state_tracker: object,
        component_name: str,
        backoff_seconds: float = 30.0,
    ) -> None:
        self.model_path = model_path
        self._state = state_tracker
        self._component = component_name
        self._backoff_seconds = backoff_seconds
        self._model = None
        self._model_names: dict[int, str] = {}
        self._attempted = False
        self._next_attempt = 0.0
        self._lock = threading.Lock()
        self.load_error: str | None = None

    def _load(self) -> None:
        import torch

        # Ensure PyTorch 2.6+ compatibility with Ultralytics model checkpoints
        if getattr(torch, "_us_load_patched", None) is None:
            _orig_load = torch.load
            torch.load = lambda *args, **kwargs: _orig_load(
                *args, **{k: v for k, v in kwargs.items() if k != "weights_only"}, weights_only=False
            )
            torch._us_load_patched = True

        from ultralytics import YOLO

        self._model = YOLO(self.model_path)
        self._model_names = self._model.names or {}

    def predict(self, frame: np.ndarray, confidence: float) -> list[InferenceResult]:
        if self._model is None and not self._load_or_backoff():
            return []
        try:
            results = self._model.predict(
                frame, conf=confidence, verbose=False, device=self._device
            )
        except Exception as exc:  # noqa: BLE001
            if self._state is not None:
                self._state.component(self._component).mark_failure(str(exc))
            return []
        return self._parse(results)

    def predict_batch(
        self, frames: list[np.ndarray], confidence: float, batch_size: int = 8
    ) -> list[list[InferenceResult]]:
        """Batch inference over many frames (per-frame detections preserved).

        Inference is run model-side in batches of ``batch_size`` — one forward
        pass per batch on GPU — which is faster than N individual calls for
        burst / multi-camera pipelines. The result is aligned with ``frames``.
        """
        if self._model is None and not self._load_or_backoff():
            return [[] for _ in frames]
        outputs: list[list[InferenceResult]] = []
        bs = max(1, batch_size)
        for start in range(0, len(frames), bs):
            chunk = frames[start : start + bs]
            try:
                results = self._model.predict(
                    chunk, conf=confidence, verbose=False, device=self._device
                )
                individual = list(results)
            except Exception as exc:  # noqa: BLE001
                if self._state is not None:
                    self._state.component(self._component).mark_failure(str(exc))
                individual = [None] * len(chunk)
            for res in individual:
                outputs.append(self._parse(res) if res is not None else [])
        return outputs[: len(frames)]

    def _parse(self, results: object) -> list[InferenceResult]:
        """Parse a YOLO ``results`` object into an InferenceResult list."""
        parsed: list[InferenceResult] = []
        for r in results:
            boxes = getattr(r, "boxes", None)
            if boxes is None:
                continue
            for box in boxes:
                cls_id = int(box.cls[0])
                cls_name = self._model_names.get(cls_id, "class_0")
                conf = float(box.conf[0])
                x1, y1, x2, y2 = (int(v) for v in box.xyxy[0])
                parsed.append(
                    InferenceResult(
                        class_name=cls_name.lower(),
                        confidence=conf,
                        bbox=(x1, y1, x2, y2),
                        source_model=self.model_path,
                    )
                )
        return parsed

    def _load_or_backoff(self) -> bool:
        now = time.time()
        with self._lock:
            if now < self._next_attempt:
                return self._model is not None
            self._next_attempt = now + self._backoff_seconds
            if not self._attempted or self.load_error:
                try:
                    self._load()
                    self.load_error = None
                    self._next_attempt = 0.0
                except Exception as exc:  # noqa: BLE001
                    import traceback

                    self.load_error = f"{exc}"
                    if self._state is not None:
                        self._state.component(self._component).mark_failure(
                            f"model load failed: {exc}"
                        )
                    traceback.print_exc()
                    return False
            return self._model is not None

    def export_engine(self, fmt: str = "onnx", out_dir: str | None = None) -> str:
        """Export the current model to a deployable engine (onnx/tensorrt/torchscript).

        Uses Ultralytics' built-in export. TenorRT requires a CUDA-capable
        host at export time; ONNX and TorchScript work on CPU. The returned
        path points to the exported engine, which can then be passed to a new
        model handle for accelerated inference.
        """
        if self._model is None and not self._load_or_backoff():
            raise RuntimeError(f"Cannot export unloaded model {self.model_path}.")
        fmt = (fmt or "onnx").lower()
        if fmt not in {"onnx", "tensorrt", "torchscript"}:
            raise ValueError(f"Unsupported export format: {fmt}")
        try:
            path = self._model.export(format=fmt, imgsz=[self._img_size, self._img_size])
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"Model export failed ({fmt}): {exc}") from exc
        return path

    @property
    def _device(self) -> str:
        try:
            import torch

            if torch.cuda.is_available():
                return "0"
            if torch.backends.mps.is_available():
                return "mps"
        except Exception:  # noqa: BLE001
            pass
        return "cpu"

    @property
    def _img_size(self) -> int:
        # Best-effort default image size; overridden lazily once a model loads.
        return 640


class VehicleDetector:
    """COCO vehicle/pedestrian detection using a single YOLOv8 pass."""

    def __init__(
        self,
        model_path: str,
        confidence_threshold: float,
        state_tracker: object | None = None,
    ) -> None:
        self._model = _ModelHandle(model_path, state_tracker, "AI", backoff_seconds=30.0)
        self.confidence_threshold = confidence_threshold

    def detect(self, frame: np.ndarray) -> list[InferenceResult]:
        all_dets = self._model.predict(frame, self.confidence_threshold)
        return [d for d in all_dets if d.class_name in COCO_TARGETS]


class RoadDamageDetector:
    """Custom road-damage detection using a single YOLOv8 pass."""

    def __init__(
        self,
        model_path: str,
        confidence_threshold: float,
        state_tracker: object | None = None,
    ) -> None:
        self._model = _ModelHandle(model_path, state_tracker, "AI", backoff_seconds=30.0)
        self.confidence_threshold = confidence_threshold

    def detect(self, frame: np.ndarray) -> list[InferenceResult]:
        all_dets = self._model.predict(frame, self.confidence_threshold)
        return self._normalize(all_dets)

    def detect_batch(
        self, frames: list[np.ndarray], batch_size: int = 8
    ) -> list[list[InferenceResult]]:
        """Batch road-damage detection over multiple frames."""
        batched = self._model.predict_batch(
            frames, self.confidence_threshold, batch_size=batch_size
        )
        return [self._normalize(per_frame) for per_frame in batched]

    @staticmethod
    def _normalize(dets: list[InferenceResult]) -> list[InferenceResult]:
        """Normalize each raw model class onto the canonical 9-class taxonomy.

        Recognized classes are kept; classes outside the road-damage vocabulary
        (e.g. stray vehicle classes from a shared model) are discarded.
        """
        normalized: list[InferenceResult] = []
        for d in dets:
            canonical = normalize_road_damage_class(d.class_name)
            if canonical is None:
                continue
            d.class_name = canonical
            normalized.append(d)
        return [d for d in normalized if d.class_name in ROAD_DAMAGE_CLASSES]


class FrameInferenceEngine:
    """Runs vehicle + road-damage inference over a frame.

    Normalizes both models' outputs into a shared namespace of
    ``InferenceResult`` objects. The two models may share a single model
    (weight-sharing COCO+damage) — in that case pass the same path to both.
    """

    def __init__(
        self,
        vehicle_model_path: str,
        road_damage_model_path: str,
        vehicle_confidence: float,
        road_damage_confidence: float,
        state_tracker: object | None = None,
    ) -> None:
        self.vehicle = VehicleDetector(
            vehicle_model_path, vehicle_confidence, state_tracker
        )
        self.road = RoadDamageDetector(
            road_damage_model_path, road_damage_confidence, state_tracker
        )

    def infer(
        self, frame: np.ndarray
    ) -> tuple[list[InferenceResult], list[InferenceResult]]:
        """Returns (vehicle_detections, road_damage_detections)."""
        vehicles = self.vehicle.detect(frame)
        defects = self.road.detect(frame)
        return vehicles, defects
