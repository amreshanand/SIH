"""Unit tests for Work-stream 1 edge hardening.

Covers:
* Phase 1: road-damage 9-class taxonomy normalization.
* Phase 2/3: CameraFactory source mapping (no network I/O).
* Phase 4: ByteTrack track_age + cumulative vehicle/pedestrian counts.
* Phase 5: GPS GPSData signal quality + RouteHistory.
* Phase 6: EvidenceCapture WebP thumbnail + archive.
* Phase 7: EventEngine cross-bus severity boost.

These tests are hermetic — none of them open a camera, a socket, or a CPU/GPU
model, so they run anywhere.
"""

from __future__ import annotations

import time

import numpy as np
import pytest


# ---------------------------------------------------------------- Phase 1
def test_road_damage_taxonomy_canonical_classes():
    from edge.detection.classes import ROAD_DAMAGE_CLASSES, normalize_road_damage_class

    expected = {
        "pothole",
        "longitudinal_crack",
        "transverse_crack",
        "alligator_crack",
        "edge_break",
        "rutting",
        "surface_wear",
        "patch_failure",
        "utility_cover_damage",
    }
    assert set(ROAD_DAMAGE_CLASSES) == expected


def test_road_damage_alias_normalization():
    from edge.detection.classes import normalize_road_damage_class

    assert normalize_road_damage_class("Pothole") == "pothole"
    assert normalize_road_damage_class("longitudinal") == "longitudinal_crack"
    assert normalize_road_damage_class("surface_failure") == "surface_wear"
    assert normalize_road_damage_class("manhole") == "utility_cover_damage"
    assert normalize_road_damage_class("patch") == "patch_failure"
    assert normalize_road_damage_class("D40") == "pothole"
    assert normalize_road_damage_class("D40_Pothole_Rutting") == "pothole"
    assert normalize_road_damage_class("D00") == "longitudinal_crack"
    assert normalize_road_damage_class("D10") == "transverse_crack"
    assert normalize_road_damage_class("D20") == "alligator_crack"


def test_road_damage_non_defect_class_is_rejected():
    from edge.detection.classes import normalize_road_damage_class

    # Stray vehicle / COCO classes must not be interpreted as road damage.
    assert normalize_road_damage_class("car") is None
    assert normalize_road_damage_class("person") is None
    assert normalize_road_damage_class("") is None


def test_road_damage_detector_filters_non_defects():
    from edge.inference.result import InferenceResult
    from edge.inference.yoloframe import RoadDamageDetector

    dets = [
        InferenceResult(class_name="car", confidence=0.9, bbox=(0, 0, 10, 10)),
        InferenceResult(class_name="pothole", confidence=0.9, bbox=(0, 0, 50, 50)),
        InferenceResult(class_name="alligator_crack", confidence=0.8, bbox=(0, 0, 20, 20)),
    ]
    filtered = RoadDamageDetector._normalize(dets)
    names = [d.class_name for d in filtered]
    assert "pothole" in names
    assert "alligator_crack" in names
    assert "car" not in names


# ---------------------------------------------------------------- Phase 2/3
def test_camera_factory_rtsp_and_off():
    from edge.camera.factory import CameraFactory, CameraFactoryError, CameraSpec

    rtsp = CameraFactory.create(
        CameraSpec(position="FRONT", source_type="rtsp", url="rtsp://127.0.0.1/1")
    )
    # Constructor only — no network open performed.
    assert rtsp.source_type == "rtsp"

    disabled = CameraFactory.create(
        CameraSpec(position="REAR", source_type="off")
    )
    assert disabled is None

    with pytest.raises(CameraFactoryError):
        CameraFactory.create(CameraSpec(position="FRONT", source_type="rtsp", url=""))


def test_camera_factory_unknown_source_raises():
    from edge.camera.factory import CameraFactory, CameraFactoryError, CameraSpec

    with pytest.raises(CameraFactoryError):
        CameraFactory.create(
            CameraSpec(position="FRONT", source_type="not_a_source", url="x")
        )


# ---------------------------------------------------------------- Phase 4
def test_tracker_cumulative_counts_and_track_age():
    from edge.inference.result import InferenceResult
    from edge.tracking.bytetrack_engine import ByteTrackEngine

    tracker = ByteTrackEngine()
    f1 = InferenceResult(class_name="car", confidence=0.9, bbox=(0, 0, 50, 50))
    f2 = InferenceResult(class_name="person", confidence=0.9, bbox=(100, 100, 150, 150))
    tracker.process([f1, f2])
    # Two distinct objects counted.
    assert tracker.cumulative_counts == {"car": 1, "person": 1}

    # Same physical objects again — no double count.
    tracker.process([f1, f2])
    assert tracker.cumulative_counts == {"car": 1, "person": 1}

    # A new object gets counted.
    f3 = InferenceResult(class_name="bus", confidence=0.9, bbox=(200, 200, 260, 260))
    tracker.process([f1, f2, f3])
    assert tracker.cumulative_counts["bus"] == 1

    # track_age is exposed on the Track snapshot.
    tracks = tracker.active_tracks
    assert tracks
    snap = next(iter(tracks.values())).snapshot()
    assert "track_age" in snap
    assert snap["track_age"] >= 0
    assert "trajectory" in snap


# ---------------------------------------------------------------- Phase 5
def test_gps_signal_quality():
    from edge.gps.base import GPSData

    good = GPSData(latitude=18.0, longitude=73.0, hdop=1.0, satellites=9, fixed=True)
    assert good.signal_quality == "EXCELLENT"
    assert good.has_fix is True

    no_fix = GPSData(latitude=18.0, longitude=73.0, fixed=False)
    assert no_fix.signal_quality == "NO_FIX"
    assert no_fix.has_fix is False


def test_route_history_records_and_prunes():
    from edge.gps.base import GPSData
    from edge.gps.route_history import RouteHistory

    rh = RouteHistory(max_points=3)
    for i in range(6):
        rh.record(GPSData(latitude=18.0 + i * 0.001, longitude=73.0, fixed=True, source="NMEA"))
    recent = rh.recent(limit=10)
    assert len(recent) <= 3
    # Last recorded fix is retained.
    assert recent[-1]["latitude"] > 18.0 + 0.004
    lp = rh.last_position()
    assert lp is not None


def test_nmea_accurate_fix_parse():
    from edge.gps.nmea_gps import NMEAGPSProvider

    provider = NMEAGPSProvider()
    # 1845.0 N, 07300.0 E — valid fix.
    fix = provider._parse_gga("$GPGGA,123519,1845.0,N,07300.0,E,1,08,1.5,100.0,M,,,,")
    assert fix is not None
    assert fix.satellites == 8
    assert fix.hdop == 1.5
    assert fix.accuracy == pytest.approx(4.5)
    assert fix.fixed is True


def test_nmea_no_fix_returns_none():
    from edge.gps.nmea_gps import NMEAGPSProvider

    provider = NMEAGPSProvider()
    fix = provider._parse_gga("$GPGGA,123519,1845.0,N,07300.0,E,0,00,0.0,")
    assert fix is None


# ---------------------------------------------------------------- Phase 6
def test_evidence_writes_webp_thumbnail(tmp_path):
    from edge.evidence.capture import EvidenceCapture

    cap = EvidenceCapture(str(tmp_path), max_width=640, thumbnail_width=160)
    frame = np.zeros((240, 320, 3), dtype=np.uint8)
    path = cap.capture(
        frame,
        event_id="EVT-TEST-1",
        event_type="POTHOLE",
        confidence=0.9,
        bus_id="BUS-001",
        camera_id="FRONT",
        latitude=18.5,
        longitude=73.8,
    )
    # JPEG written.
    assert (tmp_path / "EVT-TEST-1.jpg").exists()
    assert path.endswith(".jpg")
    # WebP thumbnail written.
    webp = tmp_path / "EVT-TEST-1.webp"
    assert webp.exists()
    assert webp.stat().st_size > 0


def test_evidence_archive_old_files(tmp_path):
    from edge.evidence.capture import EvidenceCapture

    cap = EvidenceCapture(str(tmp_path), archive_dir=str(tmp_path / "archive"))
    (tmp_path / "old.jpg").write_bytes(b"x")
    # Pretend the file is very old.
    old = time.time() - 60 * 60 * 24 * 40
    import os

    os.utime(tmp_path / "old.jpg", (old, old))
    moved = cap.archive_old(retention_days=30)
    assert moved == 1
    assert (tmp_path / "archive" / "old.jpg").exists()
    assert not (tmp_path / "old.jpg").exists()


# ---------------------------------------------------------------- Phase 7
def test_cross_bus_severity_boost():
    from edge.events.engine import EventEngine

    engine = EventEngine("BUS-1", "FRONT", min_observations=2, temporal_window=30)
    # A LOW base class (surface_wear) boosted by cross-bus confirmation only.
    class _D:
        class_name = "surface_wear"
        confidence = 0.7
        bbox = (0, 0, 10, 10)
        @property
        def area(self):
            return 100
        @property
        def track_id(self):
            return None
        @property
        def source_model(self):
            return "m"

    s0 = engine.score_severity("surface_wear", 0.7, 0.01, 2, bus_count=1)
    s3 = engine.score_severity("surface_wear", 0.7, 0.01, 2, bus_count=3)
    assert engine.SEVERITY_ORDER[s3] > engine.SEVERITY_ORDER[s0]

    def make_obs(cls):
        d = _D()
        d.class_name = cls
        return d

    # Two buses confirm a pothole -> stays at least HIGH, never down.
    sev = engine.score_severity("pothole", 0.85, 0.02, 2, bus_count=2, existing_severity="HIGH")
    assert engine.SEVERITY_ORDER[sev] >= engine.SEVERITY_ORDER["HIGH"]
