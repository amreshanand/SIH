from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from edge.detection.vehicle_detector import Detection


def _compute_iou(box_a: tuple[int, int, int, int], box_b: tuple[int, int, int, int]) -> float:
    x1 = max(box_a[0], box_b[0])
    y1 = max(box_a[1], box_b[1])
    x2 = min(box_a[2], box_b[2])
    y2 = min(box_a[3], box_b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    area_a = (box_a[2] - box_a[0]) * (box_a[3] - box_a[1])
    area_b = (box_b[2] - box_b[0]) * (box_b[3] - box_b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


@dataclass
class TrackState:
    track_id: int
    class_name: str
    last_bbox: tuple[int, int, int, int]
    first_seen: float
    last_seen: float
    frame_count: int = 1
    trajectory: list[tuple[int, int]] = field(default_factory=list)

    @property
    def center(self) -> tuple[int, int]:
        return (
            (self.last_bbox[0] + self.last_bbox[2]) // 2,
            (self.last_bbox[1] + self.last_bbox[3]) // 2,
        )

    @property
    def estimated_speed(self) -> float:
        if len(self.trajectory) < 2:
            return 0.0
        dx = self.trajectory[-1][0] - self.trajectory[-2][0]
        dy = self.trajectory[-1][1] - self.trajectory[-2][1]
        return (dx ** 2 + dy ** 2) ** 0.5

    @property
    def direction(self) -> float:
        if len(self.trajectory) < 2:
            return 0.0
        dx = self.trajectory[-1][0] - self.trajectory[-2][0]
        import math
        return math.degrees(math.atan2(dy := self.trajectory[-1][1] - self.trajectory[-2][1], dx))


class MockTracker:
    """IoU-based tracker for mock mode. Assigns persistent IDs."""

    def __init__(self, iou_threshold: float = 0.3, max_lost: int = 5) -> None:
        self._next_id = 1
        self._tracks: dict[int, TrackState] = {}
        self._lost: dict[int, tuple[TrackState, int]] = {}
        self._iou_threshold = iou_threshold
        self._max_lost = max_lost

    def update(self, detections: list[Detection], frame: np.ndarray) -> list[Detection]:
        import time
        now = time.time()

        if not detections:
            to_remove = []
            for tid, (_, lost_count) in list(self._lost.items()):
                if lost_count >= self._max_lost:
                    to_remove.append(tid)
            for tid in to_remove:
                del self._lost[tid]
            for tid in list(self._tracks):
                self._lost[tid] = (self._tracks[tid], 0)
                del self._tracks[tid]
            for tid, (state, count) in list(self._lost.items()):
                self._lost[tid] = (state, count + 1)
            return []

        matched: dict[int, Detection] = {}
        used_dets: set[int] = set()
        existing_tids = set(self._tracks.keys())

        for tid in list(self._tracks.keys()):
            track = self._tracks[tid]
            best_iou = 0.0
            best_det_idx = -1
            for i, det in enumerate(detections):
                if i in used_dets:
                    continue
                iou = _compute_iou(track.last_bbox, det.bbox)
                if iou > best_iou:
                    best_iou = iou
                    best_det_idx = i
            if best_iou >= self._iou_threshold and best_det_idx >= 0:
                matched[tid] = detections[best_det_idx]
                used_dets.add(best_det_idx)

        for tid, det in matched.items():
            track = self._tracks[tid]
            track.last_bbox = det.bbox
            track.last_seen = now
            track.frame_count += 1
            track.trajectory.append(track.center)
            det.track_id = tid
            det.metadata["track_id"] = tid

        # Move pre-existing tracks that were NOT matched this frame to lost.
        for tid in existing_tids:
            if tid not in matched:
                self._lost[tid] = (self._tracks[tid], 0)
                del self._tracks[tid]

        # Create new tracks for detections that matched no existing track.
        for i, det in enumerate(detections):
            if i not in used_dets:
                tid = self._next_id
                self._next_id += 1
                self._tracks[tid] = TrackState(
                    track_id=tid,
                    class_name=det.class_name,
                    last_bbox=det.bbox,
                    first_seen=now,
                    last_seen=now,
                    trajectory=[det.center if hasattr(det, 'center') else (
                        (det.bbox[0] + det.bbox[2]) // 2,
                        (det.bbox[1] + det.bbox[3]) // 2,
                    )],
                )
                det.track_id = tid
                det.metadata["track_id"] = tid

        to_remove = []
        for tid, (_, lost_count) in list(self._lost.items()):
            if lost_count >= self._max_lost:
                to_remove.append(tid)
        for tid in to_remove:
            del self._lost[tid]
        for tid, (state, count) in list(self._lost.items()):
            self._lost[tid] = (state, count + 1)

        return detections


class ByteTrackTracker:
    """Real ByteTrack integration for production mode."""

    def __init__(self, iou_threshold: float = 0.3) -> None:
        self._tracker = None
        self._iou_threshold = iou_threshold
        self._track_map: dict[int, TrackState] = {}
        self._next_id = 1

    def update(self, detections: list[Detection], frame: np.ndarray) -> list[Detection]:
        import time
        now = time.time()

        if self._tracker is None:
            try:
                from byte_tracker import BYTETracker
                self._tracker = BYTETracker(
                    track_thresh=0.5,
                    high_thresh=0.6,
                    match_thresh=0.8,
                    frame_rate=30,
                )
            except ImportError:
                from edge.utils.logger import log
                log.warning("[TRACK] ByteTrack not available — falling back to IoU tracker")
                fallback = MockTracker(self._iou_threshold)
                self.update = fallback.update
                return fallback.update(detections, frame)

        if not detections:
            return detections

        dets_array = []
        for det in detections:
            x1, y1, x2, y2 = det.bbox
            dets_array.append([x1, y1, x2, y2, det.confidence])

        dets_np = np.array(dets_array, dtype=np.float32) if dets_array else np.empty((0, 5), dtype=np.float32)
        tracks = self._tracker.update(dets_np, [], [frame])

        # ByteTrack does NOT guarantee that track output order matches the input
        # detection order, so match each track to the highest-IoU detection.
        unmatched = list(range(len(detections)))
        for track in tracks:
            tid = int(track.track_id)
            best_idx = -1
            best_iou = self._iou_threshold
            (lx1, ly1, lx2, ly2) = (float(track.tlwh[0]), float(track.tlwh[1]),
                                    float(track.tlwh[0] + track.tlwh[2]), float(track.tlwh[1] + track.tlwh[3]))
            for i in unmatched:
                d = detections[i]
                iou = _compute_iou(d.bbox, (int(lx1), int(ly1), int(lx2), int(ly2)))
                if iou > best_iou:
                    best_iou = iou
                    best_idx = i
            if best_idx >= 0:
                det = detections[best_idx]
                det.track_id = tid
                det.metadata["track_id"] = tid
                unmatched.remove(best_idx)

                if tid not in self._track_map:
                    self._track_map[tid] = TrackState(
                        track_id=tid,
                        class_name=det.class_name,
                        last_bbox=det.bbox,
                        first_seen=now,
                        last_seen=now,
                        trajectory=[det.center],
                    )
                else:
                    t = self._track_map[tid]
                    t.last_bbox = det.bbox
                    t.last_seen = now
                    t.frame_count += 1
                    t.trajectory.append(det.center)

        return detections
