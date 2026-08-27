from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import require_admin
from backend.app.database.session import get_db
from backend.app.models import Bus, Camera, Route
from backend.app.schemas.bus import BusCreate, BusResponse, CameraResponse, RouteCreate, RouteResponse

router = APIRouter(prefix="/buses", tags=["Buses"])


@router.post("", response_model=BusResponse, status_code=201)
async def create_bus(
    payload: BusCreate,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
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
    _admin: dict = Depends(require_admin),
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
