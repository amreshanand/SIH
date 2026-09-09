"""Confidence Fusion Engine for UrbanSense AI.

Calculates a multi-modal fused confidence score S in [0, 100] by combining
deep visual features, temporal tracking stability, geometric road masking,
sensor kinematics (GPS), and prior spatial defect history.

Weights Formula:
    YOLO_CONFIDENCE          = 40% (0.40)
    TRACK_STABILITY          = 20% (0.20)
    TEMPORAL_PERSISTENCE     = 15% (0.15)
    ROAD_MASK_CONFIDENCE     = 10% (0.10)
    GPS_CONFIDENCE           =  5% (0.05)
    HISTORICAL_CONFIRMATION  = 10% (0.10)

Score Thresholds:
    0 - 59:   REJECT (drop detection; false positive / artifact)
    60 - 79:  HUMAN REVIEW (probe/candidate; not routed as municipal work order)
    80 - 100: CONFIRMED ISSUE (admitted into municipal workflow)
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, Optional, Tuple


@dataclass
class FusionFactors:
    """Inputs to the multi-modal confidence fusion calculation."""

    yolo_confidence: float               # Raw YOLO detection confidence [0.0, 1.0]
    track_age_frames: int                # Number of frames track has existed
    consecutive_frames: int              # Number of consecutive frames observed
    road_mask_overlap: float             # Overlap ratio with drivable road mask [0.0, 1.0]
    gps_speed_kmh: Optional[float] = None# Current vehicle GPS speed in km/h
    gps_accuracy_m: Optional[float] = None# GPS positioning accuracy in meters
    historical_observations: int = 0     # Prior observations within this spatial cluster


class ConfidenceFusionEngine:
    """Weighted multi-modal scoring engine with configurable thresholds."""

    DEFAULT_WEIGHTS = {
        "yolo": 0.40,
        "track_stability": 0.20,
        "temporal_persistence": 0.15,
        "road_mask": 0.10,
        "gps": 0.05,
        "historical": 0.10,
    }

    def __init__(
        self,
        weights: Optional[Dict[str, float]] = None,
        reject_threshold: float = 60.0,
        review_threshold: float = 80.0,
    ) -> None:
        self.weights = dict(weights or self.DEFAULT_WEIGHTS)
        # Normalize weights to sum to 1.0
        total_w = sum(self.weights.values())
        if total_w > 0:
            for k in self.weights:
                self.weights[k] /= total_w

        self.reject_threshold = reject_threshold
        self.review_threshold = review_threshold

    def calculate_fused_score(self, factors: FusionFactors) -> float:
        """Calculate weighted score on 0 to 100 scale."""
        # 1. YOLO Confidence [0.0, 1.0]
        c_yolo = max(0.0, min(1.0, factors.yolo_confidence))

        # 2. Track Stability [0.0, 1.0] (Saturates at 30 frames)
        c_track = min(1.0, max(0.0, factors.track_age_frames / 30.0))

        # 3. Temporal Persistence [0.0, 1.0] (Saturates at 10 consecutive frames)
        c_temporal = min(1.0, max(0.0, factors.consecutive_frames / 10.0))

        # 4. Road Mask Overlap [0.0, 1.0]
        c_road = max(0.0, min(1.0, factors.road_mask_overlap))

        # 5. GPS Consistency [0.0, 1.0]
        # High confidence when bus is driving normally (8 - 60 km/h) and GPS accuracy < 8m
        c_gps = 1.0
        if factors.gps_speed_kmh is not None:
            spd = factors.gps_speed_kmh
            if spd < 3.0:  # Bus stopped; risk of stationary object shadow confusion
                c_gps *= 0.70
            elif spd > 90.0:  # Improbable highway blur
                c_gps *= 0.60
            else:
                c_gps *= 1.0
        if factors.gps_accuracy_m is not None:
            if factors.gps_accuracy_m > 15.0:
                c_gps *= 0.65
            elif factors.gps_accuracy_m > 8.0:
                c_gps *= 0.85

        # 6. Historical Observations [0.0, 1.0]
        # Asymptotic curve: 0 -> 0.0, 1 -> 0.4, 2 -> 0.65, 3+ -> 0.85 - 1.0
        hist = factors.historical_observations
        c_history = 1.0 - math.exp(-0.5 * hist) if hist > 0 else 0.0

        # Weighted sum on [0.0, 1.0] scale
        raw_score = (
            self.weights["yolo"] * c_yolo
            + self.weights["track_stability"] * c_track
            + self.weights["temporal_persistence"] * c_temporal
            + self.weights["road_mask"] * c_road
            + self.weights["gps"] * c_gps
            + self.weights["historical"] * c_history
        )

        return round(raw_score * 100.0, 2)

    def evaluate(self, factors: FusionFactors) -> Tuple[str, float]:
        """Evaluate factors and return (action, final_score).

        Actions:
            "REJECT": Score < 60.0
            "HUMAN_REVIEW": 60.0 <= Score < 80.0
            "CONFIRMED_ISSUE": Score >= 80.0
        """
        score = self.calculate_fused_score(factors)
        if score < self.reject_threshold:
            return "REJECT", score
        elif score < self.review_threshold:
            return "HUMAN_REVIEW", score
        else:
            return "CONFIRMED_ISSUE", score
