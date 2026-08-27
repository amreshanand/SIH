from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database.session import get_db
from backend.app.models import User
from sqlalchemy import select

router = APIRouter(prefix="/authorities", tags=["Authorities"])


@router.get("")
async def list_authorities(db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(User).where(User.role == "AUTHORITY"))
    authorities = list(result.scalars().all())
    return {
        "authorities": [
            {"id": str(a.id), "username": a.username, "department": a.department}
            for a in authorities
        ]
    }
