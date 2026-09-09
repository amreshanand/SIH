"""Traffic record generation for UrbanSense AI.

Traffic analytics (congestion, OD matrix, route delays) are all derived from
``traffic_records``. This service is the single place that turns incoming event
data (or deterministic demo seeds) into TrafficRecord rows so those analytics
have something to render.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models import TrafficRecord

DEFAULT_DISTRIBUTION = {
    "car": 7,
    "motorcycle": 4,
    "bus": 2,
    "truck": 1,
    "bicycle": 2,
    "person": 5,
}


def _clean_distribution(dist: Any) -> dict[str, int] | None:
    if not isinstance(dist, dict) or not dist:
        return None
    cleaned: dict[str, int] = {}
    for k, v in dist.items():
        try:
            cleaned[str(k)] = int(v)
        except (TypeError, ValueError):
            continue
    return cleaned or None


def congestion_from_vehicles(vehicle_count: int) -> int:
    """Map a raw on-road vehicle count to a congestion score (0-100)."""
    if vehicle_count <= 0:
        return 0
    return max(0, min(100, int(10 + (vehicle_count - 2) * 6)))


async def create_traffic_records_for_event(
    event_id: Any,
    bus_id: Any,
    latitude: float,
    longitude: float,
    metadata_json: dict[str, Any] | None,
    db: AsyncSession,
    road_segment: str | None = None,
) -> TrafficRecord | None:
    """Create a TrafficRecord from an ingested event.

    Vehicle distribution is pulled from event metadata when present, otherwise a
    deterministic default is used so every bus detection yields usable traffic
    telemetry for the analytics layer.
    """
    meta = metadata_json or {}
    distribution = _clean_distribution(meta.get("vehicle_distribution"))
    if distribution is None:
        distribution = dict(DEFAULT_DISTRIBUTION)
    vehicle_count = sum(distribution.values())

    # road segment: explicit arg > event metadata > "UNKNOWN"
    segment = road_segment or meta.get("road_segment") or meta.get("route_name")
    if segment is None:
        segment = "UNKNOWN"

    average_speed = meta.get("average_speed") or meta.get("bus_speed")
    try:
        average_speed = float(average_speed)
    except (TypeError, ValueError):
        average_speed = None

    record = TrafficRecord(
        bus_id=bus_id,
        latitude=latitude,
        longitude=longitude,
        road_segment=str(segment),
        vehicle_count=vehicle_count,
        vehicle_distribution=distribution,
        average_speed=average_speed,
        congestion_score=congestion_from_vehicles(vehicle_count),
        bus_speed=average_speed,
    )
    db.add(record)
    try:
        await db.commit()
        return record
    except Exception:
        await db.rollback()
        return None
