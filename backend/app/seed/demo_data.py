from __future__ import annotations

import json
import uuid
import time
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models import Bus, Camera, Event, Issue, Incident, User, Route, Notification
from backend.app.core.config import settings


DEMO_ROUTES = [
    {
        "route_name": "FC_ROAD_CORRIDOR",
        "start_stop": "Shivajinagar",
        "end_stop": "Viman Nagar",
        "stops": [
            {"name": "Shivajinagar", "lat": 18.5318, "lon": 73.8428},
            {"name": "Kothrud", "lat": 18.5074, "lon": 73.8077},
            {"name": "Jangli Maharaj Road", "lat": 18.5204, "lon": 73.8567},
            {"name": "FC Road", "lat": 18.5270, "lon": 73.8610},
            {"name": "Viman Nagar", "lat": 18.5679, "lon": 73.9143},
        ],
        "distance_km": 11.4,
        "scheduled_duration_min": 35,
    },
    {
        "route_name": "UNIVERSITY_ROAD_LOOP",
        "start_stop": "University Road",
        "end_stop": "Baner",
        "stops": [
            {"name": "University Road", "lat": 18.5523, "lon": 73.8294},
            {"name": "Model Colony", "lat": 18.5390, "lon": 73.8690},
            {"name": "Aundh", "lat": 18.5572, "lon": 73.8106},
            {"name": "Baner", "lat": 18.5592, "lon": 73.7884},
        ],
        "distance_km": 8.2,
        "scheduled_duration_min": 28,
    },
    {
        "route_name": "AIRPORT_EXPRESS",
        "start_stop": "PMC Bus Stand",
        "end_stop": "Lohegaon Airport",
        "stops": [
            {"name": "PMC Bus Stand", "lat": 18.5236, "lon": 73.8557},
            {"name": "Wagholi", "lat": 18.5801, "lon": 73.9412},
            {"name": "Lohegaon Airport", "lat": 18.5867, "lon": 73.9200},
        ],
        "distance_km": 13.0,
        "scheduled_duration_min": 40,
    },
]

# (bus_number, status, route_index or None)
DEMO_BUSSES = [
    ("BUS-001", "ACTIVE", 0),
    ("BUS-002", "ACTIVE", 1),
    ("BUS-003", "ACTIVE", 2),
    ("BUS-004", "INACTIVE", None),
]

DEMO_CAMERAS = [
    ("FRONT", "ONLINE"),
    ("REAR", "ONLINE"),
    ("LEFT", "ONLINE"),
    ("RIGHT", "ONLINE"),
]

# City-wide demo coverage — 60 events across every major Pune locality from
# Katraj/Ambegaon in the south to Pimpri/Chinchwad/Akurdi/Ravet in the
# north-west and Wagholi/Kharadi in the east (lat 18.44–18.65, lon 73.74–73.94).
DEMO_EVENTS = [
    ("POTHOLE", "HIGH", 0.91, 18.5204, 73.8567),
    ("WATERLOGGING", "HIGH", 0.87, 18.5300, 73.8630),
    ("ROAD_CRACK", "MEDIUM", 0.82, 18.5330, 73.8650),
    ("TRAFFIC_CONGESTION", "MEDIUM", 0.95, 18.5270, 73.8610),
    ("PEDESTRIAN_RISK", "HIGH", 0.78, 18.5390, 73.8690),
    ("MISSING_SIGN", "MEDIUM", 0.70, 18.5410, 73.8710),
    ("MISSING_DIVIDER", "MEDIUM", 0.74, 18.5240, 73.8480),
    ("MISSING_CROSSING", "MEDIUM", 0.76, 18.5550, 73.8120),
    ("DAMAGED_SIGN", "MEDIUM", 0.69, 18.5490, 73.7990),
    ("STREET_LIGHT", "LOW", 0.73, 18.5600, 73.9160),
    ("WATERLOGGING", "HIGH", 0.86, 18.4740, 73.8660),
    ("POTHOLE", "MEDIUM", 0.85, 18.4990, 73.9260),
    ("DAMAGED_ROAD", "HIGH", 0.88, 18.5360, 73.8900),
    ("TRAFFIC_CONGESTION", "HIGH", 0.93, 18.5110, 73.8770),
    ("ROAD_CRACK", "MEDIUM", 0.81, 18.5550, 73.8920),
    ("STREET_LIGHT", "LOW", 0.72, 18.5490, 73.9030),
    ("MISSING_DIVIDER", "MEDIUM", 0.75, 18.5510, 73.9200),
    ("MISSING_SIGN", "MEDIUM", 0.71, 18.5810, 73.9010),
    ("PEDESTRIAN_RISK", "HIGH", 0.79, 18.5840, 73.7650),
    ("TRAFFIC_CONGESTION", "MEDIUM", 0.94, 18.5890, 73.7780),
    ("WATERLOGGING", "HIGH", 0.87, 18.5950, 73.7420),
    ("DAMAGED_ROAD", "MEDIUM", 0.80, 18.5940, 73.7910),
    ("DAMAGED_SIGN", "MEDIUM", 0.68, 18.5010, 73.8610),
    ("POTHOLE", "HIGH", 0.89, 18.4410, 73.8380),
    ("POTHOLE", "MEDIUM", 0.84, 18.4520, 73.8890),
    ("DAMAGED_ROAD", "HIGH", 0.87, 18.4620, 73.9060),
    ("ROAD_CRACK", "MEDIUM", 0.80, 18.4880, 73.9300),
    ("WATERLOGGING", "HIGH", 0.86, 18.5150, 73.9360),
    ("TRAFFIC_CONGESTION", "HIGH", 0.92, 18.5250, 73.9330),
    ("STREET_LIGHT", "LOW", 0.71, 18.5530, 73.9400),
    ("MISSING_CROSSING", "MEDIUM", 0.76, 18.5680, 73.9140),
    ("MISSING_SIGN", "MEDIUM", 0.72, 18.5860, 73.9200),
    ("POTHOLE", "HIGH", 0.88, 18.5800, 73.9410),
    ("DAMAGED_SIGN", "MEDIUM", 0.70, 18.5650, 73.8800),
    ("TRAFFIC_CONGESTION", "MEDIUM", 0.93, 18.5060, 73.8750),
    ("ROAD_CRACK", "MEDIUM", 0.79, 18.4900, 73.8600),
    ("STREET_LIGHT", "LOW", 0.72, 18.4930, 73.8500),
    ("MISSING_DIVIDER", "MEDIUM", 0.74, 18.4800, 73.8500),
    ("PEDESTRIAN_RISK", "HIGH", 0.77, 18.4680, 73.8520),
    ("WATERLOGGING", "HIGH", 0.85, 18.4480, 73.8580),
    ("DAMAGED_ROAD", "MEDIUM", 0.81, 18.4610, 73.8930),
    ("POTHOLE", "MEDIUM", 0.86, 18.5150, 73.8920),
    ("PEDESTRIAN_RISK", "HIGH", 0.78, 18.5180, 73.8400),
    ("TRAFFIC_CONGESTION", "HIGH", 0.94, 18.5220, 73.8520),
    ("WATERLOGGING", "HIGH", 0.88, 18.5030, 73.8320),
    ("STREET_LIGHT", "LOW", 0.70, 18.5100, 73.8550),
    ("MISSING_CROSSING", "MEDIUM", 0.75, 18.5600, 73.8520),
    ("ROAD_CRACK", "MEDIUM", 0.82, 18.5340, 73.7840),
    ("POTHOLE", "HIGH", 0.90, 18.5110, 73.7820),
    ("DAMAGED_SIGN", "MEDIUM", 0.69, 18.4860, 73.8200),
    ("STREET_LIGHT", "LOW", 0.71, 18.4820, 73.8000),
    ("ROAD_CRACK", "MEDIUM", 0.80, 18.6300, 73.7500),
    ("TRAFFIC_CONGESTION", "MEDIUM", 0.93, 18.5780, 73.8020),
    ("PEDESTRIAN_RISK", "HIGH", 0.76, 18.5850, 73.7900),
    ("DAMAGED_ROAD", "HIGH", 0.87, 18.6330, 73.7950),
    ("MISSING_DIVIDER", "MEDIUM", 0.74, 18.6470, 73.7850),
    ("POTHOLE", "MEDIUM", 0.84, 18.6150, 73.8070),
    ("WATERLOGGING", "HIGH", 0.86, 18.6100, 73.8400),
    ("MISSING_SIGN", "MEDIUM", 0.72, 18.6340, 73.8720),
    ("TRAFFIC_CONGESTION", "HIGH", 0.92, 18.6520, 73.7700),
]

DEMO_ISSUES = [
    ("POTHOLE", "HIGH", 0.91, 18.5204, 73.8567, "OPEN", "ROAD_MAINTENANCE", 3),
    ("WATERLOGGING", "HIGH", 0.87, 18.5300, 73.8630, "ASSIGNED", "DRAINAGE", 2),
    ("ROAD_CRACK", "MEDIUM", 0.82, 18.5330, 73.8650, "IN_PROGRESS", "ROAD_MAINTENANCE", 1),
    ("TRAFFIC_CONGESTION", "MEDIUM", 0.95, 18.5270, 73.8610, "OPEN", "TRAFFIC_MANAGEMENT", 5),
    ("PEDESTRIAN_RISK", "HIGH", 0.78, 18.5390, 73.8690, "RESOLVED", "TRAFFIC_POLICE", 4),
    ("MISSING_DIVIDER", "MEDIUM", 0.74, 18.5240, 73.8480, "OPEN", "TRAFFIC_INFRASTRUCTURE", 2),
    ("MISSING_CROSSING", "MEDIUM", 0.76, 18.5550, 73.8120, "OPEN", "TRAFFIC_INFRASTRUCTURE", 1),
    ("STREET_LIGHT", "LOW", 0.73, 18.5600, 73.9160, "ASSIGNED", "ELECTRICAL", 1),
    ("POTHOLE", "HIGH", 0.89, 18.4410, 73.8380, "OPEN", "ROAD_MAINTENANCE", 2),
    ("WATERLOGGING", "HIGH", 0.86, 18.4740, 73.8660, "ASSIGNED", "DRAINAGE", 3),
    ("DAMAGED_ROAD", "HIGH", 0.88, 18.5360, 73.8900, "IN_PROGRESS", "ROAD_MAINTENANCE", 4),
    ("TRAFFIC_CONGESTION", "HIGH", 0.93, 18.5110, 73.8770, "OPEN", "TRAFFIC_MANAGEMENT", 6),
    ("MISSING_SIGN", "MEDIUM", 0.71, 18.5810, 73.9010, "OPEN", "TRAFFIC_INFRASTRUCTURE", 2),
    ("DAMAGED_SIGN", "MEDIUM", 0.68, 18.5010, 73.8610, "ASSIGNED", "TRAFFIC_INFRASTRUCTURE", 1),
    ("STREET_LIGHT", "LOW", 0.70, 18.4820, 73.8000, "IN_PROGRESS", "ELECTRICAL", 2),
    ("POTHOLE", "HIGH", 0.86, 18.5150, 73.8920, "OPEN", "ROAD_MAINTENANCE", 2),
    ("ROAD_CRACK", "MEDIUM", 0.82, 18.5340, 73.7840, "OPEN", "ROAD_MAINTENANCE", 1),
    ("DAMAGED_ROAD", "HIGH", 0.87, 18.4620, 73.9060, "ASSIGNED", "ROAD_MAINTENANCE", 3),
    ("WATERLOGGING", "HIGH", 0.86, 18.5150, 73.9360, "OPEN", "DRAINAGE", 2),
    ("TRAFFIC_CONGESTION", "HIGH", 0.94, 18.5220, 73.8520, "OPEN", "TRAFFIC_MANAGEMENT", 4),
    ("MISSING_DIVIDER", "MEDIUM", 0.74, 18.6470, 73.7850, "OPEN", "TRAFFIC_INFRASTRUCTURE", 1),
    ("STREET_LIGHT", "LOW", 0.72, 18.4930, 73.8500, "ASSIGNED", "ELECTRICAL", 1),
    ("POTHOLE", "MEDIUM", 0.84, 18.6150, 73.8070, "OPEN", "ROAD_MAINTENANCE", 1),
    ("DAMAGED_ROAD", "HIGH", 0.87, 18.6330, 73.7950, "IN_PROGRESS", "ROAD_MAINTENANCE", 5),
]

DEMO_INCIDENTS = [
    ("PEDESTRIAN_RISK", "HIGH", 0.78, 18.5390, 73.8690, None, None),
    ("RASH_DRIVING", "CRITICAL", 0.85, 18.5270, 73.8610, "MH-12-AB-3456", 0.88),
    ("HIT_AND_RUN", "CRITICAL", 0.82, 18.5460, 73.8420, "MH-14-CD-7890", 0.91),
    ("COLLISION", "CRITICAL", 0.88, 18.4990, 73.9260, "MH-14-DE-3321", 0.85),
    ("COLLISION", "CRITICAL", 0.86, 18.5360, 73.8900, None, None),
    ("RASH_DRIVING", "CRITICAL", 0.87, 18.5950, 73.7420, "MH-12-GH-2110", 0.84),
    ("HIT_AND_RUN", "CRITICAL", 0.81, 18.6150, 73.8070, "MH-14-PM-4400", 0.83),
    ("COLLISION", "CRITICAL", 0.85, 18.5800, 73.9410, "MH-12-WL-8810", 0.87),
]

# (bus index, road_segment, vehicle_count, avg_speed, congestion_score)
DEMO_TRAFFIC = [
    (0, "FC Road", 145, 18, 70),
    (0, "Jangli Maharaj Road", 110, 26, 55),
    (0, "Shivajinagar", 95, 32, 45),
    (1, "University Road", 120, 22, 62),
    (1, "Model Colony", 80, 35, 38),
    (1, "Aundh", 65, 41, 30),
    (2, "PMC Bus Stand", 175, 14, 82),
    (2, "Wagholi", 130, 20, 58),
    (2, "Lohegaon Airport", 85, 33, 42),
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
    route_ids = []
    for route_spec in DEMO_ROUTES:
        route = Route(
            route_name=route_spec["route_name"],
            start_stop=route_spec["start_stop"],
            end_stop=route_spec["end_stop"],
            stops=route_spec["stops"],
            distance_km=route_spec["distance_km"],
            scheduled_duration_min=route_spec["scheduled_duration_min"],
        )
        db.add(route)
        await db.flush()
        route_ids.append(route.id)

    for bus_num, status, route_idx in DEMO_BUSSES:
        bus = Bus(bus_number=bus_num, status=status)
        if route_idx is not None and route_idx < len(route_ids):
            bus.route_id = route_ids[route_idx]
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

    from backend.app.models import TrafficRecord
    for i, (bus_idx, segment, veh_count, avg_speed, congestion) in enumerate(DEMO_TRAFFIC):
        record = TrafficRecord(
            bus_id=bus_ids[bus_idx],
            latitude=18.53 + bus_idx * 0.008,
            longitude=73.84 + bus_idx * 0.012,
            road_segment=segment,
            vehicle_count=veh_count,
            vehicle_distribution={"car": int(veh_count * 0.6), "bus": int(veh_count * 0.25), "two_wheeler": int(veh_count * 0.15)},
            average_speed=avg_speed,
            congestion_score=congestion,
            bus_speed=float(min(38, avg_speed + 6)),
        )
        db.add(record)
        counts["traffic"] = counts.get("traffic", 0) + 1

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
