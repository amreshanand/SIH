"""Deterministic SIH demo — reset, seed and the full 21-step lifecycle."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from backend.app.api.demo import DEMO_LIFECYCLE
from backend.app.core.config import settings
from tests.conftest import auth_header, create_user_in_db, mint_token


@pytest.fixture
async def demo_admin():
    """Admin named literally 'admin' — survives /api/demo/reset (which keeps
    username == 'admin' and deletes everyone else)."""
    user = await create_user_in_db("admin", "ADMIN")
    return mint_token(user.username, user.id, user.role)


@pytest.fixture
def enable_demo():
    """Enable DEMO_MODE for the duration of a demo-lifecycle test. The demo
    router is gated behind settings.demo_mode (see api.demo._demo_enabled), so
    scripted demonstrations are only reachable when enabled — exactly as in
    production (DEMO_MODE=false rejects them with 403)."""
    previous = settings.demo_mode
    settings.demo_mode = True
    try:
        yield
    finally:
        settings.demo_mode = previous


@pytest.mark.asyncio
async def test_reset_then_seed_counts(client: AsyncClient, demo_admin, enable_demo):
    reset = await client.post("/api/demo/reset", headers=auth_header(demo_admin))
    assert reset.status_code == 200
    assert reset.json()["status"] == "reset"

    seed = await client.post("/api/demo/seed", headers=auth_header(demo_admin))
    assert seed.status_code == 200, seed.text
    body = seed.json()
    assert body["status"] == "seeded"
    assert body["buses"] >= 2
    assert body["events"] >= 1
    assert body["issues"] >= 1

    status = (await client.get("/api/demo/status", headers=auth_header(demo_admin))).json()
    assert status["buses"] == body["buses"]


@pytest.mark.asyncio
async def test_seed_idempotent_when_buses_exist(client: AsyncClient, demo_admin, enable_demo):
    await client.post("/api/demo/reset", headers=auth_header(demo_admin))
    first = (await client.post("/api/demo/seed", headers=auth_header(demo_admin))).json()
    second = (await client.post("/api/demo/seed", headers=auth_header(demo_admin))).json()
    assert second["status"] == "already_seeded"  # skips because buses exist
    assert first["buses"] >= 2


@pytest.mark.asyncio
async def test_sih_mode_runs_full_lifecycle(client: AsyncClient, authority_token):
    # authority_token cannot call admin demo endpoints.
    res = await client.post("/api/demo/reset", headers=auth_header(authority_token))
    assert res.status_code == 403


@pytest.mark.slow
@pytest.mark.asyncio
async def test_sih_demo_lifecycle_completes_21_steps(client: AsyncClient, demo_admin, enable_demo):
    reset = await client.post("/api/demo/reset", headers=auth_header(demo_admin))
    assert reset.status_code == 200

    sih = await client.post("/api/demo/sih", headers=auth_header(demo_admin))
    assert sih.status_code == 200, sih.text
    body = sih.json()
    assert body["status"] == "demo_complete"
    assert body["total_steps"] == len(DEMO_LIFECYCLE)
    assert body["issue_created"]

    issues = (await client.get("/api/issues", headers=auth_header(demo_admin))).json()
    assert issues["total"] >= 1
    incidents = (await client.get("/api/incidents", headers=auth_header(demo_admin))).json()
    assert incidents["total"] >= 1