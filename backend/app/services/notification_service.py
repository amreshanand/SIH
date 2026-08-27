from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models import Notification, User
from backend.app.websocket.manager import ws_manager


async def create_notification(
    user_id: str,
    notification_type: str,
    title: str,
    body: str,
    metadata: dict | None,
    db: AsyncSession,
) -> Notification:
    notif = Notification(
        user_id=uuid.UUID(user_id) if isinstance(user_id, str) else user_id,
        notification_type=notification_type,
        title=title,
        body=body,
        metadata_json=metadata,
    )
    db.add(notif)
    await db.commit()
    await db.refresh(notif)

    await ws_manager.broadcast("notifications", {
        "type": "notification",
        "title": title,
        "body": body,
        "notification_type": notification_type,
    })
    return notif


async def create_incident_notification(
    issue_id: str,
    issue_type: str,
    severity: str,
    confidence: float,
    latitude: float,
    longitude: float,
    bus_id: str,
    department: str | None,
    db: AsyncSession,
) -> None:
    result = await db.execute(select(User).where(User.role == "AUTHORITY"))
    authorities = result.scalars().all()

    for auth in authorities:
        if department and auth.department and auth.department != department:
            continue
        await create_notification(
            user_id=str(auth.id),
            notification_type="NEW_ISSUE",
            title=f"NEW {severity} ISSUE: {issue_type}",
            body=f"Detected by {bus_id}\nGPS: {latitude:.4f}, {longitude:.4f}\nConfidence: {confidence:.0%}",
            metadata={"issue_id": issue_id, "severity": severity},
            db=db,
        )
