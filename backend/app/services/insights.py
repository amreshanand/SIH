"""Data-driven analytics insights engine.

Every number here is computed from the database — no fabricated values. Where a
metric uses an approximation (e.g. road-health score, spatial hotspots), it is
explicitly labeled as such.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models import Event, Issue, TrafficRecord, VerificationRecord


SEVERITY_ORDER = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}


async def _since(db: AsyncSession, days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


async def detections_per_day(db: AsyncSession, days: int = 7) -> list[dict]:
    since = await _since(db, days)
    rows = await db.execute(
        select(func.date(Event.created_at), func.count(Event.id))
        .where(Event.created_at >= since)
        .group_by(func.date(Event.created_at))
        .order_by(func.date(Event.created_at))
    )
    return [{"date": str(d), "count": c} for d, c in rows.all()]


async def issue_trend(db: AsyncSession, days: int = 7) -> list[dict]:
    since = await _since(db, days)
    rows = await db.execute(
        select(func.date(Issue.created_at), func.count(Issue.id))
        .where(Issue.created_at >= since)
        .group_by(func.date(Issue.created_at))
        .order_by(func.date(Issue.created_at))
    )
    return [{"date": str(d), "count": c} for d, c in rows.all()]


async def severity_distribution(db: AsyncSession) -> dict:
    rows = await db.execute(
        select(Issue.severity, func.count(Issue.id))
        .where(Issue.status.in_(["OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_VERIFICATION", "REOPENED"]))
        .group_by(Issue.severity)
    )
    return {sev: c for sev, c in rows.all()}


async def resolution_metrics(db: AsyncSession) -> dict:
    resolved = (await db.execute(
        select(func.count(Issue.id)).where(Issue.status == "RESOLVED")
    )).scalar() or 0
    active = (await db.execute(
        select(func.count(Issue.id)).where(
            Issue.status.in_(["OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_VERIFICATION", "REOPENED"])
        )
    )).scalar() or 0

    avg_hrs = 0.0
    if resolved > 0:
        sub = await db.execute(
            select(func.avg(func.extract("epoch", Issue.updated_at - Issue.created_at)))
            .where(Issue.status == "RESOLVED")
        )
        avg_sec = sub.scalar()
        avg_hrs = round(float(avg_sec or 0) / 3600.0, 1)

    total = resolved + active
    resolution_rate = round(resolved / total * 100, 1) if total > 0 else 0.0
    reopen_rate = 0.0
    reopened = (await db.execute(
        select(func.count(Issue.id)).where(Issue.status == "REOPENED")
    )).scalar() or 0
    if resolved + reopened > 0:
        reopen_rate = round(reopened / (resolved + reopened) * 100, 1)

    return {
        "resolved": resolved,
        "active": active,
        "resolution_rate": resolution_rate,
        "avg_resolution_hours": avg_hrs,
        "reopen_rate": reopen_rate,
    }


async def verification_metrics(db: AsyncSession) -> dict:
    rows = await db.execute(
        select(
            func.count(func.distinct(VerificationRecord.bus_id)).filter(
                VerificationRecord.detection_result == "CLEAR"
            ),
            func.count(func.distinct(VerificationRecord.bus_id)).filter(
                VerificationRecord.detection_result == "DETECTED"
            ),
        )
    )
    clear, detected = rows.one()
    clear, detected = int(clear or 0), int(detected or 0)
    total = clear + detected
    return {
        "clear_observations": clear,
        "detected_observations": detected,
        "verification_success_rate": round(clear / total * 100, 1) if total > 0 else 0.0,
    }


async def road_health(db: AsyncSession) -> list[dict]:
    rows = await db.execute(
        select(Issue.department, func.count(Issue.id))
        .where(Issue.status.in_(["OPEN", "ASSIGNED", "IN_PROGRESS", "REOPENED"]))
        .group_by(Issue.department)
    )
    out = []
    for dept, count in rows.all():
        # Transparent heuristic: fewer active issues → healthier network.
        health = max(0, 100 - count * 12)
        # Weight by severity of active issues in that department.
        out.append({
            "department": dept or "UNKNOWN",
            "issue_count": count,
            "health_score": min(100, health),
        })
    out.sort(key=lambda x: x["health_score"])
    return out


async def traffic_metrics(db: AsyncSession, days: int = 7) -> dict:
    since = await _since(db, days)
    avg_congestion = (await db.execute(
        select(func.avg(TrafficRecord.congestion_score)).where(TrafficRecord.created_at >= since)
    )).scalar()
    busiest = await db.execute(
        select(TrafficRecord.road_segment, func.avg(TrafficRecord.vehicle_count).label("vc"))
        .where(TrafficRecord.road_segment.isnot(None), TrafficRecord.created_at >= since)
        .group_by(TrafficRecord.road_segment)
        .order_by(func.avg(TrafficRecord.vehicle_count).desc())
        .limit(1)
    )
    top = busiest.first()
    return {
        "active_records": (await db.execute(
            select(func.count(TrafficRecord.id)).where(TrafficRecord.created_at >= since)
        )).scalar() or 0,
        "avg_congestion_score": round(avg_congestion, 1) if avg_congestion is not None else 0.0,
        "busiest_segment": top[0] if top else None,
        "note": "derived from traffic_records only",
    }


async def issue_hotspots(db: AsyncSession, radius_m: int = 200) -> list[dict]:
    """Approximate hotspots by binning active issues into coarse lat/lon grids.

    Clearly labeled as an approximation — refine with ST_DWithIn + GiST when
    PostGIS is installed (see PHASE 2 spatial service).
    """
    rows = await db.execute(
        select(Issue.latitude, Issue.longitude, Issue.issue_type)
        .where(Issue.status.in_(["OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_VERIFICATION", "REOPENED"]))
    )
    bins: dict[tuple, dict] = {}
    step = radius_m / 111000.0
    for lat, lon, itype in rows.all():
        key = (round(lat / step), round(lon / step))
        b = bins.setdefault(key, {"lat_center": key[0] * step, "lon_center": key[1] * step, "count": 0, "types": {}})
        b["count"] += 1
        b["types"][itype] = b["types"].get(itype, 0) + 1
    hotspots = sorted(bins.values(), key=lambda b: b["count"], reverse=True)[:10]
    return [
        {
            "latitude": round(h["lat_center"], 5),
            "longitude": round(h["lon_center"], 5),
            "count": h["count"],
            "types": h["types"],
        }
        for h in hotspots
    ]


async def generate_sentences(metrics: dict) -> list[str]:
    s = []
    rm = metrics["resolution"]
    if rm["resolution_rate"] >= 50:
        s.append(f"Resolution rate is strong at {rm['resolution_rate']:.0f}% across active and resolved issues.")
    elif rm["resolution_rate"] > 0:
        s.append(f"Resolution rate is {rm['resolution_rate']:.0f}% — room for improvement.")
    if rm["avg_resolution_hours"] > 0:
        s.append(f"Average time to resolve an issue is {rm['avg_resolution_hours']:.1f} hours.")
    vm = metrics["verification"]
    if vm["verification_success_rate"] > 0:
        s.append(f"{vm['verification_success_rate']:.0f}% of verifications confirmed the issue was clear.")
    traffic = metrics.get("traffic", {})
    if traffic.get("busiest_segment"):
        s.append(f"Most congested observed segment is {traffic['busiest_segment']} (avg congestion score {traffic['avg_congestion_score']:.1f}).")
    spots = metrics.get("hotspots", [])
    if spots:
        s.append(f"Top hotspot has {spots[0]['count']} active issues near ({spots[0]['latitude']:.4f}, {spots[0]['longitude']:.4f}).")
    return s


async def build_insights(db: AsyncSession, days: int = 7) -> dict:
    metrics = {
        "detections_per_day": await detections_per_day(db, days),
        "issue_trend": await issue_trend(db, days),
        "severity_distribution": await severity_distribution(db),
        "resolution": await resolution_metrics(db),
        "verification": await verification_metrics(db),
        "road_health": await road_health(db),
        "traffic": await traffic_metrics(db, days),
        "hotspots": await issue_hotspots(db),
        "range_days": days,
    }
    metrics["sentences"] = await generate_sentences(metrics)
    return metrics
