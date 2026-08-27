from __future__ import annotations

from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database.session import get_db
from backend.app.models import Event, Issue, Incident, TrafficRecord, VerificationRecord

router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/insights")
async def insights(
    days: int = Query(7, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
) -> dict:
    from backend.app.services.insights import build_insights
    return await build_insights(db, days)


@router.get("/road-health")
async def road_health(db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(
        select(
            Issue.department,
            func.count(Issue.id).label("issue_count"),
            func.avg(Issue.severity).label("avg_severity"),
        )
        .where(Issue.status.in_(["OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED"]))
        .group_by(Issue.department)
    )
    rows = result.all()

    severity_map = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}

    roads = []
    for row in rows:
        dept = row.department or "UNKNOWN"
        count = row.issue_count
        base_health = max(0, 100 - (count * 12))
        roads.append({
            "department": dept,
            "issue_count": count,
            "health_score": min(100, base_health),
        })

    roads.sort(key=lambda x: x["health_score"])

    return {"roads": roads, "note": "Prototype analytical score — not an official standard"}


@router.get("/route-performance")
async def route_performance(db: AsyncSession = Depends(get_db)) -> dict:
    event_count = (await db.execute(select(func.count(Event.id)))).scalar() or 0
    issue_count = (await db.execute(select(func.count(Issue.id)))).scalar() or 0
    resolved = (await db.execute(
        select(func.count(Issue.id)).where(Issue.status == "RESOLVED")
    )).scalar() or 0

    return {
        "total_detections": event_count,
        "total_issues": issue_count,
        "resolved_issues": resolved,
        "resolution_rate": round(resolved / issue_count * 100, 1) if issue_count > 0 else 0,
    }


@router.get("/od-matrix")
async def od_matrix(db: AsyncSession = Depends(get_db)) -> dict:
    return {
        "matrix": [],
        "note": "ESTIMATED TRAFFIC FLOW — prototype data based on bus routes and traffic observations",
        "status": "SIMULATED",
    }


@router.get("/defect-trends")
async def defect_trends(db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(
        select(
            Event.event_type,
            func.count(Event.id).label("count"),
        )
        .group_by(Event.event_type)
        .order_by(func.count(Event.id).desc())
    )
    rows = result.all()

    return {
        "trends": [
            {"event_type": row.event_type, "count": row.count}
            for row in rows
        ]
    }
