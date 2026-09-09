"""Perspective-Aware Dynamic Area Validation for UrbanSense AI.

Rejects defect bounding boxes that violate physical plausibility:
1. Unphysically small: camera sensor noise, gravel, speckles (area < dynamic_min)
2. Unphysically large: bridge shadows spanning the entire road, asphalt transitions (area > dynamic_max)

Perspective Scaling:
    Because forward-facing vehicle cameras introduce perspective projection,
    an object at the bottom of the frame (near vehicle hood) appears much larger
    than the identical object near the vanishing horizon. The min and max area
    thresholds scale with the vertical position y of the bounding box bottom.
"""

from __future__ import annotations

from typing import Tuple


class AreaValidator:
    """Validates bounding box dimensions against perspective-scaled dynamic bounds."""

    def __init__(
        self,
        base_min_area: int = 150,      # Minimum pixel area for distant defect near horizon
        base_max_area: int = 80000,    # Maximum pixel area for near defect close to hood
        horizon_ratio: float = 0.45,   # Horizon vertical position (~45% from top)
        min_aspect_ratio: float = 0.15,# Reject impossibly thin horizontal slivers
        max_aspect_ratio: float = 6.5, # Reject vertical lines (e.g. pole artifacts)
    ) -> None:
        self.base_min_area = base_min_area
        self.base_max_area = base_max_area
        self.horizon_ratio = horizon_ratio
        self.min_aspect_ratio = min_aspect_ratio
        self.max_aspect_ratio = max_aspect_ratio

    def get_dynamic_thresholds(
        self, y_bottom: int, frame_height: int
    ) -> Tuple[int, int]:
        """Compute [min_area, max_area] for a defect positioned at y_bottom."""
        horizon_y = frame_height * self.horizon_ratio
        effective_height = max(1.0, frame_height - horizon_y)
        normalized_distance = max(0.0, min(1.0, (y_bottom - horizon_y) / effective_height))

        # Quadratic perspective scaling: Area scales with distance^2 in perspective projection
        scale = max(0.2, normalized_distance ** 2)

        min_area = int(self.base_min_area * scale)
        max_area = int(self.base_max_area * scale)
        return max(50, min_area), max(500, max_area)

    def validate(
        self, bbox: Tuple[int, int, int, int], frame_height: int, frame_width: int
    ) -> Tuple[bool, str]:
        """Validate bounding box area and aspect ratio.

        Returns (is_valid, rejection_reason).
        """
        x1, y1, x2, y2 = bbox
        w = max(0, x2 - x1)
        h = max(0, y2 - y1)
        area = w * h

        if w <= 0 or h <= 0 or area <= 0:
            return False, "ZERO_AREA"

        # Aspect ratio check (width / height)
        aspect_ratio = w / h
        if aspect_ratio < self.min_aspect_ratio:
            return False, f"ASPECT_RATIO_TOO_NARROW ({aspect_ratio:.2f} < {self.min_aspect_ratio})"
        if aspect_ratio > self.max_aspect_ratio:
            return False, f"ASPECT_RATIO_TOO_WIDE ({aspect_ratio:.2f} > {self.max_aspect_ratio})"

        # Dynamic perspective area check based on bottom coordinate y2
        min_allowed, max_allowed = self.get_dynamic_thresholds(y2, frame_height)

        if area < min_allowed:
            return False, f"AREA_BELOW_MIN ({area} < {min_allowed} at y={y2})"
        if area > max_allowed:
            return False, f"AREA_ABOVE_MAX ({area} > {max_allowed} at y={y2})"

        return True, "VALID"
