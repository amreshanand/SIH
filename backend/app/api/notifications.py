from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import require_auth
from backend.app.database.session import get_db
from backend.app.models import Notification, User
from backend.app.schemas.notification import NotificationListResponse, NotificationResponse

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict:
    q = select(Notification).where(Notification.user_id == user.id)
    total_q = select(func.count(Notification.id)).where(Notification.user_id == user.id)
    unread_q = select(func.count(Notification.id)).where(
        Notification.user_id == user.id, Notification.read == False
    )

    total = (await db.execute(total_q)).scalar() or 0
    unread = (await db.execute(unread_q)).scalar() or 0

    q = q.order_by(Notification.created_at.desc()).limit(50)
    result = await db.execute(q)
    notifications = list(result.scalars().all())

    return {"notifications": notifications, "total": total, "unread": unread}


@router.patch("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_auth),
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


@router.post("/read-all")
async def mark_all_read(
    user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict:
    from sqlalchemy import update
    await db.execute(
        update(Notification).where(Notification.user_id == user.id, Notification.read == False).values(read=True)
    )
    await db.commit()
    return {"status": "all_read"}

