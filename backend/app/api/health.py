"""System health + truthful capability status endpoints."""
import time

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database.session import get_db
from backend.app.core.config import settings

router = APIRouter(tags=["System"])


@router.get("/api/system/spatial")
async def system_spatial(db: AsyncSession = Depends(get_db)) -> dict:
    from backend.app.services.spatial import postgis_available
    pg = await postgis_available(db)
    tables = ["events", "issues", "incidents", "gps_points", "traffic_records", "verification_records"]
    geog_columns = []
    gist_indexes = []
    if pg:
        for t in tables:
            try:
                r = await db.execute(text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name=:t AND column_name='geog'"
                ), {"t": t})
                if r.scalar():
                    geog_columns.append(t)
            except Exception:
                pass
            try:
                r = await db.execute(text(
                    "SELECT indexname FROM pg_indexes WHERE tablename=:t AND indexname=:ix"
                ), {"t": t, "ix": f"ix_{t}_geog_gist"})
                if r.scalar():
                    gist_indexes.append(t)
            except Exception:
                pass

    return {
        "engine": "postgis" if pg else "haversine_fallback",
        "postgis_installed": pg,
        "geometry_tables": geog_columns,
        "gist_indexes": gist_indexes,
        "cluster_distance_meters": settings.cluster_distance_meters,
        "note": "haversine_fallback is used when PostGIS is not installed; results are identical within the cluster radius.",
    }


@router.get("/api/system/health")
async def system_health(db: AsyncSession = Depends(get_db)) -> dict:
    db_ok = False
    db_latency_ms = 0
    try:
        t0 = time.time()
        await db.execute(text("SELECT 1"))
        db_latency_ms = round((time.time() - t0) * 1000, 1)
        db_ok = True
    except Exception:
        pass

    postgis_ok = False
    try:
        r = await db.execute(text("SELECT PostGIS_Version()"))
        postgis_ok = r.scalar() is not None
    except Exception:
        postgis_ok = False

    overall = "ok" if db_ok else "degraded"

    from backend.app.services.capabilities import capability_status, pipeline_mode

    return {
        "status": overall,
        "timestamp": time.time(),
        "database": {
            "status": "online" if db_ok else "offline",
            "latency_ms": db_latency_ms,
        },
        "postgis": {"status": "installed" if postgis_ok else "not_installed"},
        "ai_mode": settings.model_mode,
        "gps_mode": settings.gps_mode,
        "demo_mode": settings.demo_mode,
        "debug": settings.debug,
        "bus_id": settings.bus_id,
        "camera": settings.camera_position,
        "spatial_engine": "postgis" if postgis_ok else "haversine_fallback",
        "pipeline": pipeline_mode(),
        "capabilities": capability_status(),
        "production": settings.production,
    }
