"""UrbanSense AI — Continuous Sensing & Live Event Generation Service.

Simulates the continuous multi-bus edge telemetry and optical defect detection
fleet across the Pune urban transit network in real-time.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.database.session import async_session_factory
from backend.app.models import Bus, Event, GPSPoint, Issue
from backend.app.services.issue_service import create_or_merge_issue, INCIDENT_EVENT_TYPES
from backend.app.services.incident_service import create_incident_from_event
from backend.app.services.verification_service import process_verification
from backend.app.websocket.manager import ws_manager

logger = logging.getLogger("urbansense.continuous")

PUNE_SENSING_CORRIDORS = [
    {"name": "FC Road BRT Corridor, Shivaji Nagar", "lat": 18.5318, "lon": 73.8428, "ward": "Shivajinagar - Ward 4"},
    {"name": "JM Road Near Sambhaji Park", "lat": 18.5284, "lon": 73.8465, "ward": "Shivajinagar - Ward 4"},
    {"name": "University Road Outer Transit Lane", "lat": 18.5360, "lon": 73.8340, "ward": "Aundh-Baner - Ward 2"},
    {"name": "Deccan Corner BRT Junction Approach", "lat": 18.5180, "lon": 73.8410, "ward": "Deccan Gymkhana - Ward 8"},
    {"name": "Karve Road Flyover Descent Corridor", "lat": 18.5085, "lon": 73.8315, "ward": "Kothrud - Ward 12"},
    {"name": "Swargate Transit Hub & Multimodal Depot", "lat": 18.5010, "lon": 73.8610, "ward": "Swargate - Ward 9"},
    {"name": "Senapati Bapat Road Corporate Corridor", "lat": 18.5320, "lon": 73.8300, "ward": "Gokhale Nagar - Ward 7"},
    {"name": "Baner High Street BRT Link", "lat": 18.5590, "lon": 73.7860, "ward": "Baner - Ward 1"},
    {"name": "Yerawada Bridge / Gunjan Chowk", "lat": 18.5520, "lon": 73.8820, "ward": "Yerawada - Ward 6"},
    {"name": "Koregaon Park North Main Road", "lat": 18.5370, "lon": 73.8880, "ward": "Koregaon Park - Ward 5"},
    {"name": "Viman Nagar Airport Road Crossing", "lat": 18.5679, "lon": 73.9143, "ward": "Viman Nagar - Ward 3"},
    {"name": "Hadapsar Gadital Transit Interchange", "lat": 18.5030, "lon": 73.9280, "ward": "Hadapsar - Ward 11"},
]

DEFECT_SCENARIOS = [
    {"type": "POTHOLE", "severity": "HIGH", "min_conf": 0.85, "max_conf": 0.94, "width_cm": 72.0, "depth_cm": 8.0},
    {"type": "POTHOLE", "severity": "CRITICAL", "min_conf": 0.90, "max_conf": 0.98, "width_cm": 95.0, "depth_cm": 12.0},
    {"type": "LONGITUDINAL_CRACK", "severity": "MEDIUM", "min_conf": 0.80, "max_conf": 0.90, "width_cm": 120.0, "depth_cm": 3.5},
    {"type": "ALLIGATOR_CRACK", "severity": "HIGH", "min_conf": 0.84, "max_conf": 0.92, "width_cm": 180.0, "depth_cm": 5.0},
    {"type": "TRANSVERSE_CRACK", "severity": "MEDIUM", "min_conf": 0.78, "max_conf": 0.88, "width_cm": 90.0, "depth_cm": 4.0},
    {"type": "UTILITY_COVER_DAMAGE", "severity": "CRITICAL", "min_conf": 0.88, "max_conf": 0.96, "width_cm": 60.0, "depth_cm": 10.0},
    {"type": "SURFACE_WEAR", "severity": "LOW", "min_conf": 0.75, "max_conf": 0.84, "width_cm": 150.0, "depth_cm": 2.0},
    {"type": "RASH_DRIVING", "severity": "CRITICAL", "min_conf": 0.88, "max_conf": 0.96, "is_incident": True},
    {"type": "PEDESTRIAN_RISK", "severity": "HIGH", "min_conf": 0.82, "max_conf": 0.92, "is_incident": True},
]

BUS_FLEET = ["BUS-001", "BUS-002", "BUS-003", "BUS-004", "BUS-005", "BUS-006"]


class ContinuousSensingService:
    def __init__(self) -> None:
        self._running: bool = False
        self._task: Optional[asyncio.Task] = None
        self._interval_seconds: float = 5.0
        self._events_emitted: int = 0
        self._issues_affected: int = 0
        self._verifications_run: int = 0
        self._last_emitted_at: Optional[datetime] = None
        self._step_counter: int = 0

    @property
    def is_running(self) -> bool:
        return self._running and self._task is not None and not self._task.done()

    def start(self, interval_seconds: float = 5.0) -> bool:
        """Start the continuous event streaming background loop."""
        self._interval_seconds = max(2.0, interval_seconds)
        if self.is_running:
            return True
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("[CONTINUOUS] Started sensing loop at %.1fs interval", self._interval_seconds)
        return True

    def stop(self) -> bool:
        """Stop the continuous event streaming background loop."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
        self._task = None
        logger.info("[CONTINUOUS] Stopped sensing loop")
        return True

    def status(self) -> dict:
        return {
            "is_running": self.is_running,
            "interval_seconds": self._interval_seconds,
            "events_emitted": self._events_emitted,
            "issues_affected": self._issues_affected,
            "verifications_run": self._verifications_run,
            "last_emitted_at": self._last_emitted_at.isoformat() if self._last_emitted_at else None,
            "step_counter": self._step_counter,
        }

    async def _ensure_bus(self, db: AsyncSession, bus_number: str) -> Bus:
        res = await db.execute(select(Bus).where(Bus.bus_number == bus_number))
        bus = res.scalar_one_or_none()
        if not bus:
            bus = Bus(bus_number=bus_number, status="ACTIVE", route_id="PUNE-BRT-1")
            db.add(bus)
            await db.flush()
        return bus

    async def _emit_cycle(self) -> None:
        """Execute a single continuous sensing cycle."""
        self._step_counter += 1
        now_utc = datetime.now(timezone.utc)
        corridor = PUNE_SENSING_CORRIDORS[self._step_counter % len(PUNE_SENSING_CORRIDORS)]
        scenario = DEFECT_SCENARIOS[self._step_counter % len(DEFECT_SCENARIOS)]
        bus_number = BUS_FLEET[self._step_counter % len(BUS_FLEET)]

        # Small GPS jitter around the corridor
        lat = round(corridor["lat"] + random.uniform(-0.0003, 0.0003), 6)
        lon = round(corridor["lon"] + random.uniform(-0.0003, 0.0003), 6)
        confidence = round(random.uniform(scenario["min_conf"], scenario["max_conf"]), 2)
        speed = round(random.uniform(22.0, 48.0), 1)
        heading = round(random.uniform(0.0, 360.0), 1)

        async with async_session_factory() as db:
            try:
                # 1. Update Bus Telemetry
                bus = await self._ensure_bus(db, bus_number)

                # Persist GPS trace
                gps_pt = GPSPoint(
                    bus_id=bus.id,
                    latitude=lat,
                    longitude=lon,
                    speed=speed,
                    heading=heading,
                    timestamp=now_utc.isoformat(),
                )
                db.add(gps_pt)

                # Broadcast bus movement
                await ws_manager.broadcast("buses", {
                    "type": "bus_telemetry",
                    "bus_id": str(bus.id),
                    "bus_number": bus.bus_number,
                    "latitude": lat,
                    "longitude": lon,
                    "speed": speed,
                    "heading": heading,
                    "timestamp": now_utc.isoformat(),
                })

                # 2. Check if this cycle is an independent multi-bus verification
                # Every 5th cycle, verify an existing open issue
                if self._step_counter % 5 == 0:
                    open_issues_res = await db.execute(
                        select(Issue)
                        .where(Issue.status.in_(["ASSIGNED", "IN_PROGRESS", "PENDING_VERIFICATION", "OPEN"]))
                        .order_by(func.random())
                        .limit(1)
                    )
                    issue_to_verify = open_issues_res.scalar_one_or_none()
                    if issue_to_verify:
                        verify_res = await process_verification(
                            issue_id=issue_to_verify.id,
                            bus_id=bus.id,
                            latitude=issue_to_verify.latitude,
                            longitude=issue_to_verify.longitude,
                            detection_result=random.choice(["CLEAR", "DETECTED", "CLEAR"]),
                            confidence=0.92,
                            db=db,
                        )
                        self._verifications_run += 1
                        await ws_manager.broadcast("events", {
                            "type": "verification",
                            "issue_id": issue_to_verify.issue_id,
                            "bus": bus.bus_number,
                            "result": verify_res.get("detection_result"),
                            "unique_clear": verify_res.get("unique_clear_count", 0),
                            "unique_detected": verify_res.get("unique_detected_count", 0),
                            "issue_status": verify_res.get("issue_status"),
                        })
                        await db.commit()
                        return

                # 3. Create Continuous Detection Event
                event_suffix = f"{int(time.time() * 1000) % 100000:05d}"
                event_id = f"EVT-LIVE-{event_suffix}"

                event = Event(
                    event_id=event_id,
                    event_type=scenario["type"],
                    bus_id=bus.id,
                    severity=scenario["severity"],
                    confidence=confidence,
                    latitude=lat,
                    longitude=lon,
                    source="EDGE_AI",
                    evidence_url="/evidence/pothole_detected_2.jpg",
                    metadata_json={
                        "continuous": True,
                        "road_name": corridor["name"],
                        "ward": corridor["ward"],
                        "defect_dimensions": {
                            "width_cm": scenario.get("width_cm", 60.0),
                            "depth_cm": scenario.get("depth_cm", 6.0),
                        },
                        "vehicle_plate": f"MH-12-{random.choice(['AB', 'CD', 'EF', 'XY'])}-{random.randint(1000, 9999)}"
                        if scenario.get("is_incident") else None,
                    },
                )
                db.add(event)
                await db.commit()
                await db.refresh(event)

                self._events_emitted += 1
                self._last_emitted_at = now_utc

                # 4. Process Incident vs Infrastructure Issue
                if scenario.get("is_incident") or scenario["type"] in INCIDENT_EVENT_TYPES:
                    incident = await create_incident_from_event(event, db)
                    if incident:
                        await ws_manager.broadcast("events", {
                            "type": "new_incident",
                            "incident_id": incident.incident_id,
                            "incident_type": incident.incident_type,
                            "severity": incident.severity,
                            "plate_text": incident.plate_text,
                            "latitude": incident.latitude,
                            "longitude": incident.longitude,
                            "bus_id": str(incident.bus_id),
                            "road_name": corridor["name"],
                        })
                else:
                    issue = await create_or_merge_issue(event, db)
                    self._issues_affected += 1
                    await ws_manager.broadcast("events", {
                        "type": "new_issue",
                        "issue_id": issue.issue_id,
                        "issue_type": issue.issue_type,
                        "severity": issue.severity,
                        "department": issue.department,
                        "status": issue.status,
                        "road_name": corridor["name"],
                    })

                # 5. Broadcast new_event
                await ws_manager.broadcast("events", {
                    "type": "new_event",
                    "event_id": event.event_id,
                    "event_type": event.event_type,
                    "severity": event.severity,
                    "confidence": event.confidence,
                    "latitude": event.latitude,
                    "longitude": event.longitude,
                    "source": "EDGE_AI",
                    "bus_number": bus_number,
                    "road_name": corridor["name"],
                    "created_at": now_utc.isoformat(),
                })

                logger.debug(
                    "[CONTINUOUS] Emitted %s on %s by %s (conf=%.2f)",
                    scenario["type"],
                    corridor["name"],
                    bus_number,
                    confidence,
                )
            except Exception as exc:
                logger.error("[CONTINUOUS] Cycle error: %s", exc, exc_info=True)
                await db.rollback()

    async def _loop(self) -> None:
        """Main continuous background loop with non-blocking sleep."""
        # Wait 2 seconds on startup before generating the first live event
        await asyncio.sleep(2.0)
        while self._running:
            try:
                await self._emit_cycle()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("[CONTINUOUS] Loop exception: %s", e)
            await asyncio.sleep(self._interval_seconds)


continuous_sensing_service = ContinuousSensingService()
