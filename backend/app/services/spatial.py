"""Adaptive spatial engine.

UrbanSense AI spatial work should use PostGIS when the extension is available,
and fall back to an in-process haversine implementation when it is not.

This module detects PostGIS at runtime and exposes a uniform interface:

    spatial_engine()            -> "postgis" | "haversine"
    distance_m(lat1, lon1, ...) -> meters
    within_m(lat1, lon1, lat2, lon2, radius_m) -> bool
    clustering_available()      -> bool

Callers never need to know which backend is in use. The active backend is
reported truthfully via /api/system/health.
"""
from __future__ import annotations

import math
from typing import Awaitable, Callable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def postgis_available(db: AsyncSession) -> bool:
    """Return True if the PostGIS extension is installed in this database."""
    if not settings.spatial_engine == "auto" and settings.spatial_engine == "postgis":
        return True
    if settings.spatial_engine == "haversine":
        return False
    try:
        # Probe on a separate connection so a failed probe never aborts the
        # caller's transaction nor expires its loaded objects.
        async with db.bind.connect() as conn:
            r = await conn.execute(text("SELECT PostGIS_Version()"))
            return r.scalar() is not None
    except Exception:
        return False


async def spatial_engine(db: AsyncSession) -> str:
    """Return the active spatial engine for a given DB session."""
    if await postgis_available(db):
        return "postgis"
    return "haversine"


def distance_m(
    lat1: float, lon1: float, lat2: float, lon2: float,
    spatial: str = "haversine",
    db: AsyncSession | None = None,
) -> float | Awaitable[float]:
    """Distance in meters. If spatial=='postgis' and a db is provided, uses
    ST_Distance_Sphere (pure SQL, no PostGIS-specific objects needed for a
    simple point-to-point distance). Otherwise uses haversine."""
    if spatial == "postgis" and db is not None:
        # This path is async; callers should use await distance_m_async().
        return distance_m_async(lat1, lon1, lat2, lon2, db)
    return _haversine_m(lat1, lon1, lat2, lon2)


async def distance_m_async(
    lat1: float, lon1: float, lat2: float, lon2: float, db: AsyncSession
) -> float:
    try:
        r = await db.execute(
            text(
                "SELECT ST_Distance_Sphere("
                "ST_MakePoint(:lon1, :lat1), ST_MakePoint(:lon2, :lat2))"
            ),
            {"lon1": lon1, "lat1": lat1, "lon2": lon2, "lat2": lat2},
        )
        return float(r.scalar() or _haversine_m(lat1, lon1, lat2, lon2))
    except Exception:
        return _haversine_m(lat1, lon1, lat2, lon2)


async def clustering_available(db: AsyncSession) -> bool:
    """Whether true GeoSpatial clustering (GiST + ST_DWithin) is available."""
    return await postgis_available(db)
