"""Incident promotion: turn high-risk events (rash driving, hit-and-run,
collision) into command-center Incident alerts carrying plate + GPS + timestamp.

The edge device already attaches plate_text / plate_confidence and accurate GPS
when it reports these events; this service dedupes and materialises them in the
incidents table so authority dashboards and the alert flow see them immediately.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models import Event, Incident


async def create_incident_from_event(event: Event, db: AsyncSession) -> Incident | None:
    """Create an Incident for a high-risk event unless a recent matching one
    already exists (same bus, same type, within the last 10 minutes)."""
    recent = await db.execute(
        select(Incident).where(
            Incident.bus_id == event.bus_id,
            Incident.incident_type == event.event_type,
            Incident.status.in_(["DETECTED", "REPORTED"]),
            Incident.created_at >= datetime.now(timezone.utc) - timedelta(minutes=10),
        ).limit(1)
    )
    if recent.scalar_one_or_none() is not None:
        return None

    metadata = event.metadata_json or {}
    incident = Incident(
        incident_id=f"INC-{event.event_id}",
        incident_type=event.event_type,
        bus_id=event.bus_id,
        camera_id=event.camera_id,
        severity=event.severity,
        confidence=event.confidence,
        latitude=event.latitude,
        longitude=event.longitude,
        plate_text=metadata.get("plate_text"),
        plate_confidence=metadata.get("plate_confidence"),
        evidence_url=event.evidence_url,
        status="DETECTED",
    )
    db.add(incident)
    await db.commit()
    await db.refresh(incident)
    return incident