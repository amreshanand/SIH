from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database.session import get_db
from backend.app.models import Bus, Event, Incident, Issue
from backend.app.schemas.dashboard import DashboardStats

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/stats", response_model=DashboardStats)
async def get_dashboard_stats(db: AsyncSession = Depends(get_db)) -> DashboardStats:
    active_buses = (await db.execute(select(func.count(Bus.id)).where(Bus.status == "ACTIVE"))).scalar() or 0

    from datetime import datetime, timezone
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    events_today = (await db.execute(
        select(func.count(Event.id)).where(Event.created_at >= today_start)
    )).scalar() or 0

    from backend.app.models import TrafficRecord

    open_issues = (await db.execute(
        select(func.count(Issue.id)).where(Issue.status.in_(
            ["OPEN", "DETECTED", "CONFIRMED", "ASSIGNED", "IN_PROGRESS", "PENDING_VERIFICATION", "REOPENED"]
        ))
    )).scalar() or 0

    critical_incidents = (await db.execute(
        select(func.count(Incident.id)).where(Incident.severity == "CRITICAL")
    )).scalar() or 0

    traffic_hotspots = (await db.execute(
        select(func.count(func.distinct(TrafficRecord.road_segment))).where(
            TrafficRecord.congestion_score >= 60
        )
    )).scalar() or 0

    resolved_issues = (await db.execute(
        select(func.count(Issue.id)).where(Issue.status == "RESOLVED")
    )).scalar() or 0

    total_events = (await db.execute(select(func.count(Event.id)))).scalar() or 0
    total_issues = (await db.execute(select(func.count(Issue.id)))).scalar() or 0
    total_incidents = (await db.execute(select(func.count(Incident.id)))).scalar() or 0

    return DashboardStats(
        active_buses=active_buses,
        events_today=events_today,
        open_issues=open_issues,
        critical_incidents=critical_incidents,
        traffic_hotspots=traffic_hotspots,
        resolved_issues=resolved_issues,
        total_events=total_events,
        total_issues=total_issues,
        total_incidents=total_incidents,
    )
