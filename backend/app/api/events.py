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
    # Fall through to the bus-number path when the reference isn't a UUID, OR
    # when it parses as a UUID but no such bus exists (e.g. an edge device
    # sending a well-formed-but-unregistered UUID). Otherwise bus.id below would
    # crash with AttributeError.
    if bus is None:
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
    from backend.app.core.config import settings as _settings
    # Reject explicitly-simulated events outside demo mode. Real edge devices
    # never send these; accepting them would silently inject fake data.
    sim_marker = payload.metadata_json.get("simulated") if payload.metadata_json else False
    if not _settings.demo_mode and (
        str(payload.source).upper() == "SIMULATED" or sim_marker
    ):
        raise HTTPException(
            status_code=422,
            detail=f"Event {payload.event_id} is marked simulated and is rejected in production.",
        )
    bus = await _resolve_bus(db, payload.bus_id)
    import uuid as _uuid

    # Real-inference guarantee (Phase 8): outside demo mode a road-damage event
    # MUST carry true YOLO provenance (detection bbox + the model that produced
    # it + the tracked object id). Rejecting anything else prevents non-inferred
    # data from reaching the issue pipeline.
    merged_meta = payload.to_metadata_json()
    if (
        not _settings.demo_mode
        and payload.is_road_damage
        and not payload.has_real_inference()
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                f"Road-damage event {payload.event_id} lacks real-inference "
                "provenance (bbox, source_model and track_id are required)."
            ),
        )

    cam_id = None
    if payload.camera_id:
        try:
            cam_id = _uuid.UUID(str(payload.camera_id))
        except ValueError:
            cam_id = None

    ward = payload.ward or merged_meta.get("ward")
    gps_accuracy = payload.gps_accuracy if payload.gps_accuracy is not None else merged_meta.get("gps_accuracy")
    track_id = payload.track_id if payload.track_id is not None else merged_meta.get("track_id")
    track_age_frames = payload.track_age_frames if payload.track_age_frames is not None else merged_meta.get("track_age_frames")
    consecutive_frames = payload.consecutive_frames if payload.consecutive_frames is not None else merged_meta.get("consecutive_frames")
    fused_score = payload.fused_score if payload.fused_score is not None else merged_meta.get("fused_score")
    road_overlap_ratio = payload.road_overlap_ratio if payload.road_overlap_ratio is not None else merged_meta.get("road_overlap_ratio")

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
        metadata_json=merged_meta,
        source=payload.source,
        ward=ward,
        gps_accuracy=gps_accuracy,
        track_id=track_id,
        track_age_frames=track_age_frames,
        consecutive_frames=consecutive_frames,
        fused_score=fused_score,
        road_overlap_ratio=road_overlap_ratio,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)

    # Traffic telemetry: persist a TrafficRecord so congestion analytics, the
    # OD matrix and route-delay estimates all have data to render. Best-effort —
    # a failure here must never reject the event.
    try:
        from backend.app.services.traffic_service import create_traffic_records_for_event
        from backend.app.models import TrafficRecord
        road_segment = merged_meta.get("road_segment") or merged_meta.get("route_name")
        await create_traffic_records_for_event(
            event_id=event.event_id,
            bus_id=bus.id,
            latitude=event.latitude,
            longitude=event.longitude,
            metadata_json=merged_meta,
            db=db,
            road_segment=road_segment,
        )
    except Exception:
        import logging
        logging.getLogger(__name__).exception(
            "Traffic record creation failed for event %s", event.event_id
        )

    # Audit: every admitted event is logged for provenance/accountability.
    try:
        from backend.app.services.audit_service import log_action
        await log_action(
            user_id=None,
            action="EVENT_CREATED",
            entity_type="EVENT",
            entity_id=event.event_id,
            new_value={
                "event_type": event.event_type,
                "severity": event.severity,
                "confidence": event.confidence,
                "source_model": merged_meta.get("source_model"),
                "track_id": merged_meta.get("track_id"),
                "actor": _actor,
            },
            db=db,
        )
        await db.commit()
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Event audit failed for %s", event.event_id)

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
        from backend.app.services.issue_service import create_or_merge_issue, INCIDENT_EVENT_TYPES
        if payload.event_type in INCIDENT_EVENT_TYPES:
            # High-risk events promote to command-center Incident alerts (plate +
            # GPS + timestamp flow) rather than infrastructure Issues.
            from backend.app.services.incident_service import create_incident_from_event
            incident = await create_incident_from_event(event, db)
            if incident:
                await ws_manager.broadcast("events", {
                    "type": "new_incident",
                    "incident_id": incident.incident_id,
                    "incident_type": incident.incident_type,
                    "severity": incident.severity,
                    "plate_text": incident.plate_text,
                    "latitude": incident.latitude,
                    "longitude": incident.longitude,
                    "bus_id": str(incident.bus_id),
                })
        else:
            issue = await create_or_merge_issue(event, db)
            if issue:
                await ws_manager.broadcast("events", {
                    "type": "issue_updated",
                    "event_id": event.event_id,
                    "issue_id": issue.issue_id,
                    "status": issue.status,
                    "severity": issue.severity,
                    "department": issue.department,
                })
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Issue/incident creation failed for event %s: %s", event.event_id, e)

    return event


@router.get("", response_model=EventListResponse)
async def list_events(
    event_type: Optional[str] = None,
    severity: Optional[str] = None,
    bus_id: Optional[str] = None,
    status: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
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
        import uuid as _uuid
        try:
            bid = _uuid.UUID(str(bus_id))
        except ValueError:
            bus_row = (await db.execute(select(Bus).where(Bus.bus_number == str(bus_id)))).scalar_one_or_none()
            bid = bus_row.id if bus_row else None
        if bid is not None:
            q = q.where(Event.bus_id == bid)
            count_q = count_q.where(Event.bus_id == bid)
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
