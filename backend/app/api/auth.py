from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database.session import get_db
from backend.app.models import User

router = APIRouter(prefix="/auth", tags=["Auth"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=256)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> LoginResponse:
    from backend.app.core.security import bcrypt_compat as bcrypt

    result = await db.execute(select(User).where(User.username == payload.username))
    user = result.scalar_one_or_none()
    if not user or not bcrypt.verify(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    import jwt
    from datetime import datetime, timezone, timedelta
    from backend.app.core.config import settings

    token = jwt.encode(
        {
            "sub": str(user.id),
            "role": user.role,
            "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes),
        },
        settings.secret_key,
        algorithm="HS256",
    )
    return LoginResponse(
        access_token=token,
        user={"id": str(user.id), "username": user.username, "role": user.role, "department": user.department},
    )


@router.post("/register", status_code=201)
async def register(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> dict:
    from backend.app.core.security import bcrypt_compat as bcrypt

    existing = await db.execute(select(User).where(User.username == payload.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username taken")

    user = User(
        username=payload.username,
        password_hash=bcrypt.hash(payload.password),
        role="VIEWER",
    )
    db.add(user)
    await db.commit()
    return {"status": "registered", "username": user.username, "role": "VIEWER"}
