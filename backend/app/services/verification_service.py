from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.models import Issue, VerificationRecord
from backend.app.websocket.manager import ws_manager

OBSERVATION_DEDUP_WINDOW_SECONDS = 30


async def process_verification(
    issue_id: uuid.UUID,
    bus_id: uuid.UUID,
    latitude: float,
    longitude: float,
    detection_result: str,
    confidence: float,
    evidence_url: str | None,
    db: AsyncSession,
) -> dict:
    now = datetime.now(timezone.utc)
    dedup_window = timedelta(seconds=settings.observation_dedup_window_seconds)

    # Same-bus dedup: one verification per bus per window.
    same_bus = await db.execute(
        select(func.count(VerificationRecord.id)).where(
            VerificationRecord.issue_id == issue_id,
            VerificationRecord.bus_id == bus_id,
            VerificationRecord.timestamp >= now - dedup_window,
        )
    )
    if (same_bus.scalar() or 0) > 0:
        return {
            "status": "deduplicated",
            "reason": f"Same bus verified within {settings.observation_dedup_window_seconds}s",
        }

    # Min time separation between DISTINCT buses: prevents verification spam from
    # many buses reporting in the same instant (all counting toward the threshold).
    if settings.verification_separation_seconds > 0:
        last_any = await db.execute(
            select(func.max(VerificationRecord.timestamp)).where(
                VerificationRecord.issue_id == issue_id,
            )
        )
        last_ts = last_any.scalar()
        if last_ts is not None:
            min_sep = timedelta(seconds=settings.verification_separation_seconds)
            last_bus = await db.execute(
                select(VerificationRecord.bus_id)
                .where(
                    VerificationRecord.issue_id == issue_id,
                    VerificationRecord.timestamp == last_ts,
                )
                .limit(1)
            )
            last_bid = last_bus.scalar_one_or_none()
            if last_bid != bus_id and (now - last_ts) < min_sep:
                return {
                    "status": "deduplicated",
                    "reason": f"Distinct bus verification arrives within {settings.verification_separation_seconds}s minimum separation",
                }

    record = VerificationRecord(
        issue_id=issue_id,
        bus_id=bus_id,
        latitude=latitude,
        longitude=longitude,
        detection_result=detection_result,
        confidence=confidence,
        evidence_url=evidence_url,
    )
    db.add(record)

    issue_result = await db.execute(select(Issue).where(Issue.id == issue_id))
    issue = issue_result.scalar_one_or_none()
    if not issue:
        await db.commit()
        return {"status": "issue_not_found"}

    # SQL-level unique-bus aggregation (no python post-hoc dedup).
    distinct_clear = await db.execute(
        select(
            func.count(func.distinct(VerificationRecord.bus_id)).filter(
                VerificationRecord.detection_result == "CLEAR"
            ),
            func.count(func.distinct(VerificationRecord.bus_id)).filter(
                VerificationRecord.detection_result == "DETECTED"
            ),
        ).where(VerificationRecord.issue_id == issue_id)
    )
    unique_clear, unique_detected = distinct_clear.one()
    unique_clear = int(unique_clear or 0)
    unique_detected = int(unique_detected or 0)

    threshold = settings.verification_clear_threshold
    transitioned = False
    old_status = issue.status

    if issue.status == "RESOLVED" and unique_detected >= settings.verification_reopen_threshold:
        issue.status = "REOPENED"
        record.result = "REOPENED"
        transitioned = True
    elif issue.status in ("OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_VERIFICATION", "REOPENED"):
        if unique_clear >= threshold:
            issue.status = "RESOLVED"
            record.result = "RESOLVED"
            transitioned = True
        elif unique_detected >= 2 and issue.status == "OPEN":
            issue.status = "PENDING_VERIFICATION"
            record.result = "CONFIRMED"
            transitioned = True
        else:
            record.result = "PENDING"

    issue.updated_at = now

    if transitioned:
        from backend.app.services.audit_service import log_action
        await log_action(
            user_id=None,
            action="STATUS_CHANGED",
            entity_type="ISSUE",
            entity_id=issue.issue_id,
            old_value={"status": old_status},
            new_value={"status": issue.status, "via": "verification"},
            db=db,
        )
    await db.commit()
    await db.refresh(record)

    if transitioned:
        event_type = {
            "RESOLVED": "issue_resolved",
            "REOPENED": "issue_reopened",
            "PENDING_VERIFICATION": "issue_pending_verification",
        }.get(issue.status, "issue_updated")
        await ws_manager.broadcast("events", {
            "type": event_type,
            "issue_id": issue.issue_id,
            "status": issue.status,
            "unique_clear_count": unique_clear,
            "unique_detected_count": unique_detected,
        })

    return {
        "verification_id": str(record.id),
        "result": record.result,
        "unique_clear_count": unique_clear,
        "unique_detected_count": unique_detected,
        "issue_status": issue.status,
    }
