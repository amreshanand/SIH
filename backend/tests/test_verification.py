"""Multi-bus verification — auto-resolution, reopen, dedup, state promotion."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from httpx import AsyncClient

from backend.app.core.config import settings
from backend.app.models import Issue
from tests.conftest import auth_header

CLEAR_THRESHOLD = settings.verification_clear_threshold
REOPEN_THRESHOLD = settings.verification_reopen_threshold


async def _mk_issue(session, issue_id="RS-VER-0001", status="PENDING_VERIFICATION"):
    issue = Issue(
        issue_id=issue_id,
        issue_type="POTHOLE",
        severity="HIGH",
        confidence=0.9,
        latitude=18.52,
        longitude=73.86,
        first_seen=datetime.now(timezone.utc),
        last_seen=datetime.now(timezone.utc),
        observation_count=3,
        department="TEST_DEPT",
        status=status,
    )
    session.add(issue)
    await session.commit()
    await session.refresh(issue)
    return issue


async def create_buses():
    from tests.conftest import create_bus_in_db

    buses = []
    for number in ("VER-BUS-01", "VER-BUS-02", "VER-BUS-03", "VER-BUS-04"):
        buses.append(await create_bus_in_db(number))
    return buses


def _v(bus_id, detection_result, confidence=0.95, lat=18.52, lon=73.86):
    return {
        "issue_id": None,
        "bus_id": str(bus_id),
        "latitude": lat,
        "longitude": lon,
        "detection_result": detection_result,
        "confidence": confidence,
    }


async def _post(client, token, payload):
    return await client.post("/api/verification", json=payload, headers=auth_header(token))


@pytest.mark.asyncio
async def test_resolution_requires_independent_buses(client: AsyncClient, admin_token, db_session):
    buses = await create_buses()
    issue = await _mk_issue(db_session, issue_id="RS-VER-0001", status="PENDING_VERIFICATION")

    # Only the first bus reports CLEAR -> not enough independent observations yet.
    res = await _post(client, admin_token, {**_v(buses[0].id, "CLEAR"), "issue_id": str(issue.id)})
    assert res.status_code == 201, res.text
    assert res.json()["unique_clear_count"] == 1

    issue_status = (await client.get(f"/api/issues/{issue.issue_id}", headers=auth_header(admin_token))).json()
    assert issue_status["status"] != "RESOLVED"

    # Second bus clears.
    await _post(client, admin_token, {**_v(buses[1].id, "CLEAR"), "issue_id": str(issue.id)})

    if CLEAR_THRESHOLD == 3:
        issue_status = (await client.get(f"/api/issues/{issue.issue_id}", headers=auth_header(admin_token))).json()
        assert issue_status["status"] != "RESOLVED"

        # Third independent bus CLEAR -> auto-resolved.
        res = await _post(client, admin_token, {**_v(buses[2].id, "CLEAR"), "issue_id": str(issue.id)})
        assert res.json()["unique_clear_count"] == CLEAR_THRESHOLD
        assert res.json()["issue_status"] == "RESOLVED"
    else:
        res = await _post(client, admin_token, {**_v(buses[2].id, "CLEAR"), "issue_id": str(issue.id)})
        assert res.json()["issue_status"] == "RESOLVED"


@pytest.mark.asyncio
async def test_reopen_after_resolution(client: AsyncClient, admin_token, db_session):
    buses = await create_buses()
    issue = await _mk_issue(db_session, issue_id="RS-VER-0002", status="RESOLVED")

    # A DETECTED pass from one bus is not enough.
    await _post(client, admin_token, {**_v(buses[0].id, "DETECTED"), "issue_id": str(issue.id)})
    got = (await client.get(f"/api/issues/{issue.issue_id}", headers=auth_header(admin_token))).json()
    assert got["status"] == "RESOLVED"

    # Second independent bus DETECTED -> reopen.
    res = await _post(client, admin_token, {**_v(buses[1].id, "DETECTED"), "issue_id": str(issue.id)})
    assert res.status_code == 201
    if REOPEN_THRESHOLD == 2:
        assert res.json()["unique_detected_count"] >= REOPEN_THRESHOLD
        assert res.json()["issue_status"] == "REOPENED"


@pytest.mark.asyncio
async def test_same_bus_dedup(client: AsyncClient, admin_token, db_session):
    buses = await create_buses()
    issue = await _mk_issue(db_session, issue_id="RS-VER-0003", status="PENDING_VERIFICATION")

    payload = {**_v(buses[0].id, "CLEAR"), "issue_id": str(issue.id)}
    first = await _post(client, admin_token, payload)
    assert first.status_code == 201
    second = await _post(client, admin_token, payload)
    assert second.status_code == 201
    assert second.json()["status"] == "deduplicated"


@pytest.mark.asyncio
async def test_verification_of_missing_issue_404(client: AsyncClient, admin_token, admin_user):
    buses = await create_buses()
    payload = {**_v(buses[0].id, "CLEAR"), "issue_id": "00000000-0000-0000-0000-000000000000"}
    res = await _post(client, admin_token, payload)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_open_issue_detected_promotes_to_pending_verification(client: AsyncClient, admin_token, db_session):
    buses = await create_buses()
    issue = await _mk_issue(db_session, issue_id="RS-VER-0004", status="OPEN")

    await _post(client, admin_token, {**_v(buses[0].id, "DETECTED"), "issue_id": str(issue.id)})
    res = await _post(client, admin_token, {**_v(buses[1].id, "DETECTED"), "issue_id": str(issue.id)})
    assert res.status_code == 201
    assert res.json()["issue_status"] == "PENDING_VERIFICATION"