"""Analytics endpoints — road health index and defect trends over seeded data."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from backend.app.models import Event, Issue
from tests.conftest import auth_header


async def _seed_issue(session, issue_id, issue_type, department, status="OPEN", severity="HIGH", lat=18.52, lon=73.86):
    issue = Issue(
        issue_id=issue_id,
        issue_type=issue_type,
        severity=severity,
        confidence=0.9,
        latitude=lat,
        longitude=lon,
        first_seen=datetime.now(timezone.utc),
        last_seen=datetime.now(timezone.utc),
        observation_count=1,
        department=department,
        status=status,
    )
    session.add(issue)


async def _seed_event(session, event_id, event_type, lat=18.52, lon=73.86, severity="HIGH"):
    from backend.app.models import Bus

    bus = Bus(bus_number=f"ANA-BUS-{event_id[-2:]}", status="LIVE")
    session.add(bus)
    await session.flush()
    event = Event(
        event_id=event_id,
        event_type=event_type,
        bus_id=bus.id,
        severity=severity,
        confidence=0.9,
        latitude=lat,
        longitude=lon,
        source="EDGE_AI",
        status="NEW",
        created_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )
    session.add(event)


@pytest.mark.asyncio
async def test_road_health_index(client: AsyncClient, admin_token, db_session):
    await _seed_issue(db_session, "RS-ANA-001", "POTHOLE", "PUNE_MUNICIPAL_CORPORATION", status="OPEN")
    await _seed_issue(db_session, "RS-ANA-002", "DAMAGED_ROAD", "PUNE_MUNICIPAL_CORPORATION", status="OPEN")
    await _seed_issue(db_session, "RS-ANA-003", "MISSING_SIGN", "TRAFFIC_POLICE", status="RESOLVED")
    await db_session.commit()

    res = await client.get("/api/analytics/road-health", headers=auth_header(admin_token))
    assert res.status_code == 200
    roads = res.json()["roads"]
    by_dept = {r["department"]: r for r in roads}
    pmc = by_dept.get("PUNE_MUNICIPAL_CORPORATION")
    assert pmc is not None
    assert pmc["issue_count"] == 2
    assert 0 <= pmc["health_score"] <= 100


@pytest.mark.asyncio
async def test_defect_trends(client: AsyncClient, admin_token, db_session):
    await _seed_event(db_session, "EVT-ANA-001", "POTHOLE")
    await _seed_event(db_session, "EVT-ANA-002", "ROAD_CRACK")
    await db_session.commit()

    res = await client.get("/api/analytics/defect-trends", headers=auth_header(admin_token))
    assert res.status_code == 200
    assert "trends" in res.json() or "by_type" in res.json() or "daily" in res.json()


@pytest.mark.asyncio
async def test_insights_shape(client: AsyncClient, admin_token, db_session):
    await _seed_issue(db_session, "RS-ANA-004", "WATERLOGGING", "PUNE_MUNICIPAL_CORPORATION")
    await db_session.commit()

    res = await client.get("/api/analytics/insights", headers=auth_header(admin_token))
    assert res.status_code == 200
    body = res.json()
    assert "detections_per_day" in body
    assert "road_health" in body
    assert isinstance(body["sentences"], list)