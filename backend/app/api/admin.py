from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import require_admin, require_auth
from backend.app.database.session import get_db
from backend.app.models import AuditLog, User
from backend.app.services.audit_service import log_action

router = APIRouter(prefix="/admin", tags=["Admin"])


class UserResponse(BaseModel):
    id: str
    username: str
    role: str
    department: Optional[str] = None
    created_at: Optional[str] = None


class UserListResponse(BaseModel):
    users: list[UserResponse]
    total: int


class UserCreateRequest(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=8, max_length=256)
    role: str = Field(pattern="^(ADMIN|AUTHORITY|VIEWER)$")


class RoleUpdateRequest(BaseModel):
    role: str = Field(pattern="^(ADMIN|AUTHORITY|VIEWER)$")


class AuditLogResponse(BaseModel):
    id: str
    user_id: Optional[str] = None
    username: Optional[str] = None
    action: str
    entity_type: str
    entity_id: str
    old_value: Optional[dict] = None
    new_value: Optional[dict] = None
    metadata_json: Optional[dict] = None
    created_at: str


class AuditLogListResponse(BaseModel):
    logs: list[AuditLogResponse]
    total: int


def _serialize_user(u: User) -> dict:
    return {
        "id": str(u.id),
        "username": u.username,
        "role": u.role,
        "department": u.department,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


@router.get("/users", response_model=UserListResponse)
async def list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> dict:
    total = (await db.execute(select(func.count(User.id)))).scalar() or 0
    result = await db.execute(select(User).order_by(User.created_at.desc()).offset(skip).limit(limit))
    users = result.scalars().all()
    return {"users": [_serialize_user(u) for u in users], "total": total}


@router.post("/users", status_code=201, response_model=UserResponse)
async def create_user(
    payload: UserCreateRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    from passlib.hash import bcrypt

    existing = await db.execute(select(User).where(User.username == payload.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username taken")

    user = User(
        username=payload.username,
        password_hash=bcrypt.hash(payload.password),
        role=payload.role,
    )
    db.add(user)
    await db.flush()
    await log_action(
        user_id=admin.id,
        action="USER_CREATE",
        entity_type="user",
        entity_id=str(user.id),
        new_value={"username": user.username, "role": user.role},
        db=db,
    )
    await db.commit()
    return _serialize_user(user)


@router.patch("/users/{user_id}/role", response_model=UserResponse)
async def update_user_role(
    user_id: str,
    payload: RoleUpdateRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    import uuid

    try:
        target_uuid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid user id")

    result = await db.execute(select(User).where(User.id == target_uuid))
    target = result.scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    old_role = target.role
    if old_role == payload.role:
        return _serialize_user(target)

    # Never allow self-demotion.
    if str(target.id) == str(admin.id) and payload.role != "ADMIN":
        raise HTTPException(status_code=400, detail="Cannot demote your own admin role")

    if target.role == "ADMIN" and payload.role != "ADMIN":
        admin_count = (
            await db.execute(select(func.count(User.id)).where(User.role == "ADMIN"))
        ).scalar() or 0
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot remove the last ADMIN")

    target.role = payload.role
    await db.flush()
    await log_action(
        user_id=admin.id,
        action="USER_ROLE_CHANGE",
        entity_type="user",
        entity_id=str(target.id),
        old_value={"role": old_role},
        new_value={"role": payload.role},
        db=db,
    )
    await db.commit()
    return _serialize_user(target)


@router.get("/audit-logs", response_model=AuditLogListResponse)
async def list_audit_logs(
    action: Optional[str] = None,
    entity_type: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> dict:
    q = select(AuditLog, User.username).join(User, AuditLog.user_id == User.id, isouter=True)
    count_q = select(func.count(AuditLog.id))

    if action:
        q = q.where(AuditLog.action == action)
        count_q = count_q.where(AuditLog.action == action)
    if entity_type:
        q = q.where(AuditLog.entity_type == entity_type)
        count_q = count_q.where(AuditLog.entity_type == entity_type)

    total = (await db.execute(count_q)).scalar() or 0
    rows = (
        (
            await db.execute(
                q.order_by(AuditLog.created_at.desc()).offset(skip).limit(limit)
            )
        )
        .all()
    )
    logs = [
        {
            "id": str(log.id),
            "user_id": str(log.user_id) if log.user_id else None,
            "username": username,
            "action": log.action,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "old_value": log.old_value,
            "new_value": log.new_value,
            "metadata_json": log.metadata_json,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        }
        for log, username in rows
    ]
    return {"logs": logs, "total": total}