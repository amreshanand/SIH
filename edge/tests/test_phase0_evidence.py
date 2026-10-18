"""Phase 0 — Evidence provenance tests.

Every event emitted by the edge pipeline MUST carry complete provenance
metadata so downstream consumers (dashboard, audit, legal chain-of-custody)
can verify the source of every detection. This file tests:

  • Required top-level provenance fields: bus_id, camera_id, timestamp, source.
  • Required metadata provenance: source_model (model version/path),
    gps_source (GPS origin), track_id.
  • The Event.to_dict() serialisation preserves all fields.
  • EventEngine embeds provenance correctly when emitting events.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest

# Ensure repo root is on sys.path so ``edge.*`` imports resolve.
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT))

from edge.events.engine import Event, EventEngine
from edge.inference.result import InferenceResult
from edge.gps.base import GPSData


# ── Event dataclass provenance ──────────────────────────────────────────────

class TestEventProvenance:
    """Verify that Event objects carry all required provenance fields."""

    @pytest.fixture
    def sample_event(self) -> Event:
        return Event(
            event_id="EVT-TEST-0001",
            event_type="POTHOLE",
            bus_id="BUS-042",
            camera_id="FRONT",
            severity="HIGH",
            confidence=0.87,
            latitude=28.6139,
            longitude=77.2090,
            source="EDGE_AI",
            timestamp=1729250000.0,
            metadata={
                "source_model": "models/road_damage.pt",
                "gps_source": "PHONE",
                "track_id": 7,
                "observations": 3,
            },
        )

    def test_bus_id_present(self, sample_event: Event):
        assert sample_event.bus_id == "BUS-042"

    def test_camera_id_present(self, sample_event: Event):
        assert sample_event.camera_id == "FRONT"

    def test_timestamp_present(self, sample_event: Event):
        assert isinstance(sample_event.timestamp, float)
        assert sample_event.timestamp > 0

    def test_source_type_present(self, sample_event: Event):
        assert sample_event.source == "EDGE_AI"

    def test_model_version_in_metadata(self, sample_event: Event):
        assert "source_model" in sample_event.metadata
        assert sample_event.metadata["source_model"] != ""

    def test_gps_source_in_metadata(self, sample_event: Event):
        assert "gps_source" in sample_event.metadata
        assert sample_event.metadata["gps_source"] != ""


# ── Event.to_dict() serialisation ───────────────────────────────────────────

class TestEventSerialization:
    """to_dict() must preserve every provenance field."""

    @pytest.fixture
    def event_dict(self) -> dict:
        return Event(
            event_id="EVT-SERIAL-0001",
            event_type="ALLIGATOR_CRACK",
            bus_id="BUS-007",
            camera_id="REAR",
            severity="MEDIUM",
            confidence=0.72,
            latitude=19.076,
            longitude=72.8777,
            source="EDGE_AI",
            timestamp=1729250000.0,
            metadata={
                "source_model": "models/road_damage.pt",
                "gps_source": "NMEA",
                "track_id": 12,
            },
        ).to_dict()

    def test_dict_has_bus_id(self, event_dict: dict):
        assert "bus_id" in event_dict
        assert event_dict["bus_id"] == "BUS-007"

    def test_dict_has_camera_id(self, event_dict: dict):
        assert "camera_id" in event_dict
        assert event_dict["camera_id"] == "REAR"

    def test_dict_has_timestamp(self, event_dict: dict):
        assert "timestamp" in event_dict
        assert isinstance(event_dict["timestamp"], float)

    def test_dict_has_source(self, event_dict: dict):
        assert "source" in event_dict
        assert event_dict["source"] == "EDGE_AI"

    def test_dict_has_metadata_with_model(self, event_dict: dict):
        meta = event_dict["metadata_json"]
        assert "source_model" in meta
        assert meta["source_model"] == "models/road_damage.pt"

    def test_dict_has_metadata_with_gps_source(self, event_dict: dict):
        meta = event_dict["metadata_json"]
        assert "gps_source" in meta
        assert meta["gps_source"] == "NMEA"


# ── EventEngine emits provenance-complete events ────────────────────────────

class TestEventEngineProvenance:
    """EventEngine.process_detection() must embed full provenance."""

    @pytest.fixture
    def engine(self) -> EventEngine:
        return EventEngine(
            bus_id="BUS-099",
            camera_id="LEFT",
            min_confidence=0.4,
            temporal_window=10.0,  # wide window so observations accumulate
            min_observations=2,
        )

    @pytest.fixture
    def gps(self) -> GPSData:
        return GPSData(
            latitude=12.9716,
            longitude=77.5946,
            source="PHONE",
        )

    def _make_detection(self, source_model: str = "models/road_damage.pt") -> InferenceResult:
        return InferenceResult(
            class_name="pothole",
            confidence=0.85,
            bbox=(100, 100, 200, 200),
            track_id=5,
            source_model=source_model,
        )

    def test_engine_emits_with_bus_id(self, engine: EventEngine, gps: GPSData):
        det = self._make_detection()
        # Feed min_observations detections to trigger emission
        engine.process_detection(det, gps)
        event = engine.process_detection(det, gps)
        assert event is not None
        assert event.bus_id == "BUS-099"

    def test_engine_emits_with_camera_id(self, engine: EventEngine, gps: GPSData):
        det = self._make_detection()
        engine.process_detection(det, gps)
        event = engine.process_detection(det, gps)
        assert event is not None
        assert event.camera_id == "LEFT"

    def test_engine_emits_with_timestamp(self, engine: EventEngine, gps: GPSData):
        det = self._make_detection()
        engine.process_detection(det, gps)
        event = engine.process_detection(det, gps)
        assert event is not None
        assert event.timestamp > 0

    def test_engine_emits_source_model(self, engine: EventEngine, gps: GPSData):
        det = self._make_detection(source_model="models/custom_v2.pt")
        engine.process_detection(det, gps)
        event = engine.process_detection(det, gps)
        assert event is not None
        assert event.metadata["source_model"] == "models/custom_v2.pt"

    def test_engine_emits_gps_source(self, engine: EventEngine, gps: GPSData):
        det = self._make_detection()
        engine.process_detection(det, gps)
        event = engine.process_detection(det, gps)
        assert event is not None
        assert event.metadata["gps_source"] == "PHONE"

    def test_engine_emits_gps_unknown_when_no_gps(self, engine: EventEngine):
        det = self._make_detection()
        engine.process_detection(det, None)
        event = engine.process_detection(det, None)
        assert event is not None
        assert event.metadata["gps_source"] == "UNKNOWN"
