from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import require_auth
from backend.app.database.session import get_db
from backend.app.models import Issue, IssueResolution, User
from backend.app.schemas.issue import (
    IssueAssignmentCreate,
    IssueAssignmentResponse,
    IssueListResponse,
    IssueResponse,
    IssueUpdate,
)
from backend.app.services.issue_service import get_valid_transitions, validate_transition
from backend.app.services.audit_service import log_action
from backend.app.websocket.manager import ws_manager

router = APIRouter(prefix="/issues", tags=["Issues"])


async def _resolve_issue(db: AsyncSession, ref: str):
    """Resolve an issue by its human-readable issue_id OR its UUID id.

    Frontend detail pages may link with either, so accept both to avoid 404s.
    """
    import uuid as _uuid
    q = select(Issue).where(Issue.issue_id == ref)
    try:
        ref_uuid = _uuid.UUID(str(ref))
        q = select(Issue).where((Issue.issue_id == ref) | (Issue.id == ref_uuid))
    except ValueError:
        pass
    result = await db.execute(q.limit(2))
    return result.scalars().first()


@router.get("", response_model=IssueListResponse)
async def list_issues(
    status: Optional[str] = None,
    issue_type: Optional[str] = None,
    severity: Optional[str] = None,
    department: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(150, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
) -> dict:
    q = select(Issue)
    count_q = select(func.count(Issue.id))

    if status:
        q = q.where(Issue.status == status)
        count_q = count_q.where(Issue.status == status)
    if issue_type:
        from backend.app.schemas.event import normalize_event_type
        norm_type = normalize_event_type(issue_type)
        if norm_type != issue_type:
            q = q.where((Issue.issue_type == issue_type) | (Issue.issue_type == norm_type))
            count_q = count_q.where((Issue.issue_type == issue_type) | (Issue.issue_type == norm_type))
        else:
            q = q.where(Issue.issue_type == issue_type)
            count_q = count_q.where(Issue.issue_type == issue_type)
    if severity:
        q = q.where(Issue.severity == severity)
        count_q = count_q.where(Issue.severity == severity)
    if department:
        q = q.where(Issue.department == department)
        count_q = count_q.where(Issue.department == department)

    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    q = q.order_by(Issue.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(q)
    issues = list(result.scalars().all())

    return {"issues": issues, "total": total}


@router.get("/{issue_id}", response_model=IssueResponse)
async def get_issue(issue_id: str, db: AsyncSession = Depends(get_db)) -> Issue:
    issue = await _resolve_issue(db, issue_id)
    if not issue:
        raise HTTPException(status_code=404, detail=f"Issue {issue_id} not found")

    from backend.app.models import IssueEvent, Event
    # Fetch up to 3 distinct evidence frames linked to this issue via events
    stmt = (
        select(Event.evidence_url)
        .join(IssueEvent, IssueEvent.event_id == Event.id)
        .where(IssueEvent.issue_id == issue.id)
        .where(Event.evidence_url.is_not(None))
        .order_by(IssueEvent.created_at)
        .limit(3)
    )
    res = await db.execute(stmt)
    # Deduplicate while preserving order
    seen: set[str] = set()
    evidence_urls: list[str] = []
    for (url,) in res.all():
        if url not in seen:
            seen.add(url)
            evidence_urls.append(url)

    # Supplement (or replace) with evidence stored in issue's metadata_json
    # This ensures we always show up to 3 real images
    if issue.metadata_json:
        stored = issue.metadata_json.get("evidence_urls", [])
        for u in stored:
            if u and u not in seen and len(evidence_urls) < 3:
                seen.add(u)
                evidence_urls.append(u)

    issue.evidence_urls = evidence_urls

    return issue




@router.get("/{issue_id}/timeline")
async def get_issue_timeline(issue_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    from backend.app.models import IssueAssignment, IssueEvent, VerificationRecord

    issue = await _resolve_issue(db, issue_id)
    if not issue:
        raise HTTPException(status_code=404, detail=f"Issue {issue_id} not found")

    events_r = await db.execute(
        select(IssueEvent).where(IssueEvent.issue_id == issue.id).order_by(IssueEvent.created_at)
    )
    issue_events = list(events_r.scalars().all())

    assignments_r = await db.execute(
        select(IssueAssignment).where(IssueAssignment.issue_id == issue.id).order_by(IssueAssignment.created_at)
    )
    assignments = list(assignments_r.scalars().all())

    verifications_r = await db.execute(
        select(VerificationRecord).where(VerificationRecord.issue_id == issue.id).order_by(VerificationRecord.timestamp)
    )
    verifications = list(verifications_r.scalars().all())

    timeline = []
    timeline.append({
        "type": "CREATED",
        "timestamp": issue.created_at.isoformat() if issue.created_at else None,
        "data": {"issue_type": issue.issue_type, "severity": issue.severity},
    })

    for a in assignments:
        timeline.append({
            "type": "ASSIGNED",
            "timestamp": a.created_at.isoformat() if a.created_at else None,
            "data": {"authority_id": str(a.authority_id), "status": a.status, "notes": a.notes},
        })

    for v in verifications:
        timeline.append({
            "type": "VERIFICATION",
            "timestamp": v.timestamp.isoformat() if v.timestamp else None,
            "data": {"result": v.detection_result, "bus_id": str(v.bus_id), "confidence": v.confidence},
        })

    timeline.sort(key=lambda x: x["timestamp"] or "")

    return {
        "issue_id": issue.issue_id,
        "status": issue.status,
        "timeline": timeline,
    }


@router.get("/{issue_id}/resolution-history")
async def get_issue_resolution_history(
    issue_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Append-only resolution lifecycle for an issue.

    Serves the full audit trail (creation → assignment → status changes →
    resolution) used by the Authority Performance dashboard and the audit
    requirement.
    """
    issue = await _resolve_issue(db, issue_id)
    if not issue:
        raise HTTPException(status_code=404, detail=f"Issue {issue_id} not found")

    result = await db.execute(
        select(IssueResolution)
        .where(IssueResolution.issue_id == issue.id)
        .order_by(IssueResolution.created_at)
    )
    history = list(result.scalars().all())

    return {
        "issue_id": issue.issue_id,
        "status": issue.status,
        "history": [
            {
                "action": h.action,
                "from_status": h.from_status,
                "to_status": h.to_status,
                "notes": h.notes,
                "authority_id": str(h.authority_id) if h.authority_id else None,
                "timestamp": h.created_at.isoformat() if h.created_at else None,
            }
            for h in history
        ],
    }


@router.patch("/{issue_id}", response_model=IssueResponse)
async def update_issue(
    issue_id: str,
    payload: IssueUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_auth),
) -> Issue:
    issue = await _resolve_issue(db, issue_id)
    if not issue:
        raise HTTPException(status_code=404, detail=f"Issue {issue_id} not found")

    update_data = payload.model_dump(exclude_unset=True)

    if "status" in update_data and update_data["status"] != issue.status:
        if not validate_transition(issue.status, update_data["status"]):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid transition: {issue.status} → {update_data['status']}. "
                       f"Valid: {get_valid_transitions(issue.status)}",
            )

    old_status = issue.status
    for key, value in update_data.items():
        setattr(issue, key, value)
    issue.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(issue)

    await log_action(
        user_id=_user.id,
        action="STATUS_CHANGED",
        entity_type="ISSUE",
        entity_id=issue.issue_id,
        old_value={"status": old_status},
        new_value={"status": issue.status},
        db=db,
    )
    db.add(IssueResolution(
        issue_id=issue.id,
        action="STATUS_CHANGED",
        from_status=old_status,
        to_status=issue.status,
        authority_id=_user.id,
    ))
    await db.commit()

    await ws_manager.broadcast("events", {
        "type": "issue_updated",
        "issue_id": issue.issue_id,
        "status": issue.status,
        "severity": issue.severity,
        "department": issue.department,
    })
    return issue


@router.post("/{issue_id}/assign", response_model=IssueAssignmentResponse, status_code=201)
async def assign_issue(
    issue_id: str,
    payload: IssueAssignmentCreate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_auth),
) -> "IssueAssignment":
    from backend.app.models import IssueAssignment

    issue = await _resolve_issue(db, issue_id)
    if not issue:
        raise HTTPException(status_code=404, detail=f"Issue {issue_id} not found")

    if not validate_transition(issue.status, "ASSIGNED"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot assign issue in status {issue.status}",
        )

    assignment = IssueAssignment(
        issue_id=issue.id,
        authority_id=payload.authority_id,
        notes=payload.notes,
        status="ASSIGNED",
    )
    db.add(assignment)

    old_status = issue.status
    issue.status = "ASSIGNED"
    issue.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(assignment)

    await log_action(
        user_id=payload.authority_id,
        action="ASSIGNED",
        entity_type="ISSUE",
        entity_id=issue.issue_id,
        old_value={"status": old_status},
        new_value={"status": "ASSIGNED", "authority_id": str(payload.authority_id)},
        metadata={"notes": payload.notes},
        db=db,
    )
    db.add(IssueResolution(
        issue_id=issue.id,
        action="ASSIGNED",
        from_status=old_status,
        to_status="ASSIGNED",
        authority_id=payload.authority_id,
        notes=payload.notes,
    ))
    await db.commit()

    await ws_manager.broadcast("events", {
        "type": "issue_assigned",
        "issue_id": issue.issue_id,
        "authority_id": str(payload.authority_id),
    })
    return assignment
