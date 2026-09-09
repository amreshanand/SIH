from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import require_admin
from backend.app.core.config import settings
from backend.app.database.session import get_db
from backend.app.models import (
    Bus, Camera, Event, Issue, User, GPSPoint, IssueEvent, VerificationRecord,
    IssueAssignment, Incident,
)
from backend.app.seed.demo_data import seed_demo_data
from backend.app.services.issue_service import create_or_merge_issue, INCIDENT_EVENT_TYPES
from backend.app.services.verification_service import process_verification
from backend.app.services.incident_service import create_incident_from_event
from backend.app.websocket.manager import ws_manager

router = APIRouter(prefix="/demo", tags=["Demo"])


async def _demo_enabled() -> None:
    """Demo endpoints are disabled in production.

    They are scripted deterministic demonstrations intended only for SIH
    presentations. When DEMO_MODE=false (production default) every route in
    this router returns 403. This does NOT affect real edge ingestion, which
    goes through /api/events.
    """
    if not settings.demo_mode:
        raise HTTPException(
            status_code=403,
            detail="Demo API is disabled. Set DEMO_MODE=true to enable scripted demonstrations.",
        )


demo_guard = Depends(_demo_enabled)

DEMO_LIFECYCLE = [
    {
        "step": 1, "action": "STATUS",
        "message": "BUS-001 begins route on University Road, Pune",
    },
    {
        "step": 2, "action": "STATUS",
        "message": "Camera ONLINE, GPS ONLINE, AI ONLINE",
    },
    {
        "step": 3, "action": "STATUS",
        "message": "Vehicle detection begins — multiple vehicles tracked",
    },
    {
        "step": 4, "action": "EVENT",
        "message": "POTHOLE detected on University Road (first observation)",
        "event_type": "POTHOLE", "severity": "HIGH", "confidence": 0.91,
        "lat": 18.5204, "lon": 73.8567, "bus": "BUS-001",
    },
    {
        "step": 5, "action": "EVENT",
        "message": "Second observation — temporal confirmation (same location)",
        "event_type": "POTHOLE", "severity": "HIGH", "confidence": 0.89,
        "lat": 18.5204, "lon": 73.8567, "bus": "BUS-001",
    },
    {
        "step": 6, "action": "EVENT",
        "message": "Third observation — event CONFIRMED",
        "event_type": "POTHOLE", "severity": "HIGH", "confidence": 0.93,
        "lat": 18.5204, "lon": 73.8567, "bus": "BUS-001",
    },
    {
        "step": 7, "action": "EVENT",
        "message": "BUS-002 detects RASH DRIVING — erratic 3x speed spike (plate read)",
        "event_type": "RASH_DRIVING", "severity": "CRITICAL", "confidence": 0.92,
        "lat": 18.5132, "lon": 73.8361, "bus": "BUS-002",
        "metadata": {"plate_text": "MH-12-AB-3456", "plate_confidence": 0.88, "vehicle_class": "car"},
    },
    {
        "step": 8, "action": "EVENT",
        "message": "BUS-004 flags HIT-AND-RUN collision at signal — plate captured",
        "event_type": "HIT_AND_RUN", "severity": "CRITICAL", "confidence": 0.9,
        "lat": 18.5455, "lon": 73.8447, "bus": "BUS-004",
        "metadata": {"plate_text": "MH-14-CD-7890", "plate_confidence": 0.91, "vehicle_class": "car"},
    },
    {
        "step": 9, "action": "STATUS",
        "message": "Backend creates issue RS-2026-DEMO1",
    },
    {
        "step": 10, "action": "STATUS",
        "message": "System routes to ROAD_MAINTENANCE department",
    },
    {
        "step": 11, "action": "NOTIFICATION",
        "message": "Authority receives notification",
    },
    {
        "step": 12, "action": "ASSIGN",
        "message": "Authority accepts assignment",
        "authority": "authority_road",
        "notes": "Dispatching maintenance crew to University Road pothole",
    },
    {
        "step": 13, "action": "STATUS_UPDATE",
        "message": "Work starts — status IN_PROGRESS",
        "new_status": "IN_PROGRESS",
    },
    {
        "step": 14, "action": "STATUS_UPDATE",
        "message": "Ready for verification — PENDING_VERIFICATION",
        "new_status": "PENDING_VERIFICATION",
    },
    {
        "step": 15, "action": "VERIFY",
        "message": "BUS-002 passes same location — CLEAR (confidence 0.88)",
        "bus": "BUS-002", "result": "CLEAR", "confidence": 0.88,
    },
    {
        "step": 16, "action": "VERIFY",
        "message": "BUS-003 passes same location — CLEAR (confidence 0.91)",
        "bus": "BUS-003", "result": "CLEAR", "confidence": 0.91,
    },
    {
        "step": 17, "action": "VERIFY",
        "message": "BUS-004 passes same location — CLEAR (confidence 0.94)",
        "bus": "BUS-004", "result": "CLEAR", "confidence": 0.94,
    },
    {
        "step": 18, "action": "STATUS",
        "message": "SYSTEM AUTO-RESOLVES — 3/3 independent CLEAR observations",
    },
    {
        "step": 19, "action": "EVENT",
        "message": "BUS-001 detects pothole again at same location",
        "event_type": "POTHOLE", "severity": "HIGH", "confidence": 0.87,
        "lat": 18.5204, "lon": 73.8567, "bus": "BUS-001",
    },
    {
        "step": 20, "action": "STATUS",
        "message": "SYSTEM REOPENS issue — problem has returned",
    },
    {
        "step": 21, "action": "STATUS",
        "message": "Demo complete — full DETECT→REPORT→ASSIGN→ACT→VERIFY→RESOLVE→REOPEN loop demonstrated",
    },
]

BUS_NUMBERS = ["BUS-001", "BUS-002", "BUS-003", "BUS-004"]


class StepRequest(BaseModel):
    step: int


class StepContext:
    """Mutable per-run shared state recovered/initialised on each request."""

    def __init__(self, bus_map: dict[str, Bus], authority: User | None,
                 created_issue_id: str | None):
        self.bus_map = bus_map
        self.authority = authority
        self.created_issue_id = created_issue_id


async def _ensure_buses(db: AsyncSession) -> dict[str, Bus]:
    """Create (if missing) and return the four demo buses."""
    bus_map: dict[str, Bus] = {}
    for bus_number in BUS_NUMBERS:
        result = await db.execute(select(Bus).where(Bus.bus_number == bus_number))
        bus = result.scalar_one_or_none()
        if bus is None:
            bus = Bus(bus_number=bus_number, status="ACTIVE")
            db.add(bus)
            await db.commit()
            await db.refresh(bus)
        bus_map[bus_number] = bus
    return bus_map


async def _find_authority(db: AsyncSession) -> User | None:
    result = await db.execute(select(User).where(User.username == "authority_road"))
    return result.scalar_one_or_none()


async def _recover_issue(db: AsyncSession) -> str | None:
    """Recover the demo issue created by the step-4 event (if present)."""
    row = await db.execute(
        select(IssueEvent.issue_id)
        .join(Event, Event.id == IssueEvent.event_id)
        .where(Event.event_id.like("EVT-DEMO-04-%"))
        .limit(1)
    )
    issue_uuid = row.scalar_one_or_none()
    if issue_uuid is None:
        return None
    issue_result = await db.execute(select(Issue).where(Issue.id == issue_uuid))
    issue = issue_result.scalar_one_or_none()
    return issue.issue_id if issue else None


async def _load_context(db: AsyncSession) -> StepContext:
    """Recover or initialise the shared demo state across step calls."""
    bus_map = await _ensure_buses(db)
    authority = await _find_authority(db)
    created_issue_id = await _recover_issue(db)
    return StepContext(bus_map, authority, created_issue_id)


async def _execute_step(db: AsyncSession, step_def: dict, ctx: StepContext) -> dict:
    """Execute a single lifecycle step. Returns its step_result (det. fields)."""
    step_num = step_def["step"]
    action = step_def["action"]
    await asyncio.sleep(0.25)

    step_result: dict = {"step": step_num, "action": action, "message": step_def["message"]}

    if action == "EVENT":
        bus_num = step_def.get("bus", "BUS-001")
        target_bus = ctx.bus_map.get(bus_num, ctx.bus_map["BUS-001"])

        event_counter = int(time.time() * 1000) % 100000
        event = Event(
            event_id=f"EVT-DEMO-{step_num:02d}-{event_counter:05d}",
            event_type=step_def["event_type"],
            bus_id=target_bus.id,
            severity=step_def["severity"],
            confidence=step_def["confidence"],
            latitude=step_def["lat"],
            longitude=step_def["lon"],
            source="SIMULATED",
            metadata_json={"demo": True, "step": step_num, **step_def.get("metadata", {})},
        )
        db.add(event)
        await db.commit()
        await db.refresh(event)

        step_result["event_id"] = event.event_id
        step_result["source"] = "SIMULATED"

        if event.event_type in INCIDENT_EVENT_TYPES:
            # High-risk event → promote to a command-center Incident (plate +
            # GPS + timestamp alert) instead of an infrastructure Issue.
            incident = await create_incident_from_event(event, db)
            if incident:
                step_result["incident_id"] = incident.incident_id
                step_result["incident_status"] = incident.status
                await ws_manager.broadcast("events", {
                    "type": "new_incident",
                    "step": step_num,
                    "incident_id": incident.incident_id,
                    "incident_type": incident.incident_type,
                    "severity": incident.severity,
                    "plate_text": incident.plate_text,
                    "latitude": incident.latitude,
                    "longitude": incident.longitude,
                    "bus_id": str(incident.bus_id),
                })
        else:
            issue = await create_or_merge_issue(event, db)
            if ctx.created_issue_id is None:
                ctx.created_issue_id = issue.issue_id

            step_result["issue_id"] = issue.issue_id
            step_result["issue_status"] = issue.status

            await ws_manager.broadcast("events", {
                "type": "new_event",
                "step": step_num,
                "event_id": event.event_id,
                "event_type": event.event_type,
                "severity": event.severity,
                "confidence": event.confidence,
                "latitude": event.latitude,
                "longitude": event.longitude,
                "source": "SIMULATED",
            })

    elif action == "ASSIGN" and ctx.created_issue_id and ctx.authority:
        issue_result = await db.execute(
            select(Issue).where(Issue.issue_id == ctx.created_issue_id)
        )
        issue = issue_result.scalar_one_or_none()
        if issue:
            assignment = IssueAssignment(
                issue_id=issue.id,
                authority_id=ctx.authority.id,
                notes=step_def.get("notes", ""),
                status="ASSIGNED",
            )
            db.add(assignment)
            issue.status = "ASSIGNED"
            issue.updated_at = datetime.now(timezone.utc)
            await db.commit()
            step_result["issue_status"] = "ASSIGNED"
            step_result["source"] = "SIMULATED"

            await ws_manager.broadcast("events", {
                "type": "issue_assigned",
                "step": step_num,
                "issue_id": issue.issue_id,
                "authority": "authority_road",
            })

    elif action == "STATUS_UPDATE" and ctx.created_issue_id:
        issue_result = await db.execute(
            select(Issue).where(Issue.issue_id == ctx.created_issue_id)
        )
        issue = issue_result.scalar_one_or_none()
        if issue:
            old_status = issue.status
            issue.status = step_def["new_status"]
            issue.updated_at = datetime.now(timezone.utc)
            await db.commit()
            step_result["issue_status"] = issue.status
            step_result["source"] = "SIMULATED"

            await ws_manager.broadcast("events", {
                "type": "issue_updated",
                "step": step_num,
                "issue_id": issue.issue_id,
                "old_status": old_status,
                "new_status": issue.status,
            })

    elif action == "VERIFY" and ctx.created_issue_id:
        issue_result = await db.execute(
            select(Issue).where(Issue.issue_id == ctx.created_issue_id)
        )
        issue = issue_result.scalar_one_or_none()
        if issue:
            bus_num = step_def["bus"]
            verify_bus = ctx.bus_map.get(bus_num, ctx.bus_map["BUS-002"])

            await asyncio.sleep(0.4)

            result = await process_verification(
                issue_id=issue.id,
                bus_id=verify_bus.id,
                latitude=issue.latitude,
                longitude=issue.longitude,
                detection_result=step_def["result"],
                confidence=step_def["confidence"],
                evidence_url=None,
                db=db,
            )

            step_result["verification"] = result
            step_result["source"] = "SIMULATED"

            await ws_manager.broadcast("events", {
                "type": "verification",
                "step": step_num,
                "issue_id": issue.issue_id,
                "bus": bus_num,
                "result": step_def["result"],
                "unique_clear": result.get("unique_clear_count", 0),
                "unique_detected": result.get("unique_detected_count", 0),
                "issue_status": result.get("issue_status"),
            })

    elif action == "NOTIFICATION":
        await ws_manager.broadcast("notifications", {
            "type": "notification",
            "step": step_num,
            "title": "NEW HIGH PRIORITY ISSUE: POTHOLE",
            "body": "University Road, Pune | Department: ROAD_MAINTENANCE",
        })

    elif action == "STATUS":
        if ctx.created_issue_id and step_num in (18, 20):
            issue_result = await db.execute(
                select(Issue).where(Issue.issue_id == ctx.created_issue_id)
            )
            issue = issue_result.scalar_one_or_none()
            if issue:
                step_result["issue_status"] = issue.status

        await ws_manager.broadcast("events", {
            "type": "demo_step",
            "step": step_num,
            "message": step_def["message"],
        })

    return step_result


@router.post("/seed")
async def seed_demo(db: AsyncSession = Depends(get_db), _admin: User = Depends(require_admin),
                    _g: None = demo_guard) -> dict:
    result = await seed_demo_data(db)
    return {"status": "seeded", **result}


@router.post("/reset")
async def reset_demo(db: AsyncSession = Depends(get_db), _admin: User = Depends(require_admin),
                     _g: None = demo_guard) -> dict:
    await db.execute(text(
        "TRUNCATE verification_records, notifications, audit_logs, issue_events, "
        "issue_assignments, issue_resolutions, evidence, incidents, vehicle_tracks, "
        "traffic_records, events, issues, cameras, sensing_sessions, buses, "
        "routes, gps_points CASCADE"
    ))
    await db.execute(text("DELETE FROM users WHERE username != 'admin'"))
    await db.commit()
    return {"status": "reset", "message": "All demo data cleared"}


@router.post("/sih")
async def sih_mode(db: AsyncSession = Depends(get_db), _admin: User = Depends(require_admin),
                   _g: None = demo_guard) -> dict:
    """One-click SIH MODE: clean database, seed demo data, run the 21-step lifecycle."""
    await reset_demo(db=db, _admin=_admin, _g=None)
    seed_result = await seed_demo_data(db)
    ctx = await _load_context(db)
    steps_completed = []
    created_issue_id = None
    for step_def in DEMO_LIFECYCLE:
        step_result = await _execute_step(db, step_def, ctx)
        steps_completed.append(step_result)
        if ctx.created_issue_id and created_issue_id is None:
            created_issue_id = ctx.created_issue_id

    return {
        "status": "demo_complete",
        "total_steps": len(DEMO_LIFECYCLE),
        "steps_completed": steps_completed,
        "issue_created": created_issue_id,
        "flow": "DETECT → REPORT → ASSIGN → ACT → VERIFY → RESOLVE → REOPEN",
    }


@router.get("/status")
async def demo_status(db: AsyncSession = Depends(get_db)) -> dict:
    bus_count = (await db.execute(select(func.count(Bus.id)))).scalar() or 0
    event_count = (await db.execute(select(func.count(Event.id)))).scalar() or 0
    issue_count = (await db.execute(select(func.count(Issue.id)))).scalar() or 0
    incident_count = (await db.execute(select(func.count(Incident.id)))).scalar() or 0

    return {
        "buses": bus_count,
        "events": event_count,
        "issues": issue_count,
        "incidents": incident_count,
        "lifecycle_steps": len(DEMO_LIFECYCLE),
    }


@router.post("/step")
async def run_single_step(payload: StepRequest, db: AsyncSession = Depends(get_db),
                          _admin: User = Depends(require_admin)) -> dict:
    """Execute a single lifecycle step (1..21). Enables START/NEXT controls."""
    if payload.step < 1 or payload.step > len(DEMO_LIFECYCLE):
        return {"status": "invalid_step", "step": payload.step,
                "total_steps": len(DEMO_LIFECYCLE)}
    step_def = DEMO_LIFECYCLE[payload.step - 1]
    ctx = await _load_context(db)
    step_result = await _execute_step(db, step_def, ctx)
    step_result["status"] = "step_complete"
    step_result["total_steps"] = len(DEMO_LIFECYCLE)
    step_result["issue_created"] = ctx.created_issue_id
    return step_result


@router.post("/run")
async def run_demo(db: AsyncSession = Depends(get_db), _admin: User = Depends(require_admin)) -> dict:
    """Fast-forward / full run: execute the entire 21-step lifecycle."""
    ctx = await _load_context(db)
    steps_completed = []
    created_issue_id = None
    for step_def in DEMO_LIFECYCLE:
        step_result = await _execute_step(db, step_def, ctx)
        steps_completed.append(step_result)
        if ctx.created_issue_id and created_issue_id is None:
            created_issue_id = ctx.created_issue_id

    return {
        "status": "demo_complete",
        "total_steps": len(DEMO_LIFECYCLE),
        "steps_completed": steps_completed,
        "issue_created": created_issue_id,
        "flow": "DETECT → REPORT → ASSIGN → ACT → VERIFY → RESOLVE → REOPEN",
    }
