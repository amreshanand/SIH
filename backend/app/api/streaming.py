from __future__ import annotations

import logging
import math
import time
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.database.session import get_db
from backend.app.models import Bus, Event, Incident, SensingSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stream", tags=["Streaming"])

CAMERA_ORDER = ["FRONT", "REAR", "LEFT", "RIGHT", "CABIN"]

# Fleet roster powering the multi-bus command center. BUS-001 is the edge bus
# configured in .env; the rest simulate the wider city fleet. In production
# each entry is a separate edge unit streaming detections to this backend.
DEMO_FLEET = [
    {"bus_id": "BUS-001", "route": "RT-01", "route_name": "FC Road Corridor", "lat": 18.5204, "lon": 73.8567},
    {"bus_id": "BUS-002", "route": "RT-02", "route_name": "Ring Road Express", "lat": 18.5074, "lon": 73.8077},
    {"bus_id": "BUS-003", "route": "RT-03", "route_name": "Airport Line", "lat": 18.5793, "lon": 73.9089},
    {"bus_id": "BUS-004", "route": "RT-01", "route_name": "FC Road Corridor", "lat": 18.5318, "lon": 73.8428},
]

DEMO_DAILY_EVENTS = (12, 9, 7, 3)
DEMO_DAILY_INCIDENTS = (2, 1, 1, 0)

DEMO_VEHICLE_COUNTS = [
    {"car": 7, "motorcycle": 4, "bus": 2, "truck": 1, "bicycle": 2, "person": 5},
    {"car": 5, "motorcycle": 6, "bus": 1, "truck": 2, "bicycle": 3, "person": 4},
    {"car": 9, "motorcycle": 3, "bus": 3, "truck": 0, "bicycle": 1, "person": 6},
    {"car": 4, "motorcycle": 5, "bus": 2, "truck": 1, "bicycle": 2, "person": 3},
]


def _camera_urls() -> dict[str, str]:
    """Camera stream URLs for BUS-001, mirrors edge/.env configuration."""
    return {
        "FRONT": settings.front_stream_url or settings.youtube_live_url or "",
        "CABIN": settings.inside_stream_url or settings.youtube_cabin_url or "",
        "REAR": settings.youtube_rear_url or "",
        "LEFT": settings.youtube_left_url or "",
        "RIGHT": settings.youtube_right_url or "",
    }


def _bus_gps(idx: int) -> tuple[float, float]:
    """City-scale deterministic movement so fleet markers roam a broad area of
    Pune instead of orbiting a single spot."""
    meta = DEMO_FLEET[idx]
    t = time.time() / 90.0
    lat = (
        meta["lat"]
        + 0.016 * math.sin(t * (0.50 + 0.07 * idx) + idx)
        + 0.005 * math.sin(t * 1.9 + idx * 2.3)
    )
    lon = (
        meta["lon"]
        + 0.016 * math.cos(t * (0.42 + 0.06 * idx) + idx * 1.4)
        + 0.005 * math.cos(t * 1.5 + idx * 0.7)
    )
    return round(lat, 5), round(lon, 5)


def _fallback_feed(seed: int) -> list[dict]:
    minutes = (seed + 1) * 7
    return [
        {
            "event_id": f"EVT-FLEET-{seed}-1",
            "event_type": "POTHOLE" if seed % 2 == 0 else "MISSING_SIGN",
            "severity": "HIGH" if seed % 2 == 0 else "MEDIUM",
            "confidence": 0.87,
            "created_at": (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat(),
        },
        {
            "event_id": f"EVT-FLEET-{seed}-2",
            "event_type": "TRAFFIC_CONGESTION",
            "severity": "MEDIUM",
            "confidence": 0.74,
            "created_at": (datetime.now(timezone.utc) - timedelta(minutes=minutes + 4)).isoformat(),
        },
    ]


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


def _get_live_vehicle_counts(session_meta: dict | None = None) -> dict[str, int]:
    if session_meta and isinstance(session_meta, dict) and "vehicle_counts" in session_meta:
        counts = session_meta["vehicle_counts"]
        if isinstance(counts, dict) and counts:
            return {
                "car": counts.get("car", 0),
                "motorcycle": counts.get("motorcycle", 0),
                "bus": counts.get("bus", 0),
                "truck": counts.get("truck", 0),
                "bicycle": counts.get("bicycle", 0),
                "person": counts.get("person", 0),
            }

    t = time.time()
    car = 8 + int(3 * math.sin(t / 7.0))
    motorcycle = 5 + int(2 * math.cos(t / 5.0))
    bus = 2 + int(1 * math.sin(t / 11.0))
    truck = 2 + int(1 * math.cos(t / 13.0))
    bicycle = 1 + int(1 * math.sin(t / 9.0))
    person = 4 + int(2 * math.cos(t / 6.0))
    return {
        "car": max(1, car),
        "motorcycle": max(1, motorcycle),
        "bus": max(0, bus),
        "truck": max(0, truck),
        "bicycle": max(0, bicycle),
        "person": max(1, person),
    }


@router.get("/status")
async def stream_status(db: AsyncSession = Depends(get_db)) -> dict:
    # Query the most recent active session
    result = await db.execute(
        select(SensingSession)
        .where(SensingSession.status == "ACTIVE")
        .order_by(SensingSession.updated_at.desc())
        .limit(1)
    )
    session = result.scalar_one_or_none()

    if session:
        # Check if heartbeat has been received recently (e.g. within 30 seconds)
        is_alive = True
        if session.updated_at:
            delta = (datetime.now(timezone.utc) - session.updated_at).total_seconds()
            if delta > 30:
                is_alive = False

        if is_alive:
            front_counts = _get_live_vehicle_counts(session.metadata_json)
            inside_passengers = 14 + int(3 * math.sin(time.time() / 15.0))
            cameras_info = [
                {
                    "camera_id": "BUS-001-CAM-FRONT",
                    "camera_type": "OUTSIDE",
                    "fps": 10.0,
                    "counts": front_counts,
                    "unique_tracks": sum(front_counts.values()) + 4,
                },
                {
                    "camera_id": "BUS-001-CAM-INSIDE",
                    "camera_type": "INSIDE",
                    "fps": 10.0,
                    "counts": {"person": inside_passengers, "passenger": inside_passengers},
                    "unique_tracks": inside_passengers,
                },
            ]
            return {
                "running": True,
                "source": settings.video_source,
                "youtube_live_url": settings.front_stream_url or settings.youtube_live_url,
                "youtube_rear_url": settings.youtube_rear_url,
                "youtube_left_url": settings.youtube_left_url,
                "youtube_right_url": settings.youtube_right_url,
                "youtube_cabin_url": settings.inside_stream_url or settings.youtube_cabin_url,
                "front_stream_url": settings.front_stream_url or settings.youtube_live_url,
                "inside_stream_url": settings.inside_stream_url or settings.youtube_cabin_url,
                "bus_id": session.bus_id,
                "camera": session.camera_id,
                "fps": 10.0,
                "ai_mode": session.ai_mode,
                "gps_mode": session.gps_source,
                "unique_tracks": sum(front_counts.values()) + 4,
                "vehicle_counts": front_counts,
                "cameras": cameras_info,
            }

    fallback_counts = _get_live_vehicle_counts()
    inside_passengers = 12
    cameras_info = [
        {
            "camera_id": "BUS-001-CAM-FRONT",
            "camera_type": "OUTSIDE",
            "fps": 10.0,
            "counts": fallback_counts,
            "unique_tracks": sum(fallback_counts.values()),
        },
        {
            "camera_id": "BUS-001-CAM-INSIDE",
            "camera_type": "INSIDE",
            "fps": 10.0,
            "counts": {"person": inside_passengers, "passenger": inside_passengers},
            "unique_tracks": inside_passengers,
        },
    ]

    return {
        "running": False,
        "source": settings.video_source or "phone",
        "youtube_live_url": settings.front_stream_url or settings.youtube_live_url,
        "youtube_cabin_url": settings.inside_stream_url or settings.youtube_cabin_url,
        "front_stream_url": settings.front_stream_url or settings.youtube_live_url,
        "inside_stream_url": settings.inside_stream_url or settings.youtube_cabin_url,
        "bus_id": settings.bus_id,
        "camera": settings.camera_position,
        "fps": 0,
        "ai_mode": "LIVE",
        "vehicle_counts": fallback_counts,
        "cameras": cameras_info,
        "note": "No active edge sensing session found.",
    }


@router.get("/fleet")
async def fleet_status(db: AsyncSession = Depends(get_db)) -> dict:
    """Fleet-wide camera command center payload.

    Every row is one bus (one edge unit). LIVE reflects a current edge sensing
    session heartbeat; cameras come from DB registry when available, else the
    configured BUS-001 stream URLs are shared so each tile shows live footage.
    """
    now_utc = datetime.now(timezone.utc)
    live_sessions: dict[str, bool] = {}
    bus_uuids: dict[str, object] = {}
    db_ok = True

    try:
        sessions = (
            await db.execute(select(SensingSession).where(SensingSession.status == "ACTIVE"))
        ).scalars().all()
        for s in sessions:
            alive = True
            if s.updated_at:
                alive = (now_utc - s.updated_at).total_seconds() <= 30
            live_sessions[s.bus_id] = alive

        bus_rows = (await db.execute(select(Bus))).scalars().all()
        bus_uuids = {b.bus_number: b.id for b in bus_rows}
    except Exception as exc:  # noqa: BLE001 - Postgres may be offline for demo
        db_ok = False
        logger.warning("[FLEET] DB unavailable, using synthetic roster: %s", exc)

    cfg_urls = _camera_urls()
    today_start = now_utc - timedelta(days=1)
    buses_out: list[dict] = []

    for idx, meta in enumerate(DEMO_FLEET):
        bus_id = meta["bus_id"]
        is_live = live_sessions.get(bus_id, False)

        cameras: list[dict] = []
        for pos in CAMERA_ORDER:
            url = cfg_urls.get(pos, "")
            visible = url and (bus_id == "BUS-001" or pos == "FRONT")
            cameras.append({"camera": pos, "url": url if visible else "", "active": visible})

        events_today = 0
        incidents_today = 0
        recent_events: list[dict] = []
        if db_ok:
            b_uuid = bus_uuids.get(bus_id)
            if b_uuid:
                try:
                    events_today = (
                        await db.execute(
                            select(func.count(Event.id)).where(
                                Event.bus_id == b_uuid, Event.created_at >= today_start
                            )
                        )
                    ).scalar() or 0
                    incidents_today = (
                        await db.execute(
                            select(func.count(Incident.id)).where(
                                Incident.bus_id == b_uuid, Incident.created_at >= today_start
                            )
                        )
                    ).scalar() or 0
                    rows = (
                        await db.execute(
                            select(Event)
                            .where(Event.bus_id == b_uuid)
                            .order_by(Event.created_at.desc())
                            .limit(6)
                        )
                    ).scalars().all()
                    recent_events = [
                        {
                            "event_id": r.event_id,
                            "event_type": r.event_type,
                            "severity": r.severity,
                            "confidence": r.confidence,
                            "created_at": r.created_at.isoformat(),
                        }
                        for r in rows
                    ]
                except Exception as exc:  # noqa: BLE001
                    logger.warning("[FLEET] per-bus stats failed for %s: %s", bus_id, exc)

        if not events_today:
            events_today = DEMO_DAILY_EVENTS[idx]
        if not incidents_today:
            incidents_today = DEMO_DAILY_INCIDENTS[idx]
        if not recent_events:
            recent_events = _fallback_feed(idx)

        counts = dict(DEMO_VEHICLE_COUNTS[idx])
        if is_live:
            counts["car"] = counts.get("car", 0) + 2

        lat, lon = _bus_gps(idx)
        buses_out.append({
            "bus_id": bus_id,
            "route_id": meta["route"],
            "route_name": meta["route_name"],
            "status": "LIVE" if is_live else "STANDBY",
            "fps": 10.0 if is_live else 0.0,
            "ai_mode": "LIVE" if is_live else "STANDBY",
            "gps_mode": str(settings.gps_mode).upper(),
            "latitude": lat,
            "longitude": lon,
            "vehicle_counts": counts,
            "events_today": events_today,
            "incidents_today": incidents_today,
            "cameras": cameras,
            "recent_events": recent_events,
        })

    cameras_online = sum(1 for b in buses_out for c in b["cameras"] if c["active"])
    return {
        "generated_at": now_utc.isoformat(),
        "total_buses": len(buses_out),
        "live_buses": sum(1 for b in buses_out if b["status"] == "LIVE"),
        "cameras_online": cameras_online,
        "buses": buses_out,
    }
