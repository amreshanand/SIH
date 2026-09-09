from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from datetime import datetime, timezone

from backend.app.api.deps import require_admin
from backend.app.database.session import get_db
from backend.app.models import Bus, Camera, Event, GPSPoint, Route, User
from backend.app.schemas.bus import (
    BusCreate,
    BusLocationResponse,
    BusResponse,
    CameraResponse,
    RouteCreate,
    RouteResponse,
    TelemetryCreate,
)
from backend.app.websocket.manager import ws_manager

router = APIRouter(prefix="/buses", tags=["Buses"])


async def _latest_gps_locations(db: AsyncSession) -> dict[uuid.UUID, GPSPoint]:
    """Most recent GPSPoint per bus."""
    latest = (
        select(GPSPoint.bus_id, func.max(GPSPoint.timestamp).label("last_ts"))
        .group_by(GPSPoint.bus_id)
        .subquery()
    )
    result = await db.execute(
        select(GPSPoint).join(
            latest,
            (GPSPoint.bus_id == latest.c.bus_id) & (GPSPoint.timestamp == latest.c.last_ts),
        )
    )
    return {p.bus_id: p for p in result.scalars().all()}


async def _latest_event_locations(db: AsyncSession) -> dict[uuid.UUID, Event]:
    """Most recent Event per bus (fallback GPS source)."""
    latest = (
        select(Event.bus_id, func.max(Event.created_at).label("last_ts"))
        .group_by(Event.bus_id)
        .subquery()
    )
    result = await db.execute(
        select(Event).join(
            latest,
            (Event.bus_id == latest.c.bus_id) & (Event.created_at == latest.c.last_ts),
        )
    )
    return {e.bus_id: e for e in result.scalars().all()}


def _bus_location(bus: Bus, event: Event | None, gps: GPSPoint | None = None) -> dict:
    if gps is not None:
        return {
            "bus_id": str(bus.id),
            "bus_number": bus.bus_number,
            "status": bus.status,
            "route_id": str(bus.route_id) if bus.route_id else None,
            "latitude": gps.latitude,
            "longitude": gps.longitude,
            "speed": gps.speed,
            "heading": gps.heading,
            "last_updated": gps.timestamp,
            "source": "GPS_TELEMETRY",
        }
    return {
        "bus_id": str(bus.id),
        "bus_number": bus.bus_number,
        "status": bus.status,
        "route_id": str(bus.route_id) if bus.route_id else None,
        "latitude": event.latitude if event else None,
        "longitude": event.longitude if event else None,
        "speed": None,
        "heading": None,
        "last_updated": event.created_at.isoformat() if event else None,
        "source": event.source if event else None,
    }


@router.post("", response_model=BusResponse, status_code=201)
async def create_bus(
    payload: BusCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> Bus:
    bus = Bus(bus_number=payload.bus_number, route_id=payload.route_id, status=payload.status)
    db.add(bus)
    await db.commit()
    await db.refresh(bus)
    return bus


@router.get("", response_model=list[BusResponse])
async def list_buses(db: AsyncSession = Depends(get_db)) -> list[Bus]:
    result = await db.execute(select(Bus).order_by(Bus.bus_number))
    return list(result.scalars().all())


# NOTE: declared BEFORE "/{bus_id}" so an exact-match /locations is not
# swallowed by the generic slug and rejected as an invalid UUID.
@router.get("/locations", response_model=list[BusLocationResponse])
async def list_bus_locations(db: AsyncSession = Depends(get_db)) -> list[dict]:
    buses = (await db.execute(select(Bus).order_by(Bus.bus_number))).scalars().all()
    latest_gps = await _latest_gps_locations(db)
    latest_events = await _latest_event_locations(db)
    return [_bus_location(bus, latest_events.get(bus.id), latest_gps.get(bus.id)) for bus in buses]


@router.get("/{bus_id}", response_model=BusResponse)
async def get_bus(bus_id: str, db: AsyncSession = Depends(get_db)) -> Bus:
    try:
        bid = uuid.UUID(bus_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid bus ID")
    result = await db.execute(select(Bus).where(Bus.id == bid))
    bus = result.scalar_one_or_none()
    if not bus:
        raise HTTPException(status_code=404, detail=f"Bus {bus_id} not found")
    return bus


@router.get("/{bus_id}/location", response_model=BusLocationResponse)
async def get_bus_location(bus_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    try:
        bid = uuid.UUID(bus_id)
    except ValueError:
        bid = None
    if bid is not None:
        result = await db.execute(select(Bus).where(Bus.id == bid))
        bus = result.scalar_one_or_none()
    else:
        bus = None
    if bus is None:
        result = await db.execute(select(Bus).where(Bus.bus_number == str(bus_id)))
        bus = result.scalar_one_or_none()
    if not bus:
        raise HTTPException(status_code=404, detail=f"Bus {bus_id} not found")
    latest_gps = await _latest_gps_locations(db)
    latest_events = await _latest_event_locations(db)
    return _bus_location(bus, latest_events.get(bus.id), latest_gps.get(bus.id))


@router.post("/{bus_id}/telemetry", status_code=201)
async def ingest_telemetry(
    bus_id: str,
    payload: TelemetryCreate,
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        bid = uuid.UUID(bus_id)
    except ValueError:
        bid = None

    if bid is not None:
        result = await db.execute(select(Bus).where(Bus.id == bid))
        bus = result.scalar_one_or_none()
    else:
        bus = None

    if bus is None:
        result = await db.execute(select(Bus).where(Bus.bus_number == str(bus_id)))
        bus = result.scalar_one_or_none()

    if not bus:
        raise HTTPException(status_code=404, detail=f"Bus {bus_id} not found")

    ts = payload.timestamp or datetime.now(timezone.utc).isoformat()
    gps_point = GPSPoint(
        bus_id=bus.id,
        latitude=payload.latitude,
        longitude=payload.longitude,
        speed=payload.speed,
        heading=payload.heading,
        timestamp=ts,
    )
    db.add(gps_point)
    await db.commit()
    await db.refresh(gps_point)

    telemetry_data = {
        "bus_id": str(bus.id),
        "bus_number": bus.bus_number,
        "latitude": gps_point.latitude,
        "longitude": gps_point.longitude,
        "speed": gps_point.speed,
        "heading": gps_point.heading,
        "timestamp": gps_point.timestamp,
        "status": bus.status,
    }

    # Broadcast live location update to WebSocket "buses" channel
    await ws_manager.broadcast("buses", {"type": "telemetry", "data": telemetry_data})

    return {
        "status": "success",
        "telemetry": telemetry_data,
    }


@router.get("/{bus_id}/cameras", response_model=list[CameraResponse])
async def get_bus_cameras(bus_id: str, db: AsyncSession = Depends(get_db)) -> list[Camera]:
    try:
        bid = uuid.UUID(bus_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid bus ID")
    result = await db.execute(select(Camera).where(Camera.bus_id == bid))
    return list(result.scalars().all())



@router.post("/routes", response_model=RouteResponse, status_code=201)
async def create_route(
    payload: RouteCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> Route:
    route = Route(
        route_name=payload.route_name,
        start_stop=payload.start_stop,
        end_stop=payload.end_stop,
        stops=payload.stops,
        distance_km=payload.distance_km,
        scheduled_duration_min=payload.scheduled_duration_min,
    )
    db.add(route)
    await db.commit()
    await db.refresh(route)
    return route


@router.get("/routes/all", response_model=list[RouteResponse])
async def list_routes(db: AsyncSession = Depends(get_db)) -> list[Route]:
    result = await db.execute(select(Route).order_by(Route.route_name))
    return list(result.scalars().all())
