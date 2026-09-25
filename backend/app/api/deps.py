from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Optional

import jwt
from fastapi import Depends, Header, HTTPException, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.core.ratelimit import login_limiter, register_limiter, event_limiter, verification_limiter
from backend.app.database.session import get_db
from backend.app.models import User

security = HTTPBearer(auto_error=False)


def _client_key(request: Request, name: str = "default") -> str:
    host = request.client.host if request.client else "unknown"
    return f"{name}:{host}"


async def rate_limit_login(request: Request) -> None:
    login_limiter.check(_client_key(request, "login"))


async def rate_limit_register(request: Request) -> None:
    register_limiter.check(_client_key(request, "register"))


async def rate_limit_events(request: Request) -> None:
    event_limiter.check(_client_key(request, "events"))


async def rate_limit_verification(request: Request) -> None:
    verification_limiter.check(_client_key(request, "verification"))


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    if credentials is None:
        if settings.demo_mode:
            result = await db.execute(select(User).where(User.username == "admin"))
            return result.scalar_one_or_none()
        return None

    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.secret_key,
            algorithms=["HS256"],
        )
        user_id = payload.get("sub")
        if user_id is None:
            if settings.demo_mode:
                result = await db.execute(select(User).where(User.username == "admin"))
                return result.scalar_one_or_none()
            raise HTTPException(status_code=401, detail="Invalid token")

        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            if settings.demo_mode:
                result = await db.execute(select(User).where(User.username == "admin"))
                return result.scalar_one_or_none()
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        if settings.demo_mode:
            result = await db.execute(select(User).where(User.username == "admin"))
            return result.scalar_one_or_none()
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        if settings.demo_mode:
            result = await db.execute(select(User).where(User.username == "admin"))
            return result.scalar_one_or_none()
        raise HTTPException(status_code=401, detail="Invalid token")


async def require_auth(
    user: Optional[User] = Depends(get_current_user),
) -> User:
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


async def require_admin(
    user: User = Depends(require_auth),
) -> User:
    if user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def require_authority(
    user: User = Depends(require_auth),
) -> User:
    if user.role not in ("ADMIN", "AUTHORITY"):
        raise HTTPException(status_code=403, detail="Authority access required")
    return user


async def edge_or_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
    db: AsyncSession = Depends(get_db),
) -> str:
    """Accept either a valid edge (device) API key or an authenticated user.

    Used for endpoints that are fed by both the edge devices (events, gps,
    telemetry) and by human users. Returns 'edge' or the username.
    """
    # Edge device path (X-API-Key header).
    if x_api_key:
        if x_api_key == settings.edge_api_key:
            return "edge"
        raise HTTPException(status_code=401, detail="Invalid edge API key")

    # Human path (Bearer JWT).
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    user = await get_current_user(credentials, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user.username
