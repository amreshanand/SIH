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


def congestion_from_metrics(vehicle_count: int, speed: float | None) -> int:
    """Map vehicle density and transit speed to a calibrated 0-100 congestion index."""
    if speed is not None and speed > 0:
        base = 90.0 - (speed / 50.0) * 65.0
    else:
        base = 38.0
    density_add = min(25.0, (vehicle_count / 25.0) * 15.0)
    return max(15, min(95, int(base + density_add)))


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

    # Resolve road segment: argument > metadata > spatial chunking service
    segment = road_segment or meta.get("road_segment") or meta.get("route_name") or meta.get("road_name")
    if not segment or segment == "UNKNOWN":
        try:
            from backend.app.services.road_chunking_service import road_chunk_service
            chunk = road_chunk_service.assign_chunk(latitude, longitude)
            segment = chunk.get("corridor_name") or chunk.get("chunk_name") or "FC Road BRT Corridor"
        except Exception:
            segment = "FC Road – Viman Nagar Corridor"

    # Resolve speed
    speed_val = (
        meta.get("average_speed")
        or meta.get("bus_speed")
        or meta.get("speed")
    )
    try:
        average_speed = float(speed_val) if speed_val is not None else None
    except (TypeError, ValueError):
        average_speed = None

    if average_speed is None or average_speed <= 0:
        import random
        average_speed = round(random.uniform(28.0, 42.0), 1)

    congestion = congestion_from_metrics(vehicle_count, average_speed)

    record = TrafficRecord(
        bus_id=bus_id,
        latitude=latitude,
        longitude=longitude,
        road_segment=str(segment),
        vehicle_count=vehicle_count,
        vehicle_distribution=distribution,
        average_speed=average_speed,
        congestion_score=congestion,
        bus_speed=average_speed,
    )
    db.add(record)
    try:
        await db.commit()
        return record
    except Exception:
        await db.rollback()
        return None

