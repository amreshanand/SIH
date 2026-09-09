"""Temporal Validation Engine for UrbanSense AI.

Enforces physical defect persistence across consecutive video frames to prevent
momentary visual artifacts (camera lens glare, fluttering shadows, dynamic vehicle reflections)
from generating false-positive road defect issues.

Requirements:
    1. An issue candidate is accepted ONLY when the same track_id appears for at least
       MIN_CONSECUTIVE_FRAMES (default: 5) within WINDOW_SECONDS (default: 3.0s).
    2. Track Stability:
       - Reject detections if track_age < 10 frames.
       - Accept as fully stable when track_age >= 15 frames.
    3. If an object drops or disappears before achieving the stability threshold,
       the detection candidate is discarded without emitting an event.
    4. Tracks store first_seen, last_seen, frame_count, consecutive_frames,
       track_id, average_confidence, and trajectory.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from edge.inference.result import InferenceResult
from edge.utils.logger import log


@dataclass
class TemporalCandidate:
    """State record for a temporally tracked road defect candidate."""

    track_id: int
    class_name: str
    first_seen: float
    last_seen: float
    frame_count: int = 1
    consecutive_frames: int = 1
    confidence_history: List[float] = field(default_factory=list)
    road_overlap_history: List[float] = field(default_factory=list)
    trajectory: List[Tuple[int, int]] = field(default_factory=list)
    last_bbox: Tuple[int, int, int, int] = (0, 0, 0, 0)
    source_model: str = "road_damage"
    is_confirmed: bool = False
    first_frame_idx: int = 0
    last_frame_idx: int = 0

    @property
    def average_confidence(self) -> float:
        if not self.confidence_history:
            return 0.0
        return float(sum(self.confidence_history) / len(self.confidence_history))

    @property
    def average_road_overlap(self) -> float:
        if not self.road_overlap_history:
            return 1.0
        return float(sum(self.road_overlap_history) / len(self.road_overlap_history))

    @property
    def track_age_seconds(self) -> float:
        return max(0.0, self.last_seen - self.first_seen)

    @property
    def track_age_frames(self) -> int:
        return max(1, self.last_frame_idx - self.first_frame_idx + 1)


class TemporalValidator:
    """Manages active temporal defect candidates and enforces persistence thresholds."""

    def __init__(
        self,
        min_consecutive_frames: int = 5,
        min_track_age_frames: int = 15,
        window_seconds: float = 3.0,
        purge_timeout_seconds: float = 4.0,
    ) -> None:
        self.min_consecutive_frames = min_consecutive_frames
        self.min_track_age_frames = min_track_age_frames
        self.window_seconds = window_seconds
        self.purge_timeout_seconds = purge_timeout_seconds
        # track_id -> TemporalCandidate
        self._candidates: Dict[int, TemporalCandidate] = {}
        self._current_frame_idx = 0

    def update_frame(
        self,
        detections: List[InferenceResult],
        road_overlap_ratios: Dict[int, float],
        timestamp: Optional[float] = None,
    ) -> List[TemporalCandidate]:
        """Process detections for the current video frame.

        Returns a list of TemporalCandidates that satisfy both consecutive frame
        persistence and track age stability in this frame.
        """
        now = timestamp or time.time()
        self._current_frame_idx += 1
        seen_track_ids = set()
        confirmed_in_frame: List[TemporalCandidate] = []

        for det in detections:
            if det.track_id is None:
                continue

            tid = det.track_id
            seen_track_ids.add(tid)
            overlap = road_overlap_ratios.get(tid, 1.0)

            if tid not in self._candidates:
                # Initialize new candidate
                cand = TemporalCandidate(
                    track_id=tid,
                    class_name=det.class_name,
                    first_seen=now,
                    last_seen=now,
                    frame_count=1,
                    consecutive_frames=1,
                    confidence_history=[det.confidence],
                    road_overlap_history=[overlap],
                    trajectory=[det.center],
                    last_bbox=det.bbox,
                    source_model=det.source_model,
                    first_frame_idx=self._current_frame_idx,
                    last_frame_idx=self._current_frame_idx,
                )
                self._candidates[tid] = cand
            else:
                cand = self._candidates[tid]
                # Check time since last hit
                dt = now - cand.last_seen
                if dt <= 0.35:  # Consistent frame rate gap (e.g. ~10-30fps)
                    cand.consecutive_frames += 1
                else:
                    cand.consecutive_frames = 1  # Reset consecutive streak

                cand.last_seen = now
                cand.frame_count += 1
                cand.last_frame_idx = self._current_frame_idx
                cand.confidence_history.append(det.confidence)
                cand.road_overlap_history.append(overlap)
                cand.trajectory.append(det.center)
                cand.last_bbox = det.bbox

            # Evaluate confirmation gates
            # Gate A: Must appear for >= MIN_CONSECUTIVE_FRAMES within WINDOW_SECONDS
            # Gate B: Track age must be >= MIN_TRACK_AGE_FRAMES
            age_sec = cand.track_age_seconds
            age_frames = cand.track_age_frames

            if (
                cand.consecutive_frames >= self.min_consecutive_frames
                and age_frames >= self.min_track_age_frames
                and age_sec <= self.window_seconds
            ):
                if not cand.is_confirmed:
                    cand.is_confirmed = True
                    confirmed_in_frame.append(cand)
                    log.debug(
                        "Temporal candidate CONFIRMED: track_id=%d class=%s age_frames=%d consecutive=%d avg_conf=%.2f",
                        tid,
                        cand.class_name,
                        age_frames,
                        cand.consecutive_frames,
                        cand.average_confidence,
                    )

        # Cleanup tracks that disappeared before confirmation or exceeded window
        self._purge_stale(now)
        return confirmed_in_frame

    def _purge_stale(self, now: float) -> None:
        """Remove tracks that disappeared before meeting criteria or timed out."""
        expired = []
        for tid, cand in self._candidates.items():
            if (now - cand.last_seen) > self.purge_timeout_seconds:
                expired.append(tid)
        for tid in expired:
            del self._candidates[tid]

    def get_candidate(self, track_id: int) -> Optional[TemporalCandidate]:
        return self._candidates.get(track_id)
