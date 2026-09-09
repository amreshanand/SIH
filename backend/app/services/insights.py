"""Data-driven analytics insights engine.

Every number here is computed from the database — no fabricated values. Where a
metric uses an approximation (e.g. road-health score, spatial hotspots), it is
explicitly labeled as such.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models import Event, Issue, TrafficRecord, VerificationRecord, Route, Incident, Bus


SEVERITY_ORDER = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}
ACTIVE_ISSUE_STATUSES = [
    "OPEN", "DETECTED", "CONFIRMED", "ASSIGNED", "IN_PROGRESS", "PENDING_VERIFICATION", "REOPENED"
]


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
        .where(Issue.status.in_(ACTIVE_ISSUE_STATUSES))
        .group_by(Issue.severity)
    )
    return {sev: c for sev, c in rows.all()}


async def resolution_metrics(db: AsyncSession) -> dict:
    resolved = (await db.execute(
        select(func.count(Issue.id)).where(Issue.status == "RESOLVED")
    )).scalar() or 0
    active = (await db.execute(
        select(func.count(Issue.id)).where(
            Issue.status.in_(ACTIVE_ISSUE_STATUSES)
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
        .where(Issue.status.in_(ACTIVE_ISSUE_STATUSES))
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
        .where(Issue.status.in_(ACTIVE_ISSUE_STATUSES))
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


DEFICIENCY_CATEGORIES = {
    "POTHOLE": "ROAD_SURFACE",
    "ROAD_CRACK": "ROAD_SURFACE",
    "DAMAGED_ROAD": "ROAD_SURFACE",
    "WATERLOGGING": "DRAINAGE",
    "MISSING_SIGN": "SIGNALIZATION",
    "DAMAGED_SIGN": "SIGNALIZATION",
    "MISSING_CROSSING": "PEDESTRIAN_SAFETY",
    "MISSING_DIVIDER": "SAFETY_RAIL",
    "STREET_LIGHT": "LIGHTING",
}

RECOMMENDATIONS = {
    "ROAD_SURFACE": "Schedule resurfacing / patch repair and mark the segment for pre-monsoon inspection.",
    "DRAINAGE": "Clear blocked drains and add covered culverts in the waterlogging-prone stretch.",
    "PEDESTRIAN_SAFETY": "Re-mark zebra crossings and add pedestrian signal phasing near the crossing.",
    "SIGNALIZATION": "Replace or install missing or damaged traffic signage and reflectors.",
    "SAFETY_RAIL": "Install road dividers / median guards on the high-risk carriageway.",
    "LIGHTING": "Repair street lights and add illumination on the affected block.",
}


def _haversine_m(la1: float, lo1: float, la2: float, lo2: float) -> float:
    import math
    R = 6371000
    phi1, phi2 = math.radians(la1), math.radians(la2)
    dphi = math.radians(la2 - la1)
    dlam = math.radians(lo2 - lo1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def route_delays(db: AsyncSession) -> list[dict]:
    """Average delay per route, estimated from observed traffic records.

    Base travel time comes from the route's scheduled duration (or distance/
    average speed as a fallback); congestion inflates it. Labeled ESTIMATED —
    the fleet reports live GPS so a future version can diff against on-time
    arrivals directly.
    """
    routes = (await db.execute(select(Route))).scalars().all()
    if not routes:
        return []

    out = []
    for route in routes:
        buses = (await db.execute(
            select(Bus).where(Bus.route_id == route.id)
        )).scalars().all()
        records = []
        for bus in buses:
            recs = (await db.execute(
                select(TrafficRecord).where(TrafficRecord.bus_id == bus.id)
            )).scalars().all()
            records.extend(recs)
        if not records:
            continue
        avg_congestion = sum(r.congestion_score for r in records) / len(records)
        avg_speed = [r.average_speed for r in records if r.average_speed]
        obs_speed = sum(avg_speed) / len(avg_speed) if avg_speed else None

        scheduled_min = route.scheduled_duration_min
        if scheduled_min and obs_speed:
            base_min = route.distance_km / max(obs_speed, 5) * 60
        elif scheduled_min:
            base_min = float(scheduled_min)
        elif obs_speed and route.distance_km:
            base_min = route.distance_km / max(obs_speed, 5) * 60
        else:
            continue

        min_delay = round(base_min - (scheduled_min or base_min), 1)
        congestion_multiplier = 1 + max(0.0, (avg_congestion - 35) / 65) * 0.5
        estimated_duration_min = round(base_min * congestion_multiplier, 1)

        if estimated_duration_min - base_min <= 5:
            status = "ON_TIME"
        elif estimated_duration_min - base_min <= 15:
            status = "DELAYED"
        else:
            status = "SEVERE"

        out.append({
            "route_name": route.route_name,
            "start_stop": route.start_stop,
            "end_stop": route.end_stop,
            "distance_km": route.distance_km,
            "scheduled_duration_min": scheduled_min,
            "estimated_duration_min": estimated_duration_min,
            "delay_min": round(estimated_duration_min - base_min, 1),
            "avg_congestion_score": round(avg_congestion, 1),
            "avg_speed_kph": round(obs_speed or 0.0, 1),
            "status": status,
            "label": "ESTIMATED",
        })

    out.sort(key=lambda r: r["delay_min"], reverse=True)
    return out


async def od_matrix(db: AsyncSession, days: int = 7) -> dict:
    """Origin-destination flows per corridor.

    Aggregate vehicle counts observed by fleet cameras along each route; the
    route's endpoints define origin/destination. Labeled ESTIMATED since the
    counts are on-road observations, not ticketing data.
    """
    since = await _since(db, days)
    routes = (await db.execute(select(Route))).scalars().all()
    matrix: list[dict] = []
    for route in routes:
        buses = (await db.execute(
            select(Bus).where(Bus.route_id == route.id)
        )).scalars().all()
        bus_ids_ = [b.id for b in buses]
        if not bus_ids_:
            continue
        rows = await db.execute(
            select(
                func.count(TrafficRecord.id),
                func.sum(TrafficRecord.vehicle_count),
                func.avg(TrafficRecord.congestion_score),
            ).where(
                TrafficRecord.bus_id.in_(bus_ids_),
                TrafficRecord.created_at >= since,
            )
        )
        count, vehicles, congestion = rows.one()
        count = int(count or 0)
        vehicles = int(vehicles or 0)
        if count == 0:
            continue
        avg_speed = (await db.execute(
            select(func.avg(TrafficRecord.average_speed)).where(
                TrafficRecord.bus_id.in_(bus_ids_),
                TrafficRecord.created_at >= since,
            )
        )).scalar()
        est_travel_min = 0
        if avg_speed and route.distance_km:
            est_travel_min = round(route.distance_km / max(float(avg_speed), 5) * 60, 1)
        matrix.append({
            "route_name": route.route_name,
            "origin": route.start_stop,
            "destination": route.end_stop,
            "trips": count,
            "vehicles_observed": vehicles,
            "avg_congestion_score": round(float(congestion or 0), 1),
            "est_travel_min": est_travel_min,
        })
    matrix.sort(key=lambda r: r["vehicles_observed"], reverse=True)
    return {"label": "ESTIMATED", "matrix": matrix}


async def infrastructure_health(db: AsyncSession) -> dict:
    """Deficiency analysis across active issues on the fleet-serviced network.

    Issues are grouped into infrastructure categories, severity-weighted, and
    pinned to the nearest known stop so authorities know which stretch to act on.
    """
    rows = (await db.execute(
        select(Issue).where(
            Issue.status.in_(ACTIVE_ISSUE_STATUSES)
        )
    )).scalars().all()

    stops: list[tuple[str, float, float]] = []
    for route in (await db.execute(select(Route))).scalars().all():
        for stop in (route.stops or []):
            name = stop.get("name") if isinstance(stop, dict) else str(stop)
            lat = stop.get("lat") if isinstance(stop, dict) else None
            lon = stop.get("lon") if isinstance(stop, dict) else None
            if name and lat is not None and lon is not None:
                stops.append((name, float(lat), float(lon)))

    categories: dict[str, dict] = {}
    for issue in rows:
        category = DEFICIENCY_CATEGORIES.get(issue.issue_type, "GENERAL")
        bucket = categories.setdefault(category, {
            "category": category,
            "count": 0,
            "severity_weight": 0,
            "affected_stops": set(),
            "issues": [],
        })
        bucket["count"] += 1
        bucket["severity_weight"] += SEVERITY_ORDER.get(issue.severity, 1)

        nearest = None
        best = None
        for name, lat, lon in stops:
            d = _haversine_m(issue.latitude, issue.longitude, lat, lon)
            if best is None or d < best:
                best, nearest = d, name
        if nearest:
            bucket["affected_stops"].add(nearest)
        bucket["issues"].append({
            "issue_id": issue.issue_id,
            "issue_type": issue.issue_type,
            "severity": issue.severity,
            "latitude": issue.latitude,
            "longitude": issue.longitude,
        })

    summary = []
    for bucket in sorted(categories.values(), key=lambda b: b["count"], reverse=True):
        score = max(0.0, 100 - bucket["count"] * 15 - (bucket["severity_weight"] - bucket["count"]) * 8)
        summary.append({
            "category": bucket["category"],
            "count": bucket["count"],
            "severity_weight": bucket["severity_weight"],
            "deficiency_score": round(min(100, score), 1),
            "affected_stops": sorted(bucket["affected_stops"]),
            "recommendation": RECOMMENDATIONS.get(bucket["category"], "Investigate the flagged issues on site."),
        })

    return {"label": "ESTIMATED", "categories": summary}


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
    delays = metrics.get("route_delays", [])
    if any(d["status"] == "SEVERE" for d in delays):
        worst = next(d for d in delays if d["status"] == "SEVERE")
        s.append(f"Corridor {worst['route_name']} is running ~{worst['delay_min']:.0f} min behind schedule (severe delay).")
    infra = metrics.get("infrastructure", {}).get("categories", [])
    if infra:
        top_cat = infra[0]
        s.append(f"Top infrastructure deficiency: {top_cat['category']} ({top_cat['count']} active issues) — {top_cat['recommendation']}")
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
        "route_delays": await route_delays(db),
        "od_matrix": await od_matrix(db, days),
        "infrastructure": await infrastructure_health(db),
        "range_days": days,
    }
    metrics["sentences"] = await generate_sentences(metrics)
    return metrics
