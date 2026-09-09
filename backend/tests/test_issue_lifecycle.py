"""Issue lifecycle state machine — valid chains, invalid transitions, auditing."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from httpx import AsyncClient

from backend.app.models import Issue
from backend.app.services.issue_service import VALID_TRANSITIONS, get_valid_transitions, validate_transition
from tests.conftest import auth_header


def test_transition_table_is_symmetric():
    expected = {
        "OPEN": ["ASSIGNED", "REOPENED"],
        "ASSIGNED": ["IN_PROGRESS", "OPEN"],
        "IN_PROGRESS": ["PENDING_VERIFICATION", "ASSIGNED"],
        "PENDING_VERIFICATION": ["RESOLVED", "IN_PROGRESS"],
        "RESOLVED": ["REOPENED"],
        "REOPENED": ["ASSIGNED"],
    }
    assert VALID_TRANSITIONS == expected
    # Every target must be a known state.
    all_states = set(expected)
    for targets in expected.values():
        assert set(targets) <= all_states


def test_validate_transition_units():
    assert validate_transition("OPEN", "ASSIGNED") is True
    assert validate_transition("OPEN", "RESOLVED") is False
    assert validate_transition("RESOLVED", "OPEN") is False
    assert get_valid_transitions("IN_PROGRESS") == ["PENDING_VERIFICATION", "ASSIGNED"]


async def _mk_issue(session, issue_id="RS-TEST-0001", status="OPEN", dept="TEST_DEPT"):
    issue = Issue(
        issue_id=issue_id,
        issue_type="POTHOLE",
        severity="HIGH",
        confidence=0.9,
        latitude=18.52,
        longitude=73.86,
        first_seen=datetime.now(timezone.utc),
        last_seen=datetime.now(timezone.utc),
        observation_count=1,
        department=dept,
        status=status,
    )
    session.add(issue)
    await session.commit()
    await session.refresh(issue)
    return issue


async def _patch(client, token, issue_id, status):
    return await client.patch(
        f"/api/issues/{issue_id}",
        headers=auth_header(token),
        json={"status": status},
    )


@pytest.mark.asyncio
async def test_full_lifecycle_chain(client: AsyncClient, admin_token, db_session):
    await _mk_issue(db_session)

    chain = ["ASSIGNED", "IN_PROGRESS", "PENDING_VERIFICATION", "RESOLVED", "REOPENED"]
    current = "OPEN"
    for next_status in chain:
        res = await _patch(client, admin_token, "RS-TEST-0001", next_status)
        assert res.status_code == 200, f"{current} -> {next_status} failed: {res.text}"
        assert res.json()["status"] == next_status
        current = next_status


@pytest.mark.asyncio
async def test_invalid_transition_rejected_400(client: AsyncClient, admin_token, db_session):
    await _mk_issue(db_session, issue_id="RS-TEST-0002", status="OPEN")

    res = await _patch(client, admin_token, "RS-TEST-0002", "RESOLVED")
    assert res.status_code == 400
    assert "Invalid transition" in res.json()["detail"]


@pytest.mark.asyncio
async def test_authenticated_status_update_requires_auth(client: AsyncClient, db_session):
    await _mk_issue(db_session, issue_id="RS-TEST-0003", status="OPEN")

    res = await client.patch("/api/issues/RS-TEST-0003", json={"status": "ASSIGNED"})
    assert res.status_code in (401, 403)


@pytest.mark.asyncio
async def test_status_change_writes_audit_log(client: AsyncClient, admin_token, db_session):
    await _mk_issue(db_session, issue_id="RS-TEST-0004", status="OPEN")

    res = await _patch(client, admin_token, "RS-TEST-0004", "ASSIGNED")
    assert res.status_code == 200

    from backend.app.models import AuditLog
    from sqlalchemy import select

    logs = (
        (await db_session.execute(select(AuditLog).where(AuditLog.entity_id == "RS-TEST-0004")))
        .scalars()
        .all()
    )
    assert any(
        log.action == "STATUS_CHANGED" and (log.new_value or {}).get("status") == "ASSIGNED"
        for log in logs
    )


@pytest.mark.asyncio
async def test_issue_listing_filters(client: AsyncClient, admin_token, db_session):
    await _mk_issue(db_session, issue_id="RS-TEST-0005", status="OPEN")
    await _mk_issue(db_session, issue_id="RS-TEST-0006", status="RESOLVED")

    res = await client.get("/api/issues?status=OPEN", headers=auth_header(admin_token))
    assert res.status_code == 200
    body = res.json()
    assert body["total"] >= 1
    assert all(i["status"] == "OPEN" for i in body["issues"])