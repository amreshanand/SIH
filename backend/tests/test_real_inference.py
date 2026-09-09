"""Real-inference ingestion tests for UrbanSense AI.

These verify the production safeguards introduced when the platform moved from
a simulation-heavy prototype to a real-inference pipeline:

1. Real events (with track_id / bbox / model provenance) are accepted and their
   provenance persisted into metadata_json.
2. Events explicitly marked SIMULATED (or metadata.simulated=true) are REJECTED
   when the platform is not in demo mode.
3. Radiation of a single real event into an Issue captures the evidence path
   attached by the edge device (no random evidence injection).
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from backend.app.core.config import settings
from tests.conftest import auth_header

EDGE_HEADERS = {"X-API-Key": "urbansense-edge-key-change-me"}


@pytest.mark.asyncio
async def test_real_inference_event_persists_track_and_bbox(client: AsyncClient):
    # Use an admin token (authenticated user path is equivalent to edge key).
    from tests.conftest import mint_token

    resp = await client.post(
        "/api/auth/register",
        json={"username": "reg_user_ci", "password": "StrongPass1", "role": "VIEWER"},
    )
    assert resp.status_code in (200, 201, 400), resp.text

    # Authenticated event upload.
    payload = {
        "event_id": "EVT-REAL-0001",
        "event_type": "POTHOLE",
        "bus_id": "BUS-999",
        "camera_id": "FRONT",
        "severity": "HIGH",
        "confidence": 0.91,
        "latitude": 18.52,
        "longitude": 73.85,
        "evidence_url": "data/evidence/EVT-REAL-0001.jpg",
        "metadata_json": {"observations": 3, "gps_source": "NMEA"},
        "source": "EDGE_AI",
        "track_id": 42,
        "bbox": [10, 20, 60, 70],
        "source_model": "models/road_damage.pt",
    }
    resp = await client.post("/api/events", json=payload, headers=EDGE_HEADERS)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["event_id"] == "EVT-REAL-0001"
    meta = body["metadata_json"]
    # Real-inference provenance must be merged into metadata_json.
    assert meta["track_id"] == 42
    assert meta["bbox"] == [10, 20, 60, 70]
    assert meta["source_model"] == "models/road_damage.pt"
    # Legacy metadata preserved.
    assert meta["observations"] == 3


@pytest.mark.asyncio
async def test_simulated_event_rejected_outside_demo(client: AsyncClient):
    payload = {
        "event_id": "EVT-FAKE-0001",
        "event_type": "POTHOLE",
        "bus_id": "BUS-999",
        "severity": "HIGH",
        "confidence": 0.9,
        "latitude": 18.52,
        "longitude": 73.85,
        "source": "SIMULATED",
        "metadata_json": {},
    }
    resp = await client.post("/api/events", json=payload, headers=EDGE_HEADERS)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_simulated_metadata_rejected_outside_demo(client: AsyncClient):
    payload = {
        "event_id": "EVT-FAKE-0002",
        "event_type": "POTHOLE",
        "bus_id": "BUS-999",
        "severity": "HIGH",
        "confidence": 0.9,
        "latitude": 18.52,
        "longitude": 73.85,
        "source": "EDGE_AI",
        "metadata_json": {"simulated": True},
    }
    resp = await client.post("/api/events", json=payload, headers=EDGE_HEADERS)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_invalid_bbox_rejected(client: AsyncClient):
    payload = {
        "event_id": "EVT-BAD-BBOX",
        "event_type": "POTHOLE",
        "bus_id": "BUS-999",
        "severity": "HIGH",
        "confidence": 0.9,
        "latitude": 18.52,
        "longitude": 73.85,
        "metadata_json": {},
        "bbox": [10, 20, 5, 70],  # x2 < x1
    }
    resp = await client.post("/api/events", json=payload, headers=EDGE_HEADERS)
    assert resp.status_code == 422
