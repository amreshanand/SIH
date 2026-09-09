"""Attribution tests for the Edge AI real-inference pipeline.

These tests exercise the modules that do NOT require the heavy ML stack
(torch / ultralytics / bytetrack), so they run in any environment with
numpy + opencv.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import numpy as np
import pytest

from edge.inference.result import InferenceResult
from edge.tracking.bytetrack_engine import ByteTrackEngine, _iou
from edge.events.engine import EventEngine
from edge.gps.base import GPSData
from edge.gps.nmea_gps import NMEAGPSProvider, _parse_ndeg


def _det(name, bbox, conf=0.9):
    return InferenceResult(class_name=name, confidence=conf, bbox=bbox)


def test_iou():
    a = (0, 0, 10, 10)
    b = (5, 0, 15, 10)
    assert _iou(a, a) == 1.0
    assert _iou(a, (100, 100, 110, 110)) == 0.0
    assert 0.0 < _iou(a, b) < 1.0


def test_tracker_persists_ids_across_frames():
    tracker = ByteTrackEngine(iou_threshold=0.3, max_lost_frames=10)
    frame = np.zeros((100, 100, 3), dtype=np.uint8)

    # Frame 1 — two cars.
    d1 = _det("car", (10, 10, 50, 60))
    d2 = _det("car", (60, 10, 100, 60))
    out1 = tracker.process([d1, d2], frame)
    ids1 = {d.track_id for d in out1}
    assert len(ids1) == 2
    assert all(i is not None for i in ids1)

    # Frame 2 — same objects slightly moved.
    d1b = _det("car", (12, 10, 52, 60))
    d2b = _det("car", (62, 10, 102, 60))
    out2 = tracker.process([d1b, d2b], frame)
    ids2 = {d.track_id for d in out2}
    # IDs should be stable.
    assert ids2 == ids1


def test_tracker_new_object_gets_new_id():
    tracker = ByteTrackEngine(iou_threshold=0.3, max_lost_frames=10)
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    d1 = _det("car", (10, 10, 50, 60))
    first_id = tracker.process([d1], frame)[0].track_id
    d2 = _det("car", (10, 80, 50, 99))  # far away — new object
    out = tracker.process([d1, d2], frame)
    ids = {d.track_id for d in out}
    assert first_id in ids
    assert len(ids) == 2


def test_tracker_drops_lost_object():
    tracker = ByteTrackEngine(iou_threshold=0.3, max_lost_frames=2)
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    d1 = _det("car", (10, 10, 50, 60))
    tracker.process([d1], frame)
    tracker.process([], frame)  # lost frame 1
    tracker.process([], frame)  # lost frame 2 -> pruned
    tracker.process([], frame)
    assert len(tracker.active_tracks) == 0


def test_event_engine_temporal_confirmation():
    eng = EventEngine(
        bus_id="BUS-001", camera_id="FRONT",
        min_confidence=0.5, temporal_window=5.0, min_observations=2,
    )
    gps = GPSData(latitude=18.52, longitude=73.85, source="SIMULATED")
    # First observation -> not enough.
    assert eng.process_detection(_det("pothole", (10, 10, 30, 30)), gps) is None
    # Same class repeated -> confirmed.
    event = eng.process_detection(_det("pothole", (12, 10, 32, 30)), gps)
    assert event is not None
    assert event.event_type == "POTHOLE"
    assert event.severity == "HIGH"
    assert event.metadata["track_id"] is None


def test_event_engine_low_confidence_ignored():
    eng = EventEngine(bus_id="B", camera_id="FRONT", min_confidence=0.6,
                      temporal_window=5.0, min_observations=1)
    assert eng.process_detection(_det("crack", (0, 0, 5, 5), conf=0.3), None) is None


def test_parse_ndeg():
    assert _parse_ndeg("1825.0000") == pytest.approx(18.4166666, abs=1e-4)
    assert _parse_ndeg("bad") is None


def _feed_line(provider, line):
    provider._feed_line(line)


def test_nmea_gga_fix():
    p = NMEAGPSProvider(host="127.0.0.1", port=1)  # no real connect
    _feed_line(p, "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47")
    fix = p.get_location()
    assert fix is not None
    assert fix.source == "NMEA"
    assert fix.latitude == pytest.approx(48.1173, abs=1e-3)
    assert fix.longitude == pytest.approx(11.5167, abs=1e-3)


def test_nmea_gga_no_fix():
    p = NMEAGPSProvider(host="127.0.0.1", port=1)
    _feed_line(p, "$GPGGA,123519,4807.038,N,01131.000,E,0,,,,,,,*55")
    assert p.get_location() is None
