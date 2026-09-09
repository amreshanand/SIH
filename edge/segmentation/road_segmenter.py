"""Road Segmentation Layer for UrbanSense AI.

Detects drivable asphalt road area and rejects defect candidate bounding boxes
that fall outside the drivable road boundary (e.g. sidewalks, buildings,
curbs, trees, sky, parked vehicles, pedestrian crossings).

Rejection Rule:
    A defect bounding box B is valid iff the intersection with the drivable
    road mask covers >= 80% of B's area:
        Road Overlap Ratio R(B) = (Sum_{p in B} Mask(p)) / Area(B) >= 0.80
"""

from __future__ import annotations

import os
import time
from typing import Optional, Tuple
import cv2
import numpy as np

from edge.utils.logger import log


class RoadSegmenter:
    """Extracts drivable road masks and filters out-of-bounds defect candidates."""

    def __init__(
        self,
        model_path: Optional[str] = None,
        min_overlap_ratio: float = 0.80,
        enable_seg_model: bool = False,
    ) -> None:
        self.min_overlap_ratio = min_overlap_ratio
        self.enable_seg_model = enable_seg_model
        self._model = None
        self._last_mask: Optional[np.ndarray] = None
        self._last_mask_time = 0.0
        self._cache_duration_sec = 0.15  # Re-use mask across ~3-4 frames at 25fps

        if model_path and os.path.exists(model_path) and self.enable_seg_model:
            try:
                from ultralytics import YOLO
                self._model = YOLO(model_path)
                log.info("Road segmenter loaded YOLO segmentation model from %s", model_path)
            except Exception as e:
                log.warning("Could not load segmentation model (%s); falling back to adaptive geometric road mask.", e)
                self._model = None

    def get_drivable_mask(self, frame: np.ndarray) -> np.ndarray:
        """Compute or retrieve cached binary mask of drivable road surface.

        Returns a uint8 2D array of shape (H, W) where 255 = drivable road, 0 = non-road.
        """
        now = time.time()
        h, w = frame.shape[:2]

        if self._last_mask is not None and (now - self._last_mask_time) < self._cache_duration_sec:
            if self._last_mask.shape == (h, w):
                return self._last_mask

        # 1. Real YOLO Segmentation if available
        if self._model is not None:
            try:
                results = self._model.predict(frame, classes=[0], verbose=False)
                if results and len(results) > 0 and results[0].masks is not None:
                    mask_data = results[0].masks.data.cpu().numpy()
                    if len(mask_data) > 0:
                        merged = np.any(mask_data > 0.5, axis=0).astype(np.uint8) * 255
                        mask = cv2.resize(merged, (w, h), interpolation=cv2.INTER_NEAREST)
                        self._last_mask = mask
                        self._last_mask_time = now
                        return mask
            except Exception as e:
                log.debug("Segmentation inference error: %s", e)

        # 2. High-Performance Adaptive Perspective Road Mask
        # In municipal forward-facing bus cameras, the drivable road occupies a
        # perspective trapezoid extending from the lower hood line upward toward
        # the calibrated vanishing horizon (~45% - 55% frame height), bounded
        # laterally by lane boundaries/curbs, filtering out sky, trees & sidewalks.
        mask = np.zeros((h, w), dtype=np.uint8)

        horizon_y = int(h * 0.48)
        top_left_x = int(w * 0.28)
        top_right_x = int(w * 0.72)
        bottom_left_x = int(w * 0.05)
        bottom_right_x = int(w * 0.95)

        trapezoid = np.array([
            [bottom_left_x, h],
            [top_left_x, horizon_y],
            [top_right_x, horizon_y],
            [bottom_right_x, h]
        ], dtype=np.int32)

        cv2.fillPoly(mask, [trapezoid], 255)

        # Edge refinement: road texture/color thresholding to reject grass/sky
        # Convert to HSV and verify saturation/value typical of asphalt
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        sat = hsv[:, :, 1]
        val = hsv[:, :, 2]
        
        # Overcast/dry asphalt is low saturation (grayscale) and medium value
        # Sky and green vegetation have high saturation or very high brightness
        asphalt_like = (sat < 90) & (val > 30) & (val < 235)
        mask = cv2.bitwise_and(mask, mask, mask=asphalt_like.astype(np.uint8) * 255)

        # Morphological closing to fill minor cracks/lane markings inside the road
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

        self._last_mask = mask
        self._last_mask_time = now
        return mask

    def compute_overlap_ratio(
        self, bbox: Tuple[int, int, int, int], mask: np.ndarray
    ) -> float:
        """Calculate the proportion of the defect bounding box that intersects drivable road."""
        x1, y1, x2, y2 = bbox
        h, w = mask.shape[:2]

        # Clamp coordinates within frame boundaries
        x1 = max(0, min(w - 1, int(x1)))
        y1 = max(0, min(h - 1, int(y1)))
        x2 = max(0, min(w, int(x2)))
        y2 = max(0, min(h, int(y2)))

        area = (x2 - x1) * (y2 - y1)
        if area <= 0:
            return 0.0

        bbox_mask_roi = mask[y1:y2, x1:x2]
        road_pixels = np.count_nonzero(bbox_mask_roi == 255)
        return float(road_pixels / area)

    def is_on_drivable_road(
        self, bbox: Tuple[int, int, int, int], mask: np.ndarray
    ) -> Tuple[bool, float]:
        """Validate if bbox meets the minimum drivable road overlap ratio threshold."""
        ratio = self.compute_overlap_ratio(bbox, mask)
        return ratio >= self.min_overlap_ratio, ratio
