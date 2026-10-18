"""Phase 0 — Backend operational-state + health endpoint truthfulness tests.

Tests are split into two groups:

1. **Pure-function tests** (``TestComputeOperationalState``) — call the
   extracted ``compute_operational_state()`` directly with every combination
   of conditions.  Zero I/O, zero mocking, fully deterministic.

2. **FastAPI test-client tests** (``TestHealthEndpoint``,
   ``TestModelsEndpoint``) — exercise the real HTTP layer using
   ``httpx.AsyncClient`` + ``ASGITransport`` with mocked DB and
   monkeypatched model paths (temporary files).  No localhost server needed.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

# Ensure repo root is on sys.path
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT))

from backend.app.services.operational_state import (
    OPERATIONAL_STATES,
    compute_operational_state,
)


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Pure-function tests for compute_operational_state
# ═══════════════════════════════════════════════════════════════════════════════

class TestComputeOperationalState:
    """Deterministic branch-coverage of operational state logic."""

    # ── OFFLINE ──────────────────────────────────────────────────────────────

    def test_offline_when_db_down(self):
        assert compute_operational_state(
            db_ok=False,
            demo_mode=False,
            vehicle_model_available=True,
            road_damage_model_available=True,
            gps_simulated=False,
        ) == "OFFLINE"

    def test_offline_overrides_demo_mode(self):
        """OFFLINE takes priority over demo_mode."""
        assert compute_operational_state(
            db_ok=False,
            demo_mode=True,
            vehicle_model_available=True,
            road_damage_model_available=True,
            gps_simulated=False,
        ) == "OFFLINE"

    # ── DEMO ─────────────────────────────────────────────────────────────────

    def test_demo_when_demo_mode_active(self):
        assert compute_operational_state(
            db_ok=True,
            demo_mode=True,
            vehicle_model_available=True,
            road_damage_model_available=True,
            gps_simulated=False,
        ) == "DEMO"

    def test_demo_overrides_model_missing(self):
        """Demo mode is reported honestly even when models are absent."""
        assert compute_operational_state(
            db_ok=True,
            demo_mode=True,
            vehicle_model_available=False,
            road_damage_model_available=False,
            gps_simulated=False,
        ) == "DEMO"

    # ── MODEL_MISSING ────────────────────────────────────────────────────────

    def test_model_missing_when_vehicle_model_absent(self):
        assert compute_operational_state(
            db_ok=True,
            demo_mode=False,
            vehicle_model_available=False,
            road_damage_model_available=True,
            gps_simulated=False,
        ) == "MODEL_MISSING"

    def test_model_missing_when_road_damage_model_absent(self):
        assert compute_operational_state(
            db_ok=True,
            demo_mode=False,
            vehicle_model_available=True,
            road_damage_model_available=False,
            gps_simulated=False,
        ) == "MODEL_MISSING"

    def test_model_missing_when_both_models_absent(self):
        assert compute_operational_state(
            db_ok=True,
            demo_mode=False,
            vehicle_model_available=False,
            road_damage_model_available=False,
            gps_simulated=False,
        ) == "MODEL_MISSING"

    # ── SIMULATED ────────────────────────────────────────────────────────────

    def test_simulated_when_gps_simulated(self):
        """GPS simulated with both models present → SIMULATED."""
        assert compute_operational_state(
            db_ok=True,
            demo_mode=False,
            vehicle_model_available=True,
            road_damage_model_available=True,
            gps_simulated=True,
        ) == "SIMULATED"

    # ── DEGRADED ─────────────────────────────────────────────────────────────

    def test_degraded_when_postgis_unavailable(self):
        """Both models present, real GPS, but PostGIS down → DEGRADED."""
        assert compute_operational_state(
            db_ok=True,
            demo_mode=False,
            vehicle_model_available=True,
            road_damage_model_available=True,
            gps_simulated=False,
            postgis_ok=False,
        ) == "DEGRADED"

    # ── REAL ─────────────────────────────────────────────────────────────────

    def test_real_when_all_healthy(self):
        """Fully operational: both models, real GPS, PostGIS available."""
        assert compute_operational_state(
            db_ok=True,
            demo_mode=False,
            vehicle_model_available=True,
            road_damage_model_available=True,
            gps_simulated=False,
            postgis_ok=True,
        ) == "REAL"

    def test_real_requires_both_models(self):
        """REAL is only possible when BOTH models are present."""
        # One missing → not REAL
        assert compute_operational_state(
            db_ok=True,
            demo_mode=False,
            vehicle_model_available=True,
            road_damage_model_available=False,
            gps_simulated=False,
        ) != "REAL"

    # ── Meta: return value is always a known state ───────────────────────────

    @pytest.mark.parametrize(
        "kwargs",
        [
            dict(db_ok=True, demo_mode=False, vehicle_model_available=True,
                 road_damage_model_available=True, gps_simulated=False),
            dict(db_ok=False, demo_mode=False, vehicle_model_available=False,
                 road_damage_model_available=False, gps_simulated=True),
            dict(db_ok=True, demo_mode=True, vehicle_model_available=False,
                 road_damage_model_available=True, gps_simulated=True),
        ],
    )
    def test_return_value_always_valid(self, kwargs):
        result = compute_operational_state(**kwargs)
        assert result in OPERATIONAL_STATES, f"'{result}' not in OPERATIONAL_STATES"


# ═══════════════════════════════════════════════════════════════════════════════
# 2. FastAPI test-client tests (no localhost, no running server)
# ═══════════════════════════════════════════════════════════════════════════════

def _mock_db_session(*, db_ok: bool = True, postgis_ok: bool = True):
    """Create a mock AsyncSession that simulates DB and PostGIS checks."""
    session = AsyncMock()

    async def _execute_side_effect(stmt, *args, **kwargs):
        sql = str(stmt)
        result = MagicMock()
        if "SELECT 1" in sql:
            if not db_ok:
                raise ConnectionError("DB unavailable")
            result.scalar.return_value = 1
        elif "PostGIS_Version" in sql:
            if not postgis_ok:
                raise Exception("PostGIS not installed")
            result.scalar.return_value = "3.4.0"
        else:
            result.scalar.return_value = None
        return result

    session.execute = AsyncMock(side_effect=_execute_side_effect)
    return session


@pytest.fixture
def _models_on_disk(tmp_path):
    """Create fake model weight files and return their paths."""
    yolo = tmp_path / "yolov8n.pt"
    rd = tmp_path / "road_damage.pt"
    yolo.write_bytes(b"fake-yolo-weights")
    rd.write_bytes(b"fake-rd-weights")
    return str(yolo), str(rd)


@pytest.fixture
def _models_missing(tmp_path):
    """Return paths to model files that do NOT exist."""
    return str(tmp_path / "missing_yolo.pt"), str(tmp_path / "missing_rd.pt")


async def _make_client(monkeypatch, yolo_path, rd_path, *, demo_mode=False, gps_mode="phone", db_ok=True, postgis_ok=True):
    """Build a fully-mocked test client."""
    from httpx import ASGITransport, AsyncClient

    from backend.app.core.config import settings
    from backend.app.database.session import get_db

    monkeypatch.setattr(settings, "yolo_model_path", yolo_path)
    monkeypatch.setattr(settings, "road_damage_model_path", rd_path)
    monkeypatch.setattr(settings, "demo_mode", demo_mode)
    monkeypatch.setattr(settings, "gps_mode", gps_mode)

    mock_db = _mock_db_session(db_ok=db_ok, postgis_ok=postgis_ok)

    async def override_get_db():
        yield mock_db

    # Create a fresh app to pick up the monkeypatched settings
    from backend.app import create_app
    app = create_app()
    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    client = AsyncClient(transport=transport, base_url="http://test")
    return client, app


class TestHealthEndpoint:
    """Test /api/system/health via ASGI test client — no localhost."""

    @pytest.mark.asyncio
    async def test_health_contains_operational_state(self, monkeypatch, _models_on_disk):
        yolo, rd = _models_on_disk
        client, app = await _make_client(monkeypatch, yolo, rd)
        async with client:
            resp = await client.get("/api/system/health")
        assert resp.status_code == 200
        data = resp.json()
        assert "operational_state" in data
        assert data["operational_state"] in OPERATIONAL_STATES

    @pytest.mark.asyncio
    async def test_health_ai_mode_equals_operational_state(self, monkeypatch, _models_on_disk):
        """ai_mode must always equal operational_state (no hardcoded 'LIVE')."""
        yolo, rd = _models_on_disk
        client, app = await _make_client(monkeypatch, yolo, rd)
        async with client:
            resp = await client.get("/api/system/health")
        data = resp.json()
        assert data["ai_mode"] == data["operational_state"]

    @pytest.mark.asyncio
    async def test_health_model_availability_fields(self, monkeypatch, _models_on_disk):
        yolo, rd = _models_on_disk
        client, app = await _make_client(monkeypatch, yolo, rd)
        async with client:
            resp = await client.get("/api/system/health")
        data = resp.json()
        assert isinstance(data["vehicle_model_available"], bool)
        assert isinstance(data["road_damage_model_available"], bool)
        assert isinstance(data["postgis_available"], bool)

    @pytest.mark.asyncio
    async def test_health_reports_real_when_all_models_present(self, monkeypatch, _models_on_disk):
        yolo, rd = _models_on_disk
        client, app = await _make_client(monkeypatch, yolo, rd)
        async with client:
            resp = await client.get("/api/system/health")
        data = resp.json()
        assert data["operational_state"] == "REAL"
        assert data["vehicle_model_available"] is True
        assert data["road_damage_model_available"] is True

    @pytest.mark.asyncio
    async def test_health_reports_model_missing_when_models_absent(self, monkeypatch, _models_missing):
        yolo, rd = _models_missing
        client, app = await _make_client(monkeypatch, yolo, rd)
        async with client:
            resp = await client.get("/api/system/health")
        data = resp.json()
        assert data["operational_state"] == "MODEL_MISSING"
        assert data["vehicle_model_available"] is False
        assert data["road_damage_model_available"] is False

    @pytest.mark.asyncio
    async def test_health_reports_model_missing_when_one_absent(self, monkeypatch, _models_on_disk, tmp_path):
        """If only one of the two required models exists → MODEL_MISSING."""
        yolo, _ = _models_on_disk
        missing_rd = str(tmp_path / "no_such_model.pt")
        client, app = await _make_client(monkeypatch, yolo, missing_rd)
        async with client:
            resp = await client.get("/api/system/health")
        data = resp.json()
        assert data["operational_state"] == "MODEL_MISSING"

    @pytest.mark.asyncio
    async def test_health_reports_demo_in_demo_mode(self, monkeypatch, _models_on_disk):
        yolo, rd = _models_on_disk
        client, app = await _make_client(monkeypatch, yolo, rd, demo_mode=True)
        async with client:
            resp = await client.get("/api/system/health")
        data = resp.json()
        assert data["operational_state"] == "DEMO"

    @pytest.mark.asyncio
    async def test_health_reports_simulated_with_simulated_gps(self, monkeypatch, _models_on_disk):
        yolo, rd = _models_on_disk
        client, app = await _make_client(monkeypatch, yolo, rd, gps_mode="simulated")
        async with client:
            resp = await client.get("/api/system/health")
        data = resp.json()
        assert data["operational_state"] == "SIMULATED"

    @pytest.mark.asyncio
    async def test_health_has_bus_and_camera_fields(self, monkeypatch, _models_on_disk):
        """Health response must expose bus_id and camera for provenance."""
        yolo, rd = _models_on_disk
        client, app = await _make_client(monkeypatch, yolo, rd)
        async with client:
            resp = await client.get("/api/system/health")
        data = resp.json()
        assert "bus_id" in data
        assert "camera" in data


class TestModelsEndpoint:
    """Test /api/system/models via ASGI test client — no localhost."""

    @pytest.mark.asyncio
    async def test_models_ready_when_present(self, monkeypatch, _models_on_disk):
        yolo, rd = _models_on_disk
        client, app = await _make_client(monkeypatch, yolo, rd)
        async with client:
            resp = await client.get("/api/system/models")
        data = resp.json()
        assert data["vehicle_model"]["status"] == "ready"
        assert data["road_damage_model"]["status"] == "ready"

    @pytest.mark.asyncio
    async def test_models_missing_when_absent(self, monkeypatch, _models_missing):
        yolo, rd = _models_missing
        client, app = await _make_client(monkeypatch, yolo, rd)
        async with client:
            resp = await client.get("/api/system/models")
        data = resp.json()
        assert data["vehicle_model"]["status"] == "missing"
        assert data["road_damage_model"]["status"] == "missing"

    @pytest.mark.asyncio
    async def test_models_status_never_fallback_active(self, monkeypatch, _models_missing):
        """Status must be 'ready' or 'missing' — never 'fallback_active'."""
        yolo, rd = _models_missing
        client, app = await _make_client(monkeypatch, yolo, rd)
        async with client:
            resp = await client.get("/api/system/models")
        data = resp.json()
        for model_key in ("vehicle_model", "road_damage_model"):
            assert data[model_key]["status"] in ("ready", "missing"), (
                f"{model_key} status is '{data[model_key]['status']}', "
                f"expected 'ready' or 'missing'"
            )

    @pytest.mark.asyncio
    async def test_models_missing_note_says_unavailable(self, monkeypatch, _models_missing):
        yolo, rd = _models_missing
        client, app = await _make_client(monkeypatch, yolo, rd)
        async with client:
            resp = await client.get("/api/system/models")
        rd_model = resp.json()["road_damage_model"]
        assert rd_model["status"] == "missing"
        assert "UNAVAILABLE" in rd_model["note"]

    @pytest.mark.asyncio
    async def test_models_missing_note_no_transparent_fallback(self, monkeypatch, _models_missing):
        yolo, rd = _models_missing
        client, app = await _make_client(monkeypatch, yolo, rd)
        async with client:
            resp = await client.get("/api/system/models")
        rd_model = resp.json()["road_damage_model"]
        if rd_model["status"] == "missing":
            assert "transparently" not in rd_model["note"].lower(), (
                "Must not claim transparent fallback when model is missing"
            )

    @pytest.mark.asyncio
    async def test_models_endpoint_exposes_model_path(self, monkeypatch, _models_on_disk):
        """Model path must be reported for provenance/audit."""
        yolo, rd = _models_on_disk
        client, app = await _make_client(monkeypatch, yolo, rd)
        async with client:
            resp = await client.get("/api/system/models")
        data = resp.json()
        assert "path" in data["vehicle_model"]
        assert "path" in data["road_damage_model"]
        assert data["vehicle_model"]["path"] == yolo
        assert data["road_damage_model"]["path"] == rd
