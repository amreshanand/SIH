from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import edge_or_user, rate_limit_events
from backend.app.database.session import get_db
from backend.app.models import Bus, Event
from backend.app.schemas.event import EventCreate, EventListResponse, EventResponse
from backend.app.websocket.manager import ws_manager

router = APIRouter(prefix="/events", tags=["Events"])


async def _resolve_bus(db: AsyncSession, bus_ref: str):
    """Resolve a bus UUID or number to a Bus entity, auto-registering unknown
    bus numbers on first sight so edge devices can upload without knowing ids."""
    import uuid as _uuid
    try:
        bid = _uuid.UUID(str(bus_ref))
        bus = (await db.execute(select(Bus).where(Bus.id == bid))).scalar_one_or_none()
    except ValueError:
        bid = None
        bus = None
    if bus is None and bid is None:
        bus = (await db.execute(select(Bus).where(Bus.bus_number == str(bus_ref)))).scalar_one_or_none()
        if bus is None:
            bus = Bus(bus_number=str(bus_ref), status="ACTIVE")
            db.add(bus)
            await db.flush()
    return bus


@router.post("", response_model=EventResponse, status_code=201)
async def create_event(
    payload: EventCreate,
    db: AsyncSession = Depends(get_db),
    _actor: str = Depends(edge_or_user),
    _rl: None = Depends(rate_limit_events),
) -> Event:
    bus = await _resolve_bus(db, payload.bus_id)
    import uuid as _uuid
    cam_id = None
    if payload.camera_id:
        try:
            cam_id = _uuid.UUID(str(payload.camera_id))
        except ValueError:
            cam_id = None
    event = Event(
        event_id=payload.event_id,
        event_type=payload.event_type,
        bus_id=bus.id,
        camera_id=cam_id,
        severity=payload.severity,
        confidence=payload.confidence,
        latitude=payload.latitude,
        longitude=payload.longitude,
        evidence_url=payload.evidence_url,
        metadata_json=payload.metadata_json,
        source=payload.source,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)

    await ws_manager.broadcast("events", {
        "type": "new_event",
        "event_id": event.event_id,
        "event_type": event.event_type,
        "severity": event.severity,
        "confidence": event.confidence,
        "latitude": event.latitude,
        "longitude": event.longitude,
        "bus_id": str(event.bus_id),
        "source": event.source,
        "timestamp": event.created_at.isoformat(),
    })

    try:
        from backend.app.services.issue_service import create_or_merge_issue
        issue = await create_or_merge_issue(event, db)
        if issue:
            await ws_manager.broadcast("events", {
                "type": "issue_updated",
                "issue_id": issue.issue_id,
                "status": issue.status,
                "severity": issue.severity,
                "department": issue.department,
            })
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Issue creation failed for event %s: %s", event.event_id, e)

    return event


@router.get("", response_model=EventListResponse)
async def list_events(
    event_type: Optional[str] = None,
    severity: Optional[str] = None,
    bus_id: Optional[str] = None,
    status: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> dict:
    q = select(Event)
    count_q = select(func.count(Event.id))

    if event_type:
        q = q.where(Event.event_type == event_type)
        count_q = count_q.where(Event.event_type == event_type)
    if severity:
        q = q.where(Event.severity == severity)
        count_q = count_q.where(Event.severity == severity)
    if bus_id:
        q = q.where(Event.bus_id == bus_id)
        count_q = count_q.where(Event.bus_id == bus_id)
    if status:
        q = q.where(Event.status == status)
        count_q = count_q.where(Event.status == status)

    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    q = q.order_by(Event.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(q)
    events = list(result.scalars().all())

    return {"events": events, "total": total}


@router.get("/{event_id}", response_model=EventResponse)
async def get_event(event_id: str, db: AsyncSession = Depends(get_db)) -> Event:
    result = await db.execute(select(Event).where(Event.event_id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail=f"Event {event_id} not found")
    return event
