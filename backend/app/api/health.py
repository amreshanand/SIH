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


@router.get("/api/system/models")
async def system_models() -> dict:
    import os
    yolo_exists = os.path.exists(settings.yolo_model_path)
    road_damage_exists = os.path.exists(settings.road_damage_model_path)
    return {
        "vehicle_model": {
            "name": "YOLOv8 Nano (COCO)",
            "path": settings.yolo_model_path,
            "status": "ready" if yolo_exists else "missing",
            "available": yolo_exists,
            "size_bytes": os.path.getsize(settings.yolo_model_path) if yolo_exists else 0,
        },
        "road_damage_model": {
            "name": "Urban Road Damage (RDD2022)",
            "path": settings.road_damage_model_path,
            "status": "ready" if road_damage_exists else "missing",
            "available": road_damage_exists,
            "size_bytes": os.path.getsize(settings.road_damage_model_path) if road_damage_exists else 0,
            "note": "Road damage AI inference is available." if road_damage_exists else "Model weights not found. Real AI road-damage inference is UNAVAILABLE.",
        },
    }


@router.get("/api/system/health")
async def system_health(db: AsyncSession = Depends(get_db)) -> dict:
    import os
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
    from backend.app.services.operational_state import compute_operational_state

    vehicle_model_available = os.path.exists(settings.yolo_model_path)
    road_damage_model_available = os.path.exists(settings.road_damage_model_path)
    any_model = vehicle_model_available or road_damage_model_available
    gps_simulated = str(settings.gps_mode).lower() == "simulated"

    operational_state = compute_operational_state(
        db_ok=db_ok,
        demo_mode=settings.demo_mode,
        vehicle_model_available=vehicle_model_available,
        road_damage_model_available=road_damage_model_available,
        gps_simulated=gps_simulated,
        postgis_ok=postgis_ok,
    )

    return {
        "status": overall,
        "timestamp": time.time(),
        "database": {
            "status": "online" if db_ok else "offline",
            "latency_ms": db_latency_ms,
        },
        "postgis": {"status": "installed" if postgis_ok else "not_installed"},
        "models": {
            "vehicle_model": vehicle_model_available,
            "road_damage_model": road_damage_model_available,
        },
        "operational_state": operational_state,
        "ai_state": "LIVE" if any_model else "UNAVAILABLE",
        "ai_mode": operational_state,  # backward compatibility
        "vehicle_model_available": vehicle_model_available,
        "road_damage_model_available": road_damage_model_available,
        "postgis_available": postgis_ok,
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

