from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import require_auth
from backend.app.database.session import get_db
from backend.app.models import Notification
from backend.app.schemas.notification import NotificationListResponse, NotificationResponse

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    user_id: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    q = select(Notification)
    if user_id:
        q = q.where(Notification.user_id == user_id)

    total_result = await db.execute(select(func.count(Notification.id)))
    total = total_result.scalar() or 0

    unread_q = select(func.count(Notification.id)).where(Notification.read == False)
    if user_id:
        unread_q = unread_q.where(Notification.user_id == user_id)
    unread = (await db.execute(unread_q)).scalar() or 0

    q = q.order_by(Notification.created_at.desc()).limit(50)
    result = await db.execute(q)
    notifications = list(result.scalars().all())

    return {"notifications": notifications, "total": total, "unread": unread}


@router.patch("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_auth),
) -> dict:
    try:
        nid = uuid.UUID(notification_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid notification ID")
    result = await db.execute(select(Notification).where(Notification.id == nid))
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.read = True
    await db.commit()
    return {"status": "read"}
