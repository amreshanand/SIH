from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class Track:
    """A persistent object identity tracked across frames."""

    track_id: int
    class_name: str
    last_bbox: tuple[int, int, int, int]
    first_seen: float
    last_seen: float
    frame_count: int = 1
    trajectory: list[tuple[int, int]] = field(default_factory=list)
    lost: int = 0

    @property
    def center(self) -> tuple[int, int]:
        return (
            (self.last_bbox[0] + self.last_bbox[2]) // 2,
            (self.last_bbox[1] + self.last_bbox[3]) // 2,
        )

    @property
    def age_seconds(self) -> float:
        """How long this track has existed (seconds)."""
        import time

        return max(0.0, (self.last_seen or time.time()) - (self.first_seen or self.last_seen))

    @property
    def age_frames(self) -> int:
        """How many frames this track has been associated (total seen)."""
        return max(1, self.frame_count)

    def snapshot(self) -> dict:
        """Serializable track summary (for evidence + backend ingestion)."""
        return {
            "track_id": self.track_id,
            "class_name": self.class_name,
            "track_age": round(self.age_seconds, 2),
            "frame_count": self.frame_count,
            "trajectory": list(self.trajectory[-50:]),
            "last_seen": self.last_seen,
            "first_seen": self.first_seen,
            "lost": self.lost,
        }


def _iou(
    a: tuple[int, int, int, int], b: tuple[int, int, int, int]
) -> float:
    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[2], b[2])
    y2 = min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


class ByteTrackEngine:
    """Multi-object tracking backed by ByteTrack with a pure-IoU fallback.

    Responsibilities:
    * Persist track IDs across frames (stable identity for dedup and evidence).
    * Match new detections to existing tracks by IoU, then re-assign the
      ByteTrack id so an object that leaves and re-enters keeps identity.
    * Remove tracks that have been lost for ``max_lost_frames`` consecutive
      frames.

    If the optional ``bytetrack`` package is present it is used for the
    matching; otherwise an IoU matcher is used. Both produce the same stable
    persistent IDs, so downstream code never depends on which engine matched.
    """

    def __init__(
        self,
        iou_threshold: float = 0.3,
        max_lost_frames: int = 10,
    ) -> None:
        self._iou_threshold = iou_threshold
        self._max_lost = max_lost_frames
        self._tracks: dict[int, Track] = {}
        self._next_id = 1
        self._bytetrack = None
        self._bytetrack_failed = False
        # Cumulative count of distinct objects seen since start, keyed by class.
        # A distinct object is counted once when its track is first spawned.
        self._cumulative: dict[str, int] = {}

    @property
    def active_tracks(self) -> dict[int, Track]:
        return dict(self._tracks)

    @property
    def cumulative_counts(self) -> dict[str, int]:
        """Cumulative objects seen per class (vehicles + pedestrians)."""
        import copy

        return copy.deepcopy(self._cumulative)

    def _count_class(self, class_name: str) -> None:
        """Increment the cumulative count for a newly spawned object class."""
        self._cumulative[class_name] = self._cumulative.get(class_name, 0) + 1

    def _init_bytetrack(self) -> None:
        try:
            from byte_tracker import BYTETracker

            self._bytetrack = BYTETracker(
                track_thresh=0.5,
                high_thresh=0.6,
                match_thresh=0.8,
                frame_rate=30,
            )
        except Exception:  # noqa: BLE001
            from edge.utils.logger import log

            log.warning(
                "[TRACK] ByteTrack not available — using IoU matcher (IDs still persist)"
            )
            self._bytetrack_failed = True

    def update(self, frames: np.ndarray | None = None) -> None:
        """Called each frame so ByteTrack can advance its internal state even
        when there are no detections (keeps its buffer fresh)."""
        if (
            self._bytetrack is not None
            and not self._bytetrack_failed
            and frames is not None
        ):
            try:
                self._bytetrack.update(
                    np.empty((0, 5), dtype=np.float32), [], [frames]
                )
            except Exception:  # noqa: BLE001
                self._bytetrack_failed = True

    def _match_to_existing(
        self, detections: list
    ) -> list[tuple] :
        """Match detections to existing persistent tracks by best IoU.

        Returns list of (track_id, detection) for matched pairs in order.
        Mutates each detection's track_id.
        """
        import time

        now = time.time()
        matched: list[tuple[int, object]] = []
        used_dets: set[int] = set()

        for tid in list(self._tracks.keys()):
            track = self._tracks[tid]
            best_iou = 0.0
            best_idx = -1
            for i, det in enumerate(detections):
                if i in used_dets:
                    continue
                iou = _iou(track.last_bbox, det.bbox)
                if iou > best_iou:
                    best_iou = iou
                    best_idx = i
            if best_idx >= 0 and best_iou >= self._iou_threshold:
                det = detections[best_idx]
                det.track_id = tid
                used_dets.add(best_idx)
                track.last_bbox = det.bbox
                track.last_seen = now
                track.frame_count += 1
                track.lost = 0
                track.trajectory.append(track.center)
                matched.append((tid, det))

        return matched

    def _spawn_new(self, detections: list, used_idx: set[int]) -> None:
        import time

        now = time.time()
        for i, det in enumerate(detections):
            if i in used_idx:
                continue
            tid = self._next_id
            self._next_id += 1
            det.track_id = tid
            self._tracks[tid] = Track(
                track_id=tid,
                class_name=det.class_name,
                last_bbox=det.bbox,
                first_seen=now,
                last_seen=now,
                trajectory=[det.center],
            )
            self._count_class(det.class_name)

    def _prune_lost(self) -> None:
        to_remove = []
        for tid, track in self._tracks.items():
            track.lost += 0  # lost increment handled per-frame below
        # For tracks not seen this frame, increment lost counter.
        # We track "seen this update" via a per-call set.
        for tid, track in self._tracks.items():
            if track.lost >= self._max_lost:
                to_remove.append(tid)
        for tid in to_remove:
            del self._tracks[tid]

    def process(
        self, detections: list, frames: np.ndarray | None = None
    ) -> list:
        """Associate detections with persistent track IDs in place.

        Arguments:
            detections: detections (InferenceResult) from the current frame.
            frames: the current frame (for ByteTrack's internal buffer).

        Returns the same detections list with track_id populated.
        """
        import time

        try:
            # Optionally feed ByteTrack the detections for its internal matching.
            if (
                self._bytetrack_ready()
                and detections
                and frames is not None
            ):
                dets_array = []
                for det in detections:
                    x1, y1, x2, y2 = det.bbox
                    dets_array.append([x1, y1, x2, y2, det.confidence])
                dets_np = (
                    np.array(dets_array, dtype=np.float32)
                    if dets_array
                    else np.empty((0, 5), dtype=np.float32)
                )
                try:
                    bt_tracks = self._bytetrack_handle().update(
                        dets_np, [], [frames]
                    )
                    self._absorb_bytetrack(bt_tracks, detections)
                    return detections
                except Exception:  # noqa: BLE001
                    self._bytetrack_failed = True

            # IoU matcher path.
            matched = self._match_to_existing(detections)
            matched_ids = {tid for tid, _ in matched}
            matched_idx: set[int] = set()
            for tid, det in matched:
                matched_idx.add(id(det))
            # Convert memory-ids to indices for _spawn_new.
            used_idx: set[int] = set()
            for i, det in enumerate(detections):
                if id(det) in matched_idx:
                    used_idx.add(i)
            # Mark tracks not matched this frame as lost.
            for tid, track in self._tracks.items():
                if tid not in matched_ids:
                    track.lost += 1
            self._spawn_new(detections, used_idx)
            self._prune_lost()
            return detections
        except Exception:  # noqa: BLE001
            # Never let a tracking failure crash the pipeline.
            return detections

    def _idx_set(self, detections, used: set) -> set:
        # Convert used memory ids to indices.
        idx_used = set()
        for i, det in enumerate(detections):
            if id(det) in used:
                idx_used.add(i)
        return idx_used

    def _bytetrack_ready(self) -> bool:
        if self._bytetrack is not None:
            return not self._bytetrack_failed
        if self._bytetrack_failed:
            return False
        self._init_bytetrack()
        return self._bytetrack is not None and not self._bytetrack_failed

    def _bytetrack_handle(self):
        return self._bytetrack

    def _absorb_bytetrack(self, bt_tracks, detections) -> None:
        """Merge ByteTrack outputs into persistent identity tracks.

        ByteTrack assigns its own ids; we map each ByteTrack bbox to the
        highest-IoU detection and persist that as the stable track_id.
        """
        import time

        now = time.time()
        used_dets: set[int] = set()
        bt_map: dict[int, int] = {}  # bytetrack_id -> our track_id
        for bt in bt_tracks:
            try:
                lx1, ly1, lx2, ly2 = (
                    float(bt.tlwh[0]),
                    float(bt.tlwh[1]),
                    float(bt.tlwh[0] + bt.tlwh[2]),
                    float(bt.tlwh[1] + bt.tlwh[3]),
                )
            except Exception:  # noqa: BLE001
                continue
            bt_box = (int(lx1), int(ly1), int(lx2), int(ly2))
            best_iou = self._iou_threshold
            best_idx = -1
            for i, det in enumerate(detections):
                if i in used_dets:
                    continue
                iou = _iou(det.bbox, bt_box)
                if iou > best_iou:
                    best_iou = iou
                    best_idx = i
            if best_idx < 0:
                continue
            det = detections[best_idx]
            used_dets.add(best_idx)
            bt_id = int(bt.track_id)
            if bt_id in bt_map:
                tid = bt_map[bt_id]
            else:
                tid = self._next_id
                self._next_id += 1
                bt_map[bt_id] = tid
            det.track_id = tid
            if tid in self._tracks:
                t = self._tracks[tid]
                t.last_bbox = det.bbox
                t.last_seen = now
                t.frame_count += 1
                t.lost = 0
                t.trajectory.append(t.center)
            else:
                self._tracks[tid] = Track(
                    track_id=tid,
                    class_name=det.class_name,
                    last_bbox=det.bbox,
                    first_seen=now,
                    last_seen=now,
                    trajectory=[det.center],
                )
                self._count_class(det.class_name)
        # Tracks with no match this frame increment lost.
        seen_tids = {det.track_id for det in detections if det.track_id is not None}
        for tid, t in self._tracks.items():
            if tid not in seen_tids:
                t.lost += 1
        self._prune_lost()
