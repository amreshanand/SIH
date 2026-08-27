from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.models import Event, Issue, IssueEvent
from backend.app.services.spatial import distance_m_async, postgis_available
from backend.app.websocket.manager import ws_manager


VALID_TRANSITIONS = {
    "OPEN": ["ASSIGNED", "REOPENED"],
    "ASSIGNED": ["IN_PROGRESS", "OPEN"],
    "IN_PROGRESS": ["PENDING_VERIFICATION", "ASSIGNED"],
    "PENDING_VERIFICATION": ["RESOLVED", "IN_PROGRESS"],
    "RESOLVED": ["REOPENED"],
    "REOPENED": ["ASSIGNED"],
}


def validate_transition(current_status: str, new_status: str) -> bool:
    return new_status in VALID_TRANSITIONS.get(current_status, [])


def get_valid_transitions(current_status: str) -> list[str]:
    return VALID_TRANSITIONS.get(current_status, [])


DEPARTMENT_ROUTING = {
    "POTHOLE": "ROAD_MAINTENANCE",
    "ROAD_CRACK": "ROAD_MAINTENANCE",
    "DAMAGED_ROAD": "ROAD_MAINTENANCE",
    "WATERLOGGING": "DRAINAGE",
    "MISSING_SIGN": "TRAFFIC_INFRASTRUCTURE",
    "MISSING_CROSSING": "TRAFFIC_INFRASTRUCTURE",
    "DAMAGED_SIGN": "TRAFFIC_INFRASTRUCTURE",
    "STREET_LIGHT": "ELECTRICAL",
    "PEDESTRIAN_RISK": "TRAFFIC_POLICE",
    "INCIDENT": "TRAFFIC_POLICE",
    "TRAFFIC_CONGESTION": "TRAFFIC_MANAGEMENT",
}


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    import math
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def create_or_merge_issue(
    event: Event,
    db: AsyncSession,
) -> Issue:
    cluster_distance = settings.cluster_distance_meters
    use_postgis = await postgis_available(db)

    existing_issues = await db.execute(
        select(Issue).where(
            Issue.issue_type == event.event_type,
            Issue.status.in_(["OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED"]),
        )
    )
    issues = existing_issues.scalars().all()

    for issue in issues:
        if use_postgis:
            dist = await distance_m_async(event.latitude, event.longitude, issue.latitude, issue.longitude, db)
        else:
            dist = haversine_meters(event.latitude, event.longitude, issue.latitude, issue.longitude)
        if dist <= cluster_distance:
            issue.observation_count += 1
            issue.last_seen = datetime.now(timezone.utc)
            issue.confidence = max(issue.confidence, event.confidence)
            if event.severity == "CRITICAL":
                issue.severity = "CRITICAL"
            elif event.severity == "HIGH" and issue.severity in ("LOW", "MEDIUM"):
                issue.severity = "HIGH"

            link = IssueEvent(issue_id=issue.id, event_id=event.id)
            db.add(link)

            # Audit: issue observed by another event/bus
            from backend.app.services.audit_service import log_action
            await log_action(
                user_id=None,
                action="ISSUE_OBSERVED",
                entity_type="ISSUE",
                entity_id=issue.issue_id,
                new_value={"observation_count": issue.observation_count, "event_id": event.event_id},
                db=db,
            )

            await db.commit()
            await db.refresh(issue)

            await ws_manager.broadcast("events", {
                "type": "issue_updated",
                "issue_id": issue.issue_id,
                "observation_count": issue.observation_count,
                "status": issue.status,
            })
            return issue

    issue_counter = int(time.time()) % 100000
    new_issue = Issue(
        issue_id=f"RS-2026-{issue_counter:06d}",
        issue_type=event.event_type,
        severity=event.severity,
        confidence=event.confidence,
        latitude=event.latitude,
        longitude=event.longitude,
        observation_count=1,
        department=DEPARTMENT_ROUTING.get(event.event_type, "GENERAL"),
        status="OPEN",
    )
    db.add(new_issue)
    await db.flush()

    link = IssueEvent(issue_id=new_issue.id, event_id=event.id)
    db.add(link)

    from backend.app.services.audit_service import log_action
    await log_action(
        user_id=None,
        action="ISSUE_CREATED",
        entity_type="ISSUE",
        entity_id=new_issue.issue_id,
        new_value={"issue_type": new_issue.issue_type, "severity": new_issue.severity, "department": new_issue.department},
        db=db,
    )

    await db.commit()
    await db.refresh(new_issue)

    await ws_manager.broadcast("events", {
        "type": "new_issue",
        "issue_id": new_issue.issue_id,
        "issue_type": new_issue.issue_type,
        "severity": new_issue.severity,
        "department": new_issue.department,
    })

    # Notify routed department authorities of the new issue.
    try:
        from backend.app.services.notification_service import create_incident_notification
        await create_incident_notification(
            issue_id=new_issue.issue_id,
            issue_type=new_issue.issue_type,
            severity=new_issue.severity,
            confidence=new_issue.confidence,
            latitude=new_issue.latitude,
            longitude=new_issue.longitude,
            bus_id=event.bus_id,
            department=new_issue.department,
            db=db,
        )
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Issue notification failed: %s", e)

    return new_issue
