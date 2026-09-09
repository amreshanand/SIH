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
    already exists (same bus + type within 10 min, or same tracked vehicle via
    track_id)."""
    metadata = event.metadata_json or {}
    track_id = metadata.get("track_id")

    # Dedup: same bus + type already DETECTED/REPORTED recently.
    q = select(Incident).where(
        Incident.bus_id == event.bus_id,
        Incident.incident_type == event.event_type,
        Incident.status.in_(["DETECTED", "REPORTED"]),
        Incident.created_at >= datetime.now(timezone.utc) - timedelta(minutes=10),
    )
    if track_id is not None:
        # Prefer dedup by the tracked object: the same physical vehicle causing
        # repeated frames must not spawn new incidents.
        q = q.where(
            (Incident.metadata_json["track_id"].astext == str(track_id))
            | (Incident.latitude == event.latitude)
        )
    q = q.limit(1)
    try:
        recent = await db.execute(q)
        if recent.scalar_one_or_none() is not None:
            return None
    except Exception:
        # fallback: dedup by bus+type only (e.g. JSONB index missing)
        q2 = select(Incident).where(
            Incident.bus_id == event.bus_id,
            Incident.incident_type == event.event_type,
            Incident.status.in_(["DETECTED", "REPORTED"]),
            Incident.created_at >= datetime.now(timezone.utc) - timedelta(minutes=10),
        ).limit(1)
        if (await db.execute(q2)).scalar_one_or_none() is not None:
            return None

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
        metadata_json={
            "track_id": track_id,
            "source_model": metadata.get("source_model"),
            "bbox": metadata.get("bbox"),
            "speed_px_s": metadata.get("speed_px_s"),
        },
    )
    db.add(incident)
    await db.commit()
    await db.refresh(incident)
    return incident