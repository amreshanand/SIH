from __future__ import annotations

import json
import uuid
import time
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, func, delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models import (
    Bus, Camera, Event, Issue, IssueEvent, IssueAssignment,
    Incident, VehicleTrack, TrafficRecord, Evidence,
    VerificationRecord, Notification, User, Route, GPSPoint, SensingSession,
)
from backend.app.core.config import settings


DEMO_ROUTES = [
    {
        "route_name": "FC_ROAD_VIMAN_NAGAR",
        "start_stop": "Swargate Hub",
        "end_stop": "Pune Airport",
        "stops": [
            {"name": "Swargate Hub", "lat": 18.5010, "lon": 73.8610},
            {"name": "Deccan Gymkhana", "lat": 18.5180, "lon": 73.8420},
            {"name": "FC Road", "lat": 18.5270, "lon": 73.8410},
            {"name": "Shivajinagar Bus Stand", "lat": 18.5318, "lon": 73.8428},
            {"name": "Sangamwadi BRT", "lat": 18.5360, "lon": 73.8690},
            {"name": "Yerawada Chowk", "lat": 18.5520, "lon": 73.8820},
            {"name": "Shastri Nagar", "lat": 18.5570, "lon": 73.8960},
            {"name": "Viman Nagar", "lat": 18.5679, "lon": 73.9143},
            {"name": "Pune Airport", "lat": 18.5820, "lon": 73.9180},
        ],
        "distance_km": 14.2,
        "scheduled_duration_min": 42,
    },
    {
        "route_name": "KOTHRUD_HINJAWADI_EXPRESS",
        "start_stop": "Kothrud Stand",
        "end_stop": "Hinjawadi Phase 1",
        "stops": [
            {"name": "Kothrud Stand", "lat": 18.5074, "lon": 73.8077},
            {"name": "Karve Road", "lat": 18.5100, "lon": 73.8320},
            {"name": "Law College Road", "lat": 18.5190, "lon": 73.8330},
            {"name": "SB Road / Symbiosis", "lat": 18.5320, "lon": 73.8340},
            {"name": "Pune University", "lat": 18.5523, "lon": 73.8294},
            {"name": "Aundh Parihar Chowk", "lat": 18.5572, "lon": 73.8106},
            {"name": "Baner Road", "lat": 18.5592, "lon": 73.7884},
            {"name": "Balewadi High Street", "lat": 18.5780, "lon": 73.7720},
            {"name": "Wakad Bridge", "lat": 18.5890, "lon": 73.7780},
            {"name": "Hinjawadi Phase 1", "lat": 18.5950, "lon": 73.7420},
        ],
        "distance_km": 18.5,
        "scheduled_duration_min": 50,
    },
    {
        "route_name": "PUNE_STATION_KHARADI_LINE",
        "start_stop": "Swargate",
        "end_stop": "Wagholi",
        "stops": [
            {"name": "Swargate", "lat": 18.5010, "lon": 73.8610},
            {"name": "Camp / Sadak Bazaar", "lat": 18.5110, "lon": 73.8770},
            {"name": "Pune Railway Station", "lat": 18.5306, "lon": 73.8730},
            {"name": "Bund Garden Road", "lat": 18.5370, "lon": 73.8830},
            {"name": "Koregaon Park Main Rd", "lat": 18.5390, "lon": 73.8980},
            {"name": "Kalyani Nagar Central", "lat": 18.5490, "lon": 73.9030},
            {"name": "Wadgaon Sheri", "lat": 18.5510, "lon": 73.9200},
            {"name": "Kharadi EON Free Zone", "lat": 18.5530, "lon": 73.9400},
            {"name": "Wagholi Hub", "lat": 18.5801, "lon": 73.9412},
        ],
        "distance_km": 16.0,
        "scheduled_duration_min": 45,
    },
    {
        "route_name": "KATRAJ_HADAPSAR_CORRIDOR",
        "start_stop": "Katraj Snake Park",
        "end_stop": "Mundhwa",
        "stops": [
            {"name": "Katraj Snake Park", "lat": 18.4410, "lon": 73.8380},
            {"name": "Bharati Vidyapeeth", "lat": 18.4520, "lon": 73.8580},
            {"name": "Dhankawadi", "lat": 18.4680, "lon": 73.8520},
            {"name": "Bibwewadi", "lat": 18.4740, "lon": 73.8660},
            {"name": "Seven Loves Chowk", "lat": 18.5060, "lon": 73.8750},
            {"name": "Fatima Nagar", "lat": 18.5010, "lon": 73.8960},
            {"name": "Hadapsar Gadital", "lat": 18.4990, "lon": 73.9260},
            {"name": "Magarpatta City", "lat": 18.5150, "lon": 73.9360},
            {"name": "Mundhwa", "lat": 18.5250, "lon": 73.9330},
        ],
        "distance_km": 15.3,
        "scheduled_duration_min": 40,
    },
    {
        "route_name": "OLD_HIGHWAY_PCMC_METRO_LINK",
        "start_stop": "Shivajinagar",
        "end_stop": "Nigdi / Ravet",
        "stops": [
            {"name": "Shivajinagar", "lat": 18.5318, "lon": 73.8428},
            {"name": "Wakdewadi", "lat": 18.5420, "lon": 73.8470},
            {"name": "Khadki Bazaar", "lat": 18.5600, "lon": 73.8520},
            {"name": "Bopodi", "lat": 18.5720, "lon": 73.8380},
            {"name": "Dapodi", "lat": 18.5800, "lon": 73.8290},
            {"name": "Kasarwadi", "lat": 18.5950, "lon": 73.8210},
            {"name": "Pimpri Chowk", "lat": 18.6150, "lon": 73.8070},
            {"name": "Chinchwad Station", "lat": 18.6330, "lon": 73.7950},
            {"name": "Akurdi", "lat": 18.6470, "lon": 73.7850},
            {"name": "Nigdi / Ravet", "lat": 18.6300, "lon": 73.7500},
        ],
        "distance_km": 19.8,
        "scheduled_duration_min": 55,
    },
    {
        "route_name": "AIRPORT_DHANORI_CIRCULAR",
        "start_stop": "Pune Station",
        "end_stop": "Lohegaon Airport",
        "stops": [
            {"name": "Pune Station", "lat": 18.5306, "lon": 73.8730},
            {"name": "Sangam Bridge", "lat": 18.5360, "lon": 73.8690},
            {"name": "Holkar Bridge", "lat": 18.5510, "lon": 73.8650},
            {"name": "Vishrantwadi", "lat": 18.5670, "lon": 73.8780},
            {"name": "Tingre Nagar", "lat": 18.5740, "lon": 73.8890},
            {"name": "Dhanori", "lat": 18.5810, "lon": 73.9010},
            {"name": "Lohegaon Airport", "lat": 18.5867, "lon": 73.9200},
        ],
        "distance_km": 11.2,
        "scheduled_duration_min": 32,
    },
]

DEMO_BUSSES = [
    ("BUS-001", "ACTIVE", 0),
    ("BUS-002", "ACTIVE", 1),
    ("BUS-003", "ACTIVE", 2),
    ("BUS-004", "ACTIVE", 3),
    ("BUS-005", "ACTIVE", 4),
    ("BUS-006", "ACTIVE", 5),
]

DEMO_CAMERAS = [
    ("FRONT", "ONLINE"),
    ("REAR", "ONLINE"),
    ("LEFT", "ONLINE"),
    ("RIGHT", "ONLINE"),
]

# 80+ City-wide road-aligned defects across all corridors and areas of Pune
DEMO_EVENTS_AND_ISSUES = [
    # --- Corridor 1: FC Road, JM Road, Shivajinagar, Yerawada, Viman Nagar ---
    ("POTHOLE", "HIGH", 0.92, 18.5010, 73.8610, "OPEN", "ROAD_MAINTENANCE", 4, "Swargate Bus Bay Pothole"),
    ("ROAD_CRACK", "MEDIUM", 0.84, 18.5080, 73.8540, "ASSIGNED", "ROAD_MAINTENANCE", 2, "Tilak Road Longitudinal Crack"),
    ("MISSING_DIVIDER", "HIGH", 0.88, 18.5140, 73.8470, "OPEN", "TRAFFIC_INFRASTRUCTURE", 3, "Alka Talkies Missing Median Barrier"),
    ("TRAFFIC_CONGESTION", "HIGH", 0.95, 18.5180, 73.8420, "OPEN", "TRAFFIC_MANAGEMENT", 8, "Deccan Gymkhana Peak Gridlock"),
    ("POTHOLE", "CRITICAL", 0.94, 18.5220, 73.8415, "IN_PROGRESS", "ROAD_MAINTENANCE", 6, "Goodluck Chowk Severe Cavity"),
    ("DAMAGED_SIGN", "MEDIUM", 0.78, 18.5270, 73.8410, "ASSIGNED", "TRAFFIC_INFRASTRUCTURE", 2, "FC Road Speed Limit Sign Damaged"),
    ("PEDESTRIAN_RISK", "HIGH", 0.86, 18.5300, 73.8420, "OPEN", "TRAFFIC_POLICE", 5, "Agriculture College Crossing Hazard"),
    ("POTHOLE", "HIGH", 0.91, 18.5318, 73.8428, "OPEN", "ROAD_MAINTENANCE", 5, "Shivajinagar Depot Entry Depression"),
    ("ROAD_CRACK", "MEDIUM", 0.80, 18.5300, 73.8510, "IN_PROGRESS", "ROAD_MAINTENANCE", 2, "COEP Flyover Descent Surface Crack"),
    ("DAMAGED_ROAD", "HIGH", 0.89, 18.5360, 73.8690, "ASSIGNED", "ROAD_MAINTENANCE", 4, "Sangamwadi BRT Corridor Deterioration"),
    ("WATERLOGGING", "HIGH", 0.87, 18.5480, 73.8810, "OPEN", "DRAINAGE", 4, "Yerawada Bridge Incline Monsoon Ponding"),
    ("MISSING_SIGN", "MEDIUM", 0.75, 18.5520, 73.8820, "ASSIGNED", "TRAFFIC_INFRASTRUCTURE", 1, "Yerawada Chowk No-Right-Turn Sign Missing"),
    ("POTHOLE", "HIGH", 0.90, 18.5570, 73.8960, "OPEN", "ROAD_MAINTENANCE", 3, "Shastri Nagar Bus Stop Trench"),
    ("STREET_LIGHT", "LOW", 0.73, 18.5600, 73.9040, "IN_PROGRESS", "ELECTRICAL", 2, "Ramwadi Metro Pillar Light Fault"),
    ("TRAFFIC_CONGESTION", "MEDIUM", 0.91, 18.5630, 73.9100, "OPEN", "TRAFFIC_MANAGEMENT", 6, "Phoenix Marketcity Mall Inflow Jam"),
    ("POTHOLE", "CRITICAL", 0.93, 18.5679, 73.9143, "OPEN", "ROAD_MAINTENANCE", 7, "Viman Nagar Main Road Deep Pothole"),
    ("MISSING_CROSSING", "HIGH", 0.82, 18.5720, 73.9160, "ASSIGNED", "TRAFFIC_INFRASTRUCTURE", 3, "Symbiosis Viman Nagar Unmarked Crossing"),
    ("DAMAGED_ROAD", "HIGH", 0.88, 18.5820, 73.9180, "IN_PROGRESS", "ROAD_MAINTENANCE", 5, "Airport Approach Road Bitumen Rutting"),

    # --- Corridor 2: Kothrud, Karve Rd, SB Rd, Aundh, Baner, Hinjawadi ---
    ("POTHOLE", "HIGH", 0.89, 18.5074, 73.8077, "OPEN", "ROAD_MAINTENANCE", 4, "Kothrud Stand Terminal Pothole"),
    ("MISSING_DIVIDER", "MEDIUM", 0.76, 18.5100, 73.8320, "ASSIGNED", "TRAFFIC_INFRASTRUCTURE", 2, "Karve Road Broken Concrete Divider"),
    ("ROAD_CRACK", "MEDIUM", 0.81, 18.5190, 73.8330, "OPEN", "ROAD_MAINTENANCE", 2, "Law College Road Surface Fissure"),
    ("TRAFFIC_CONGESTION", "HIGH", 0.93, 18.5320, 73.8340, "OPEN", "TRAFFIC_MANAGEMENT", 7, "SB Road Symbiosis Junction Congestion"),
    ("WATERLOGGING", "HIGH", 0.88, 18.5523, 73.8294, "IN_PROGRESS", "DRAINAGE", 4, "Pune University Main Circle Waterlogging"),
    ("DAMAGED_SIGN", "LOW", 0.70, 18.5572, 73.8106, "OPEN", "TRAFFIC_INFRASTRUCTURE", 1, "Aundh Parihar Chowk Faded Direction Sign"),
    ("POTHOLE", "CRITICAL", 0.95, 18.5592, 73.7884, "OPEN", "ROAD_MAINTENANCE", 6, "Baner Road Metro Pillar Pothole"),
    ("MISSING_CROSSING", "MEDIUM", 0.77, 18.5780, 73.7720, "ASSIGNED", "TRAFFIC_INFRASTRUCTURE", 2, "Balewadi High Street Missing Zebra Lines"),
    ("TRAFFIC_CONGESTION", "HIGH", 0.96, 18.5890, 73.7780, "OPEN", "TRAFFIC_MANAGEMENT", 9, "Wakad Bridge Highway Merge Choke"),
    ("DAMAGED_ROAD", "HIGH", 0.90, 18.5950, 73.7420, "IN_PROGRESS", "ROAD_MAINTENANCE", 5, "Hinjawadi Phase 1 Wipro Circle Trench"),
    ("STREET_LIGHT", "LOW", 0.74, 18.5920, 73.7550, "OPEN", "ELECTRICAL", 2, "Hinjawadi Flyover Dark Zone"),

    # --- Corridor 3: Pune Station, Camp, Koregaon Park, Kalyani Nagar, Kharadi, Wagholi ---
    ("POTHOLE", "HIGH", 0.91, 18.5306, 73.8730, "OPEN", "ROAD_MAINTENANCE", 6, "Pune Railway Station Auto Stand Pothole"),
    ("PEDESTRIAN_RISK", "HIGH", 0.85, 18.5110, 73.8770, "IN_PROGRESS", "TRAFFIC_POLICE", 4, "Camp MG Road Jaywalking Zone"),
    ("DAMAGED_SIGN", "MEDIUM", 0.72, 18.5370, 73.8830, "ASSIGNED", "TRAFFIC_INFRASTRUCTURE", 1, "Bund Garden Road Overhead Sign Tilted"),
    ("ROAD_CRACK", "MEDIUM", 0.82, 18.5390, 73.8980, "OPEN", "ROAD_MAINTENANCE", 3, "Koregaon Park Lane 5 Heat Fracture"),
    ("STREET_LIGHT", "LOW", 0.71, 18.5490, 73.9030, "ASSIGNED", "ELECTRICAL", 2, "Kalyani Nagar Joggers Park Street Light Out"),
    ("WATERLOGGING", "HIGH", 0.89, 18.5510, 73.9200, "OPEN", "DRAINAGE", 5, "Wadgaon Sheri Low-Lying Road Flooding"),
    ("POTHOLE", "CRITICAL", 0.94, 18.5530, 73.9400, "OPEN", "ROAD_MAINTENANCE", 8, "Kharadi EON Free Zone Roundabout Crater"),
    ("TRAFFIC_CONGESTION", "HIGH", 0.94, 18.5801, 73.9412, "OPEN", "TRAFFIC_MANAGEMENT", 7, "Wagholi Octroi Naka Bottleneck"),

    # --- Corridor 4: Katraj, Bibwewadi, Hadapsar, Magarpatta, Mundhwa ---
    ("POTHOLE", "HIGH", 0.93, 18.4410, 73.8380, "OPEN", "ROAD_MAINTENANCE", 5, "Katraj Tunnel Approach Major Pothole"),
    ("DAMAGED_ROAD", "HIGH", 0.87, 18.4520, 73.8580, "IN_PROGRESS", "ROAD_MAINTENANCE", 3, "Bharati Vidyapeeth Road Subsidence"),
    ("MISSING_DIVIDER", "MEDIUM", 0.79, 18.4680, 73.8520, "ASSIGNED", "TRAFFIC_INFRASTRUCTURE", 2, "Dhankawadi Main Street Missing Divider"),
    ("WATERLOGGING", "HIGH", 0.86, 18.4740, 73.8660, "OPEN", "DRAINAGE", 4, "Bibwewadi Upper Drainage Overflow"),
    ("STREET_LIGHT", "LOW", 0.70, 18.5060, 73.8750, "OPEN", "ELECTRICAL", 2, "Seven Loves Chowk Inactive Sodium Lamp"),
    ("POTHOLE", "MEDIUM", 0.85, 18.5010, 73.8960, "ASSIGNED", "ROAD_MAINTENANCE", 3, "Fatima Nagar Bus Stand Edge Damage"),
    ("TRAFFIC_CONGESTION", "HIGH", 0.95, 18.4990, 73.9260, "OPEN", "TRAFFIC_MANAGEMENT", 9, "Hadapsar Gadital Flyover Choke Point"),
    ("ROAD_CRACK", "MEDIUM", 0.81, 18.5150, 73.9360, "IN_PROGRESS", "ROAD_MAINTENANCE", 2, "Magarpatta South Gate Asphalt Wear"),
    ("DAMAGED_ROAD", "HIGH", 0.88, 18.5250, 73.9330, "OPEN", "ROAD_MAINTENANCE", 4, "Mundhwa Bridge Road Excavation Leftover"),

    # --- Corridor 5: Khadki, Dapodi, Pimpri, Chinchwad, Akurdi, Ravet ---
    ("ROAD_CRACK", "MEDIUM", 0.83, 18.5420, 73.8470, "OPEN", "ROAD_MAINTENANCE", 2, "Wakdewadi Service Road Crack"),
    ("MISSING_SIGN", "MEDIUM", 0.74, 18.5600, 73.8520, "ASSIGNED", "TRAFFIC_INFRASTRUCTURE", 1, "Khadki Cantonment Speed Limit Missing"),
    ("POTHOLE", "HIGH", 0.90, 18.5720, 73.8380, "OPEN", "ROAD_MAINTENANCE", 4, "Bopodi Railway Underpass Water Pothole"),
    ("WATERLOGGING", "HIGH", 0.92, 18.5800, 73.8290, "OPEN", "DRAINAGE", 5, "Dapodi Subway Heavy Water Retention"),
    ("DAMAGED_ROAD", "MEDIUM", 0.82, 18.5950, 73.8210, "IN_PROGRESS", "ROAD_MAINTENANCE", 3, "Kasarwadi Old Highway Lane 2 Rupture"),
    ("TRAFFIC_CONGESTION", "HIGH", 0.93, 18.6150, 73.8070, "OPEN", "TRAFFIC_MANAGEMENT", 7, "Pimpri Grade Separator Peak Jam"),
    ("POTHOLE", "CRITICAL", 0.95, 18.6330, 73.7950, "OPEN", "ROAD_MAINTENANCE", 6, "Chinchwad Station Underpass Deep Cavity"),
    ("MISSING_DIVIDER", "HIGH", 0.86, 18.6470, 73.7850, "OPEN", "TRAFFIC_INFRASTRUCTURE", 3, "Akurdi Gurudwara Chowk Removed Barrier"),
    ("DAMAGED_SIGN", "MEDIUM", 0.76, 18.6300, 73.7500, "ASSIGNED", "TRAFFIC_INFRASTRUCTURE", 1, "Ravet Expressway Exit Sign Damaged"),

    # --- Corridor 6: Sangamwadi, Vishrantwadi, Tingre Nagar, Dhanori, Lohegaon ---
    ("ROAD_CRACK", "MEDIUM", 0.79, 18.5510, 73.8650, "OPEN", "ROAD_MAINTENANCE", 2, "Holkar Bridge Mula River Span Joint Crack"),
    ("POTHOLE", "HIGH", 0.89, 18.5670, 73.8780, "IN_PROGRESS", "ROAD_MAINTENANCE", 4, "Vishrantwadi Circle Heavy Pothole"),
    ("STREET_LIGHT", "LOW", 0.73, 18.5740, 73.8890, "OPEN", "ELECTRICAL", 2, "Tingre Nagar Lane 4 Light Outage"),
    ("DAMAGED_ROAD", "HIGH", 0.88, 18.5810, 73.9010, "OPEN", "ROAD_MAINTENANCE", 4, "Dhanori Lohegaon Road Shoulder Damage"),
    ("MISSING_CROSSING", "MEDIUM", 0.78, 18.5867, 73.9200, "ASSIGNED", "TRAFFIC_INFRASTRUCTURE", 2, "Lohegaon Airport Cargo Gate Crossing Missing"),

    # --- Additional Crucial City Cross-Connections ---
    ("POTHOLE", "HIGH", 0.90, 18.4930, 73.8500, "RESOLVED", "ROAD_MAINTENANCE", 3, "Parvati Hill Footpath Depression"),
    ("ROAD_CRACK", "MEDIUM", 0.80, 18.4800, 73.8500, "OPEN", "ROAD_MAINTENANCE", 1, "Sahakar Nagar Lane 3 Bitumen Creep"),
    ("WATERLOGGING", "HIGH", 0.87, 18.4620, 73.9060, "OPEN", "DRAINAGE", 4, "NIBM Road Salunke Vihar Waterlogging"),
    ("DAMAGED_ROAD", "HIGH", 0.85, 18.4880, 73.9300, "OPEN", "ROAD_MAINTENANCE", 3, "Mohammadwadi Undri Link Road Erosion"),
    ("MISSING_DIVIDER", "MEDIUM", 0.77, 18.5340, 73.7840, "OPEN", "TRAFFIC_INFRASTRUCTURE", 2, "Pashan Sus Road Curve Missing Divider"),
    ("POTHOLE", "HIGH", 0.92, 18.5840, 73.7650, "OPEN", "ROAD_MAINTENANCE", 4, "Balewadi Stadium Road Edge Break"),
    ("TRAFFIC_CONGESTION", "MEDIUM", 0.92, 18.6100, 73.8400, "OPEN", "TRAFFIC_MANAGEMENT", 6, "Bhosari MIDC Spine Road Traffic"),
    ("MISSING_SIGN", "MEDIUM", 0.73, 18.6340, 73.8720, "ASSIGNED", "TRAFFIC_INFRASTRUCTURE", 1, "Charholi Alandi Highway Signboard Missing"),
]

DEMO_INCIDENTS = [
    ("PEDESTRIAN_RISK", "HIGH", 0.86, 18.5300, 73.8420, None, None),
    ("RASH_DRIVING", "CRITICAL", 0.88, 18.5220, 73.8415, "MH-12-AB-3456", 0.88),
    ("HIT_AND_RUN", "CRITICAL", 0.84, 18.5679, 73.9143, "MH-14-CD-7890", 0.91),
    ("COLLISION", "CRITICAL", 0.89, 18.4990, 73.9260, "MH-14-DE-3321", 0.85),
    ("COLLISION", "CRITICAL", 0.87, 18.5530, 73.9400, "MH-12-KL-4099", 0.89),
    ("RASH_DRIVING", "CRITICAL", 0.91, 18.5950, 73.7420, "MH-12-GH-2110", 0.84),
    ("HIT_AND_RUN", "CRITICAL", 0.83, 18.6330, 73.7950, "MH-14-PM-4400", 0.83),
    ("COLLISION", "CRITICAL", 0.86, 18.5890, 73.7780, "MH-12-WL-8810", 0.87),
]

DEMO_USERS = [
    ("admin", "admin123", "ADMIN", None),
    ("authority_road", "auth123", "AUTHORITY", "ROAD_MAINTENANCE"),
    ("authority_traffic", "auth123", "AUTHORITY", "TRAFFIC_MANAGEMENT"),
    ("authority_infra", "auth123", "AUTHORITY", "TRAFFIC_INFRASTRUCTURE"),
    ("authority_drainage", "auth123", "AUTHORITY", "DRAINAGE"),
    ("authority_elec", "auth123", "AUTHORITY", "ELECTRICAL"),
    ("viewer1", "view123", "VIEWER", None),
]


async def seed_traffic_records(
    db: AsyncSession,
    bus_ids: list[uuid.UUID],
    route_ids: list[uuid.UUID],
) -> int:
    """Seed deterministic TrafficRecord rows across the fleet.

    Populates congestion telemetry (vehicle count, distribution, speed, score)
    for every bus so the analytics layer has traffic data to render. Called by
    the demo seeder when nothing has generated traffic records yet.
    """
    now = datetime.now(timezone.utc)
    distributions = [
        {"car": 9, "motorcycle": 5, "bus": 2, "truck": 3, "bicycle": 1, "person": 6},
        {"car": 6, "motorcycle": 7, "bus": 3, "truck": 2, "bicycle": 2, "person": 5},
        {"car": 12, "motorcycle": 4, "bus": 2, "truck": 4, "bicycle": 1, "person": 7},
        {"car": 5, "motorcycle": 5, "bus": 2, "truck": 1, "bicycle": 2, "person": 4},
    ]
    segment_names = [r["route_name"] for r in DEMO_ROUTES]
    count = 0

    for i, bus_id in enumerate(bus_ids):
        route_segment = segment_names[i % len(segment_names)]
        dist = dict(distributions[i % len(distributions)])
        vehicle_count = sum(dist.values())
        # Each bus gets a handful of records spread over the last day so the
        # analytics aggregation returns non-trivial counts.
        for k in range(4):
            congestion = max(5, min(95, 22 + (i * 11) + (k * 9)))
            record = TrafficRecord(
                bus_id=bus_id,
                latitude=DEMO_ROUTES[i % len(DEMO_ROUTES)].get("stops", [{}])[0].get("lat", 18.5204),
                longitude=DEMO_ROUTES[i % len(DEMO_ROUTES)].get("stops", [{}])[0].get("lon", 73.8567),
                road_segment=route_segment,
                vehicle_count=vehicle_count,
                vehicle_distribution=dist,
                average_speed=round(38 - (congestion / 100) * 18, 1),
                congestion_score=congestion,
                bus_speed=round(30 + (i * 3) - (k * 2), 1),
            )
            record.created_at = now - timedelta(hours=k * 5, minutes=i * 13)
            db.add(record)
            count += 1

    await db.flush()
    return count


async def seed_demo_data(db: AsyncSession, force: bool = False) -> dict:
    if not force:
        existing = await db.execute(select(func.count(Bus.id)))
        if existing.scalar() > 0:
            return {"status": "already_seeded"}
    else:
        await reset_demo_data(db)

    counts = {"buses": 0, "cameras": 0, "events": 0, "issues": 0, "incidents": 0, "users": 0, "routes": 0}

    for username, password, role, dept in DEMO_USERS:
        existing_user = await db.execute(select(User).where(User.username == username))
        if existing_user.scalar_one_or_none():
            counts["users"] += 1
            continue
        from backend.app.core.security import bcrypt_compat as bcrypt
        user = User(username=username, password_hash=bcrypt.hash(password), role=role, department=dept)
        db.add(user)
        counts["users"] += 1

    bus_ids = []
    route_ids = []
    for route_spec in DEMO_ROUTES:
        existing_route = (await db.execute(select(Route).where(Route.route_name == route_spec["route_name"]))).scalar_one_or_none()
        if existing_route:
            existing_route.start_stop = route_spec["start_stop"]
            existing_route.end_stop = route_spec["end_stop"]
            existing_route.stops = route_spec["stops"]
            existing_route.distance_km = route_spec["distance_km"]
            existing_route.scheduled_duration_min = route_spec["scheduled_duration_min"]
            route = existing_route
        else:
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
        counts["routes"] += 1

    for bus_num, status, route_idx in DEMO_BUSSES:
        existing_bus = (await db.execute(select(Bus).where(Bus.bus_number == bus_num))).scalar_one_or_none()
        if existing_bus:
            existing_bus.status = status
            if route_idx is not None and route_idx < len(route_ids):
                existing_bus.route_id = route_ids[route_idx]
            bus = existing_bus
        else:
            bus = Bus(bus_number=bus_num, status=status)
            if route_idx is not None and route_idx < len(route_ids):
                bus.route_id = route_ids[route_idx]
            db.add(bus)
            await db.flush()
        bus_ids.append(bus.id)
        counts["buses"] += 1

        for cam_pos, cam_status in DEMO_CAMERAS:
            existing_cam = (await db.execute(select(Camera).where(Camera.bus_id == bus.id, Camera.position == cam_pos))).scalar_one_or_none()
            if not existing_cam:
                cam = Camera(bus_id=bus.id, position=cam_pos, status=cam_status)
                db.add(cam)
                counts["cameras"] += 1

    now = datetime.now(timezone.utc)

    # Traffic telemetry: seed a deterministic spread of TrafficRecord rows per
    # bus so congestion analytics, the OD matrix and route-delay estimates all
    # have data. Without this the analytics "traffic" block stays empty because
    # nothing else ever writes to traffic_records.
    await seed_traffic_records(db, bus_ids, route_ids)

    # Simulated demo seed does NOT fabricate evidence images — real evidence is
    # captured and attached by the live edge pipeline via /api/events.
    urls: list[str] = []

    for i, item in enumerate(DEMO_EVENTS_AND_ISSUES):
        etype, sev, conf, lat, lon, status, dept, obs, desc = item
        
        evt_url = None

        # Event record
        event = Event(
            event_id=f"EVT-DEMO-{i+1:04d}",
            event_type=etype,
            bus_id=bus_ids[i % len(bus_ids)],
            camera_id=None,
            severity=sev,
            confidence=conf,
            latitude=lat,
            longitude=lon,
            evidence_url=evt_url,
            metadata_json={"evidence_urls": urls} if urls else None,
            source="SIMULATED",
            created_at=now - timedelta(hours=(len(DEMO_EVENTS_AND_ISSUES) - i)),
        )
        db.add(event)
        counts["events"] += 1

        # Issue record
        issue = Issue(
            issue_id=f"RS-2026-{(i+1)*12:06d}",
            issue_type=etype,
            severity=sev,
            confidence=conf,
            latitude=lat,
            longitude=lon,
            first_seen=now - timedelta(days=5, hours=i),
            last_seen=now - timedelta(minutes=i * 15),
            observation_count=obs,
            department=dept,
            status=status,
            metadata_json={
                "title": desc, 
                "road_corridor": DEMO_ROUTES[i % len(DEMO_ROUTES)]["route_name"],
                "evidence_urls": urls
            },
        )
        db.add(issue)
        counts["issues"] += 1

        # Flush to get IDs and add the relation link
        await db.flush()
        link = IssueEvent(issue_id=issue.id, event_id=event.id)
        db.add(link)

    for i, (itype, sev, conf, lat, lon, plate, pconf) in enumerate(DEMO_INCIDENTS):
        inc = Incident(
            incident_id=f"INC-DEMO-{i+1:04d}",
            incident_type=itype,
            bus_id=bus_ids[i % len(bus_ids)],
            severity=sev,
            confidence=conf,
            latitude=lat,
            longitude=lon,
            plate_text=plate,
            plate_confidence=pconf,
            created_at=now - timedelta(hours=i * 2),
        )
        db.add(inc)
        counts["incidents"] += 1

    await db.commit()
    return {"status": "seeded", **counts}


async def reset_demo_data(db: AsyncSession) -> dict:
    models_to_clear = [
        VerificationRecord, Notification, IssueEvent, IssueAssignment, Evidence,
        Incident, VehicleTrack, TrafficRecord, Event, Issue, Camera, GPSPoint,
        SensingSession, Bus, Route,
    ]
    for model in models_to_clear:
        try:
            await db.execute(delete(model))
        except Exception:
            pass

    await db.commit()
    return {"status": "reset"}
