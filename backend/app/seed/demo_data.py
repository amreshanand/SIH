from __future__ import annotations

import json
import uuid
import time
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models import Bus, Camera, Event, Issue, Incident, User, Route, Notification
from backend.app.core.config import settings


DEMO_BUSSES = [
    ("BUS-001", "ACTIVE"),
    ("BUS-002", "ACTIVE"),
    ("BUS-003", "ACTIVE"),
    ("BUS-004", "INACTIVE"),
]

DEMO_CAMERAS = [
    ("FRONT", "ONLINE"),
    ("REAR", "ONLINE"),
    ("LEFT", "ONLINE"),
    ("RIGHT", "ONLINE"),
]

DEMO_EVENTS = [
    ("POTHOLE", "HIGH", 0.91, 18.5204, 73.8567),
    ("WATERLOGGING", "HIGH", 0.87, 18.5300, 73.8630),
    ("ROAD_CRACK", "MEDIUM", 0.82, 18.5330, 73.8650),
    ("TRAFFIC_CONGESTION", "MEDIUM", 0.95, 18.5270, 73.8610),
    ("PEDESTRIAN_RISK", "HIGH", 0.78, 18.5390, 73.8690),
    ("MISSING_SIGN", "MEDIUM", 0.70, 18.5410, 73.8710),
]

DEMO_ISSUES = [
    ("POTHOLE", "HIGH", 0.91, 18.5204, 73.8567, "OPEN", "ROAD_MAINTENANCE", 3),
    ("WATERLOGGING", "HIGH", 0.87, 18.5300, 73.8630, "ASSIGNED", "DRAINAGE", 2),
    ("ROAD_CRACK", "MEDIUM", 0.82, 18.5330, 73.8650, "IN_PROGRESS", "ROAD_MAINTENANCE", 1),
    ("TRAFFIC_CONGESTION", "MEDIUM", 0.95, 18.5270, 73.8610, "OPEN", "TRAFFIC_MANAGEMENT", 5),
    ("PEDESTRIAN_RISK", "HIGH", 0.78, 18.5390, 73.8690, "RESOLVED", "TRAFFIC_POLICE", 4),
]

DEMO_INCIDENTS = [
    ("PEDESTRIAN_RISK", "HIGH", 0.78, 18.5390, 73.8690, None, None),
    ("RASH_DRIVING", "CRITICAL", 0.85, 18.5270, 73.8610, None, None),
]

DEMO_USERS = [
    ("admin", "admin123", "ADMIN", None),
    ("authority_road", "auth123", "AUTHORITY", "ROAD_MAINTENANCE"),
    ("authority_traffic", "auth123", "AUTHORITY", "TRAFFIC_POLICE"),
    ("viewer1", "view123", "VIEWER", None),
]


async def seed_demo_data(db: AsyncSession) -> dict:
    existing = await db.execute(select(func.count(Bus.id)))
    if existing.scalar() > 0:
        return {"status": "already_seeded"}

    counts = {"buses": 0, "cameras": 0, "events": 0, "issues": 0, "incidents": 0, "users": 0}

    for username, password, role, dept in DEMO_USERS:
        existing_user = await db.execute(select(User).where(User.username == username))
        if existing_user.scalar_one_or_none():
            counts["users"] += 1
            continue
        from passlib.hash import bcrypt
        user = User(username=username, password_hash=bcrypt.hash(password), role=role, department=dept)
        db.add(user)
        counts["users"] += 1

    bus_ids = []
    for bus_num, status in DEMO_BUSSES:
        bus = Bus(bus_number=bus_num, status=status)
        db.add(bus)
        await db.flush()
        bus_ids.append(bus.id)
        counts["buses"] += 1

        for cam_pos, cam_status in DEMO_CAMERAS:
            cam = Camera(bus_id=bus.id, position=cam_pos, status=cam_status)
            db.add(cam)
            counts["cameras"] += 1

    now = datetime.now(timezone.utc)
    for i, (etype, sev, conf, lat, lon) in enumerate(DEMO_EVENTS):
        event = Event(
            event_id=f"EVT-DEMO-{i:04d}",
            event_type=etype,
            bus_id=bus_ids[i % len(bus_ids)],
            severity=sev,
            confidence=conf,
            latitude=lat,
            longitude=lon,
            source="SIMULATED",
        )
        db.add(event)
        counts["events"] += 1

    for i, (itype, sev, conf, lat, lon, status, dept, obs) in enumerate(DEMO_ISSUES):
        issue = Issue(
            issue_id=f"RS-2026-{1000 + i:06d}",
            issue_type=itype,
            severity=sev,
            confidence=conf,
            latitude=lat,
            longitude=lon,
            first_seen=now - timedelta(days=3 - i),
            last_seen=now - timedelta(hours=i),
            observation_count=obs,
            department=dept,
            status=status,
        )
        db.add(issue)
        counts["issues"] += 1

    for i, (itype, sev, conf, lat, lon, plate, pconf) in enumerate(DEMO_INCIDENTS):
        inc = Incident(
            incident_id=f"INC-DEMO-{i:04d}",
            incident_type=itype,
            bus_id=bus_ids[0],
            severity=sev,
            confidence=conf,
            latitude=lat,
            longitude=lon,
            plate_text=plate,
            plate_confidence=pconf,
        )
        db.add(inc)
        counts["incidents"] += 1

    await db.commit()
    return {"status": "seeded", **counts}


async def reset_demo_data(db: AsyncSession) -> dict:
    from backend.app.models import (
        Bus, Camera, Event, Issue, IssueEvent, IssueAssignment,
        Incident, VehicleTrack, TrafficRecord, Evidence,
        VerificationRecord, Notification, User, Route, GPSPoint,
    )

    for model in [VerificationRecord, Notification, IssueEvent, IssueAssignment, Evidence, Incident, VehicleTrack, TrafficRecord, Event, Issue, Camera, Bus, User, Route, GPSPoint]:
        try:
            await db.execute(text(f"TRUNCATE {model.__tablename__} CASCADE"))
        except Exception:
            pass

    from sqlalchemy import text
    await db.execute(text("TRUNCATE verification_records, notifications, issue_events, issue_assignments, evidence, incidents, vehicle_tracks, traffic_records, events, issues, cameras, buses, users, routes, gps_points CASCADE"))
    await db.commit()
    return {"status": "reset"}
