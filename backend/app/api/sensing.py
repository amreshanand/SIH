from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import require_auth
from backend.app.database.session import get_db
from backend.app.models import SensingSession

router = APIRouter(prefix="/sensing", tags=["Sensing"])


class SessionStart(BaseModel):
    session_id: str
    bus_id: str
    camera_id: str
    gps_source: str = "simulated"
    ai_mode: str = "mock"
    model_name: Optional[str] = None
    metadata: Optional[dict] = None


class SessionUpdate(BaseModel):
    frame_count: Optional[int] = None
    event_count: Optional[int] = None
    upload_count: Optional[int] = None
    error_count: Optional[int] = None
    status: Optional[str] = None
    gps_source: Optional[str] = None
    ai_mode: Optional[str] = None


@router.post("/sessions/start")
async def start_session(
    payload: SessionStart,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_auth),
) -> dict:
    existing = await db.execute(
        select(SensingSession).where(SensingSession.session_id == payload.session_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Session already exists")
    session = SensingSession(
        session_id=payload.session_id,
        bus_id=payload.bus_id,
        camera_id=payload.camera_id,
        started_at=datetime.now(timezone.utc),
        gps_source=payload.gps_source,
        ai_mode=payload.ai_mode,
        model_name=payload.model_name,
        metadata_json=payload.metadata,
        status="ACTIVE",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return {"session_id": session.session_id, "status": session.status}


@router.post("/sessions/{session_id}/update")
async def update_session(
    session_id: str,
    payload: SessionUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_auth),
) -> dict:
    result = await db.execute(select(SensingSession).where(SensingSession.session_id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if payload.frame_count is not None:
        session.frame_count = payload.frame_count
    if payload.event_count is not None:
        session.event_count = payload.event_count
    if payload.upload_count is not None:
        session.upload_count = payload.upload_count
    if payload.error_count is not None:
        session.error_count = payload.error_count
    if payload.status is not None:
        session.status = payload.status
    if payload.gps_source is not None:
        session.gps_source = payload.gps_source
    if payload.ai_mode is not None:
        session.ai_mode = payload.ai_mode
    await db.commit()
    await db.refresh(session)
    return {
        "session_id": session.session_id,
        "status": session.status,
        "frame_count": session.frame_count,
        "event_count": session.event_count,
        "upload_count": session.upload_count,
        "error_count": session.error_count,
    }


@router.post("/sessions/{session_id}/close")
async def close_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_auth),
) -> dict:
    result = await db.execute(select(SensingSession).where(SensingSession.session_id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.ended_at = datetime.now(timezone.utc)
    session.status = "CLOSED"
    await db.commit()
    await db.refresh(session)
    return {
        "session_id": session.session_id,
        "status": "CLOSED",
        "duration_seconds": max(0, (session.ended_at - session.started_at).total_seconds()),
        "frame_count": session.frame_count,
        "event_count": session.event_count,
        "upload_count": session.upload_count,
        "error_count": session.error_count,
    }


@router.get("/sessions/active")
async def active_sessions(db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(
        select(SensingSession).where(SensingSession.status == "ACTIVE").order_by(SensingSession.started_at.desc())
    )
    sessions = list(result.scalars().all())
    return {"total": len(sessions), "sessions": sessions}


@router.get("/sessions")
async def list_sessions(
    bus_id: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
) -> dict:
    q = select(SensingSession)
    count_q = select(func.count(SensingSession.id))
    if bus_id:
        q = q.where(SensingSession.bus_id == bus_id)
        count_q = count_q.where(SensingSession.bus_id == bus_id)
    total = (await db.execute(count_q)).scalar() or 0
    q = q.order_by(SensingSession.started_at.desc()).offset(skip).limit(limit)
    sessions = list((await db.execute(q)).scalars().all())
    return {"total": total, "sessions": sessions}
