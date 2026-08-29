from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import edge_or_user
from backend.app.database.session import get_db
from backend.app.models import Incident
from backend.app.schemas.incident import IncidentCreate, IncidentListResponse, IncidentResponse
from backend.app.websocket.manager import ws_manager

router = APIRouter(prefix="/incidents", tags=["Incidents"])


@router.post("", response_model=IncidentResponse, status_code=201)
async def create_incident(
    payload: IncidentCreate,
    db: AsyncSession = Depends(get_db),
    _actor: str = Depends(edge_or_user),
) -> Incident:
    incident = Incident(
        incident_id=payload.incident_id,
        incident_type=payload.incident_type,
        bus_id=payload.bus_id,
        camera_id=payload.camera_id,
        severity=payload.severity,
        confidence=payload.confidence,
        latitude=payload.latitude,
        longitude=payload.longitude,
        plate_text=payload.plate_text,
        plate_confidence=payload.plate_confidence,
        evidence_url=payload.evidence_url,
        vehicle_track_id=payload.vehicle_track_id,
    )
    db.add(incident)
    await db.commit()
    await db.refresh(incident)

    await ws_manager.broadcast("events", {
        "type": "incident_detected",
        "incident_id": incident.incident_id,
        "incident_type": incident.incident_type,
        "severity": incident.severity,
        "latitude": incident.latitude,
        "longitude": incident.longitude,
    })
    return incident


@router.get("", response_model=IncidentListResponse)
async def list_incidents(
    incident_type: Optional[str] = None,
    severity: Optional[str] = None,
    status: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> dict:
    q = select(Incident)
    count_q = select(func.count(Incident.id))

    if incident_type:
        q = q.where(Incident.incident_type == incident_type)
        count_q = count_q.where(Incident.incident_type == incident_type)
    if severity:
        q = q.where(Incident.severity == severity)
        count_q = count_q.where(Incident.severity == severity)
    if status:
        q = q.where(Incident.status == status)
        count_q = count_q.where(Incident.status == status)

    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    q = q.order_by(Incident.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(q)
    incidents = list(result.scalars().all())

    return {"incidents": incidents, "total": total}


@router.get("/{incident_id}", response_model=IncidentResponse)
async def get_incident(incident_id: str, db: AsyncSession = Depends(get_db)) -> Incident:
    import uuid as _uuid
    q = select(Incident).where(Incident.incident_id == incident_id)
    try:
        iid = _uuid.UUID(str(incident_id))
        q = select(Incident).where((Incident.incident_id == incident_id) | (Incident.id == iid))
    except ValueError:
        pass
    result = await db.execute(q.limit(2))
    incident = result.scalars().first()
    if not incident:
        raise HTTPException(status_code=404, detail=f"Incident {incident_id} not found")
    return incident
