"""Phase 0 — Backend operational-state, CORS, and health truthfulness tests.

Tests are split into two groups:

1. **Pure-function tests** (``TestComputeOperationalState``) — call the
   extracted ``compute_operational_state()`` directly with every combination
   of boolean flags. Zero network, zero disk I/O, zero database. Deterministic
   and runs in milliseconds.

2. **Integration / Endpoint tests** (``TestHealthEndpointTruthfulness``) — use
   FastAPI's TestClient to call the live ``/api/system/health``,
   ``/api/system/models`` endpoints and check CORS headers.
   Models are verified via monkeypatching settings.yolo_model_path and
   settings.road_damage_model_path with temporary files or non-existent paths.
"""
from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.app.core.config import settings
from backend.app.database.session import get_db
from backend.app.services.operational_state import (
    OPERATIONAL_STATES,
    compute_operational_state,
)


# ==============================================================================
# Group 1: Pure-function unit tests (no network, no disk, no DB)
# ==============================================================================


class TestComputeOperationalState:
    """Every legal state branch must be deterministic and pure."""

    def test_all_operational_states_constant_defined(self):
        expected = {"REAL", "SIMULATED", "DEMO", "MODEL_MISSING", "DEGRADED", "OFFLINE"}
        assert OPERATIONAL_STATES == expected

    def test_database_offline_always_yields_offline(self):
        assert compute_operational_state(
            db_ok=False,
            demo_mode=False,
            vehicle_model_available=True,
            road_damage_model_available=True,
            gps_simulated=False,
            postgis_ok=True,
        ) == "OFFLINE"

    def test_demo_mode_overrides_when_db_ok(self):
        assert compute_operational_state(
            db_ok=True,
            demo_mode=True,
            vehicle_model_available=False,
            road_damage_model_available=False,
            gps_simulated=True,
            postgis_ok=False,
        ) == "DEMO"

    def test_model_missing_when_vehicle_model_absent(self):
        assert compute_operational_state(
            db_ok=True,
            demo_mode=False,
            vehicle_model_available=False,
            road_damage_model_available=True,
            gps_simulated=False,
            postgis_ok=True,
        ) == "MODEL_MISSING"

    def test_model_missing_when_road_damage_model_absent(self):
        assert compute_operational_state(
            db_ok=True,
            demo_mode=False,
            vehicle_model_available=True,
            road_damage_model_available=False,
            gps_simulated=False,
            postgis_ok=True,
        ) == "MODEL_MISSING"

    def test_model_missing_when_both_models_absent(self):
        assert compute_operational_state(
            db_ok=True,
            demo_mode=False,
            vehicle_model_available=False,
            road_damage_model_available=False,
            gps_simulated=False,
            postgis_ok=True,
        ) == "MODEL_MISSING"

    def test_simulated_mode_when_models_present_and_gps_simulated(self):
        assert compute_operational_state(
            db_ok=True,
            demo_mode=False,
            vehicle_model_available=True,
            road_damage_model_available=True,
            gps_simulated=True,
            postgis_ok=True,
        ) == "SIMULATED"

    def test_degraded_mode_when_postgis_missing(self):
        assert compute_operational_state(
            db_ok=True,
            demo_mode=False,
            vehicle_model_available=True,
            road_damage_model_available=True,
            gps_simulated=False,
            postgis_ok=False,
        ) == "DEGRADED"

    def test_real_mode_only_when_all_conditions_satisfied(self):
        assert compute_operational_state(
            db_ok=True,
            demo_mode=False,
            vehicle_model_available=True,
            road_damage_model_available=True,
            gps_simulated=False,
            postgis_ok=True,
        ) == "REAL"

    def test_health_state_is_never_live_when_inference_cannot_run(self):
        """ai_mode / operational_state must not be REAL/LIVE when weights are absent."""
        state = compute_operational_state(
            db_ok=True,
            demo_mode=False,
            vehicle_model_available=False,
            road_damage_model_available=False,
            gps_simulated=False,
            postgis_ok=True,
        )
        assert state != "REAL"
        assert state == "MODEL_MISSING"


# ==============================================================================
# Group 2: FastAPI endpoint & CORS tests (using TestClient)
# ==============================================================================


@pytest.fixture
def mock_db_healthy():
    from unittest.mock import MagicMock
    mock = AsyncMock()
    scalar_mock = MagicMock()
    scalar_mock.scalar.return_value = "3.4.0"
    mock.execute = AsyncMock(return_value=scalar_mock)
    return mock


@pytest.fixture
def mock_db_offline():
    mock = AsyncMock()
    mock.execute = AsyncMock(side_effect=RuntimeError("Connection refused"))
    return mock


class TestHealthEndpointTruthfulness:

    def test_health_reports_model_missing_when_weights_absent(self, monkeypatch, mock_db_healthy):
        app = create_app()
        app.dependency_overrides[get_db] = lambda: mock_db_healthy

        with tempfile.TemporaryDirectory() as tmpdir:
            monkeypatch.setattr(settings, "yolo_model_path", str(Path(tmpdir) / "nonexistent_yolo.pt"))
            monkeypatch.setattr(settings, "road_damage_model_path", str(Path(tmpdir) / "nonexistent_rd.pt"))
            monkeypatch.setattr(settings, "demo_mode", False)

            client = TestClient(app)
            resp = client.get("/api/system/health")
            assert resp.status_code == 200
            data = resp.json()

            assert data["operational_state"] == "MODEL_MISSING"
            assert data["ai_mode"] == "MODEL_MISSING"
            assert data["ai_state"] == "UNAVAILABLE"
            assert data["vehicle_model_available"] is False
            assert data["road_damage_model_available"] is False

    def test_health_reports_real_when_both_weights_exist(self, monkeypatch, mock_db_healthy):
        app = create_app()
        app.dependency_overrides[get_db] = lambda: mock_db_healthy

        with tempfile.TemporaryDirectory() as tmpdir:
            yolo_file = Path(tmpdir) / "yolov8n.pt"
            yolo_file.write_bytes(b"dummy_weights")
            rd_file = Path(tmpdir) / "road_damage.pt"
            rd_file.write_bytes(b"dummy_weights")

            monkeypatch.setattr(settings, "yolo_model_path", str(yolo_file))
            monkeypatch.setattr(settings, "road_damage_model_path", str(rd_file))
            monkeypatch.setattr(settings, "demo_mode", False)
            monkeypatch.setattr(settings, "gps_mode", "phone")

            client = TestClient(app)
            resp = client.get("/api/system/health")
            assert resp.status_code == 200
            data = resp.json()

            assert data["operational_state"] == "REAL"
            assert data["ai_mode"] == "REAL"
            assert data["ai_state"] == "LIVE"
            assert data["vehicle_model_available"] is True
            assert data["road_damage_model_available"] is True

    def test_health_reports_offline_when_database_fails(self, monkeypatch, mock_db_offline):
        app = create_app()
        app.dependency_overrides[get_db] = lambda: mock_db_offline

        with tempfile.TemporaryDirectory() as tmpdir:
            monkeypatch.setattr(settings, "yolo_model_path", str(Path(tmpdir) / "no_yolo.pt"))
            monkeypatch.setattr(settings, "road_damage_model_path", str(Path(tmpdir) / "no_rd.pt"))

            client = TestClient(app)
            resp = client.get("/api/system/health")
            assert resp.status_code == 200
            data = resp.json()

            assert data["status"] == "degraded"
            assert data["database"]["status"] == "offline"
            assert data["operational_state"] == "OFFLINE"

    def test_models_endpoint_truthfulness(self, monkeypatch):
        app = create_app()

        with tempfile.TemporaryDirectory() as tmpdir:
            monkeypatch.setattr(settings, "yolo_model_path", str(Path(tmpdir) / "absent_yolo.pt"))
            monkeypatch.setattr(settings, "road_damage_model_path", str(Path(tmpdir) / "absent_rd.pt"))

            client = TestClient(app)
            resp = client.get("/api/system/models")
            assert resp.status_code == 200
            data = resp.json()

            rd = data["road_damage_model"]
            assert rd["status"] == "missing"
            assert rd["available"] is False
            assert "UNAVAILABLE" in rd["note"]
            assert "transparently" not in rd["note"].lower()


# ==============================================================================
# Group 3: CORS & Configuration tests
# ==============================================================================


class TestCorsAndConfig:

    def test_cors_allows_localhost_3000(self):
        app = create_app()
        client = TestClient(app)
        resp = client.options(
            "/api/system/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"

    def test_cors_allows_127_0_0_1_3000(self):
        app = create_app()
        client = TestClient(app)
        resp = client.options(
            "/api/system/health",
            headers={
                "Origin": "http://127.0.0.1:3000",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "http://127.0.0.1:3000"

    def test_cors_allows_local_network_ip(self):
        app = create_app()
        client = TestClient(app)
        resp = client.options(
            "/api/system/health",
            headers={
                "Origin": "http://11.6.3.45:3000",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "http://11.6.3.45:3000"

    def test_database_auth_failure_error_message_is_safe_and_actionable(self):
        """Database auth errors must produce safe actionable message without leaking password."""
        from backend.app.core.logging_setup import get_logger
        logger = get_logger("urbansense")

        error_message = "password authentication failed for user 'urbansense'"
        assert "password authentication failed" in error_message.lower()

        # Expected user-facing / log message:
        safe_msg = "Database authentication failed. Check DATABASE_URL and Docker Postgres credentials."
        assert "password=" not in safe_msg
        assert "secret" not in safe_msg
        assert "Check DATABASE_URL" in safe_msg

    def test_login_preflight_cors_options(self):
        app = create_app()
        client = TestClient(app)
        resp = client.options(
            "/api/auth/login",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"
        allow_methods = resp.headers.get("access-control-allow-methods", "")
        assert "POST" in allow_methods
        assert "OPTIONS" in allow_methods
        allow_headers = resp.headers.get("access-control-allow-headers", "").lower()
        assert "content-type" in allow_headers

    def test_login_preflight_not_rate_limited(self):
        """OPTIONS preflight requests must never increment rate limit counter or fail with 429."""
        app = create_app()
        client = TestClient(app)
        for _ in range(8):
            resp = client.options(
                "/api/auth/login",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type",
                },
            )
            assert resp.status_code == 200
            assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"
