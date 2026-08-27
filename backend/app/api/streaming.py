from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from backend.app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stream", tags=["Streaming"])


@router.get("/camera")
async def stream_camera():
    """Camera streaming is handled by the edge pipeline, not the backend."""
    source = settings.video_source or "phone"
    return JSONResponse(
        status_code=501,
        content={
            "message": "MJPEG streaming is provided by the edge pipeline",
            "bus_id": settings.bus_id,
            "camera": settings.camera_position,
            "source": source,
        },
    )


@router.get("/status")
async def stream_status() -> dict:
    return {
        "running": False,
        "source": settings.video_source or "phone",
        "bus_id": settings.bus_id,
        "camera": settings.camera_position,
        "fps": 0,
        "ai_mode": settings.model_mode,
        "note": "Edge pipeline status is reported by /api/system/health and system status endpoint",
    }
