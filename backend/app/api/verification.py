from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import edge_or_user, rate_limit_verification
from backend.app.database.session import get_db
from backend.app.models import Issue, VerificationRecord
from backend.app.schemas.verification import VerificationCreate, VerificationResponse
from backend.app.services.verification_service import process_verification
from backend.app.websocket.manager import ws_manager

router = APIRouter(prefix="/verification", tags=["Verification"])
logger = logging.getLogger(__name__)


@router.post("", response_model=VerificationResponse, status_code=201)
async def create_verification(
    payload: VerificationCreate,
    db: AsyncSession = Depends(get_db),
    _actor: str = Depends(edge_or_user),
    _rl: None = Depends(rate_limit_verification),
) -> dict:
    issue_result = await db.execute(select(Issue).where(Issue.id == payload.issue_id))
    issue = issue_result.scalar_one_or_none()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    result = await process_verification(
        issue_id=payload.issue_id,
        bus_id=payload.bus_id,
        latitude=payload.latitude,
        longitude=payload.longitude,
        detection_result=payload.detection_result,
        confidence=payload.confidence,
        evidence_url=payload.evidence_url,
        db=db,
    )

    await ws_manager.broadcast("events", {
        "type": "verification",
        "issue_id": str(payload.issue_id),
        "bus_id": str(payload.bus_id),
        "result": payload.detection_result,
        "confidence": payload.confidence,
        "issue_status": result.get("issue_status"),
    })

    return {
        "issue_id": str(payload.issue_id),
        "bus_id": str(payload.bus_id),
        "detection_result": payload.detection_result,
        "confidence": payload.confidence,
        "result": result.get("result", "PENDING"),
    }


@router.get("/issue/{issue_id}", response_model=list[VerificationResponse])
async def get_verification_history(
    issue_id: str, db: AsyncSession = Depends(get_db)
) -> list[dict]:
    try:
        iid = uuid.UUID(issue_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid issue ID")
    result = await db.execute(
        select(VerificationRecord)
        .where(VerificationRecord.issue_id == iid)
        .order_by(VerificationRecord.timestamp.desc())
    )
    records = list(result.scalars().all())
    return [
        {
            "issue_id": str(r.issue_id),
            "bus_id": str(r.bus_id),
            "detection_result": r.detection_result,
            "confidence": r.confidence,
            "result": r.result,
        }
        for r in records
    ]
