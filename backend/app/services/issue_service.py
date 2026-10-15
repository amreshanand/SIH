from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.models import Bus, Event, Issue, IssueEvent, IssueResolution
from backend.app.services.spatial import distance_m_async, postgis_available
from backend.app.services.geo_validation_service import GeoValidationService
from backend.app.services.consensus_engine import MultiBusConsensusEngine
from backend.app.websocket.manager import ws_manager


VALID_TRANSITIONS = {
    "OPEN": ["ASSIGNED", "REOPENED"],
    "ASSIGNED": ["IN_PROGRESS", "OPEN"],
    "IN_PROGRESS": ["PENDING_VERIFICATION", "ASSIGNED"],
    "PENDING_VERIFICATION": ["RESOLVED", "IN_PROGRESS"],
    "RESOLVED": ["REOPENED"],
    "REOPENED": ["ASSIGNED"],
}

CONSENSUS_TRANSITIONS = {
    "DETECTED": ["CONFIRMED", "ASSIGNED", "OPEN", "REOPENED"],
    "CONFIRMED": ["ASSIGNED", "IN_PROGRESS", "OPEN"],
}


def validate_transition(current_status: str, new_status: str) -> bool:
    if new_status in VALID_TRANSITIONS.get(current_status, []):
        return True
    return new_status in CONSENSUS_TRANSITIONS.get(current_status, [])


def get_valid_transitions(current_status: str) -> list[str]:
    return VALID_TRANSITIONS.get(current_status) or CONSENSUS_TRANSITIONS.get(current_status, [])


DEPARTMENT_ROUTING = {
    # Canonical 9-class road-damage taxonomy → maintenance/utility departments
    "POTHOLE": "ROAD_MAINTENANCE",
    "LONGITUDINAL_CRACK": "ROAD_MAINTENANCE",
    "TRANSVERSE_CRACK": "ROAD_MAINTENANCE",
    "ALLIGATOR_CRACK": "ROAD_MAINTENANCE",
    "EDGE_BREAK": "ROAD_MAINTENANCE",
    "RUTTING": "ROAD_MAINTENANCE",
    "SURFACE_WEAR": "ROAD_MAINTENANCE",
    "PATCH_FAILURE": "ROAD_MAINTENANCE",
    "UTILITY_COVER_DAMAGE": "DRAINAGE",
    # Legacy aliases (ingested from older edge builds / external datasets)
    "ROAD_CRACK": "ROAD_MAINTENANCE",
    "DAMAGED_ROAD": "ROAD_MAINTENANCE",
    "WATERLOGGING": "DRAINAGE",
    "MISSING_SIGN": "TRAFFIC_INFRASTRUCTURE",
    "MISSING_CROSSING": "TRAFFIC_INFRASTRUCTURE",
    "MISSING_DIVIDER": "TRAFFIC_INFRASTRUCTURE",
    "DAMAGED_SIGN": "TRAFFIC_INFRASTRUCTURE",
    "STREET_LIGHT": "ELECTRICAL",
    "PEDESTRIAN_RISK": "TRAFFIC_POLICE",
    "INCIDENT": "TRAFFIC_POLICE",
    "TRAFFIC_CONGESTION": "TRAFFIC_MANAGEMENT",
}

INCIDENT_EVENT_TYPES = {"RASH_DRIVING", "HIT_AND_RUN", "COLLISION", "PEDESTRIAN_RISK"}



def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    import math
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def create_or_merge_issue(
    event: Event,
    db: AsyncSession,
) -> Issue:
    geo_validator = GeoValidationService(cluster_radius_meters=settings.cluster_distance_meters)
    consensus_engine = MultiBusConsensusEngine()
    use_postgis = await postgis_available(db)

    # Resolve bus identifier for consensus tracking
    bus_obj = await db.get(Bus, event.bus_id)
    bus_str = bus_obj.bus_number if bus_obj else str(event.bus_id)

    event_meta = event.metadata_json or {}
    track_id = event_meta.get("track_id")
    bbox = event_meta.get("bbox")
    source_model = event_meta.get("source_model")
    fused_score = event.fused_score if event.fused_score is not None else event_meta.get("fused_score", event.confidence * 100)

    # Spatial optimization: Degree bounding-box pre-filter (~150m buffer)
    # Eliminates full-table candidate scans and scales to millions of issues
    import math
    search_buf_m = max(geo_validator.cluster_radius_meters * 3.0, 150.0)
    lat_delta = search_buf_m / 111_000.0
    cos_lat = math.cos(math.radians(event.latitude))
    lon_delta = search_buf_m / (111_000.0 * max(0.1, abs(cos_lat)))

    existing_issues = await db.execute(
        select(Issue).where(
            Issue.issue_type == event.event_type,
            Issue.status.in_(["OPEN", "DETECTED", "CONFIRMED", "ASSIGNED", "IN_PROGRESS", "REOPENED"]),
            Issue.latitude.between(event.latitude - lat_delta, event.latitude + lat_delta),
            Issue.longitude.between(event.longitude - lon_delta, event.longitude + lon_delta),
        )
    )
    issues = existing_issues.scalars().all()

    for issue in issues:
        issue_meta = issue.metadata_json or {}
        # In-memory Haversine distance avoids N+1 database roundtrips
        dist = haversine_meters(event.latitude, event.longitude, issue.latitude, issue.longitude)

        # Same track on the same bus can merge within a slightly relaxed spatial threshold (e.g. 30m)
        max_dist = geo_validator.cluster_radius_meters
        if track_id is not None and issue_meta.get("track_id") == track_id and str(issue_meta.get("bus")) == bus_str:
            max_dist = max(geo_validator.cluster_radius_meters, 30.0)

        if dist <= max_dist:
            issue.observation_count += 1
            issue.last_seen = datetime.now(timezone.utc)
            # Boost fused confidence asymptotically
            issue.confidence = geo_validator.boost_confidence(issue.confidence, event.confidence)
            if fused_score:
                issue.fused_confidence_score = max(issue.fused_confidence_score or 0.0, fused_score)

            if event.severity == "CRITICAL":
                issue.severity = "CRITICAL"
            elif event.severity == "HIGH" and issue.severity in ("LOW", "MEDIUM"):
                issue.severity = "HIGH"

            # Register multi-bus observation and upgrade consensus
            await consensus_engine.register_bus_observation(issue, bus_str, fused_score, db)

            # Preserve provenance from the acknowledged event.
            existing_meta = dict(issue_meta)
            existing_meta["track_id"] = track_id if track_id is not None else existing_meta.get("track_id")
            if bbox:
                existing_meta["bbox"] = bbox
            if source_model:
                existing_meta["source_model"] = source_model
            existing_meta["evidence_urls"] = existing_meta.get("evidence_urls", [])
            if event.evidence_url and event.evidence_url not in existing_meta["evidence_urls"]:
                existing_meta["evidence_urls"].append(event.evidence_url)
            if getattr(event, "ward", None):
                existing_meta["ward"] = event.ward
                issue.ward = event.ward
            if "chunk_id" not in existing_meta:
                from backend.app.services.road_chunking_service import road_chunk_service
                c_meta = road_chunk_service.assign_chunk(issue.latitude, issue.longitude)
                existing_meta["chunk_id"] = c_meta["chunk_id"]
                existing_meta["chunk_name"] = c_meta["chunk_name"]
                existing_meta["chunk_chainage"] = c_meta["chainage"]
                existing_meta["corridor_name"] = c_meta["corridor_name"]
            issue.metadata_json = existing_meta

            link = IssueEvent(issue_id=issue.id, event_id=event.id)
            db.add(link)

            # Audit: issue observed by another event/bus
            from backend.app.services.audit_service import log_action
            await log_action(
                user_id=None,
                action="ISSUE_OBSERVED",
                entity_type="ISSUE",
                entity_id=issue.issue_id,
                new_value={
                    "observation_count": issue.observation_count,
                    "event_id": event.event_id,
                    "bus": bus_str,
                    "consensus": issue.consensus_level,
                },
                db=db,
            )

            await db.commit()
            await db.refresh(issue)

            await ws_manager.broadcast("events", {
                "type": "issue_updated",
                "issue_id": issue.issue_id,
                "observation_count": issue.observation_count,
                "status": issue.status,
                "consensus_level": issue.consensus_level,
                "unique_bus_count": issue.unique_bus_count,
            })
            return issue

    base_counter = int(time.time()) % 100000
    issue_id = f"RS-2026-{base_counter:06d}"
    attempts = 0
    while attempts < 100:
        existing = await db.execute(select(Issue).where(Issue.issue_id == issue_id))
        if existing.scalar_one_or_none() is None:
            break
        base_counter = (base_counter + 1) % 1000000
        issue_id = f"RS-2026-{base_counter:06d}"
        attempts += 1

    # Attach the real evidence path captured by the edge device.
    evidence_urls = [event.evidence_url] if event.evidence_url else []

    from backend.app.services.road_chunking_service import road_chunk_service
    chunk_meta = road_chunk_service.assign_chunk(event.latitude, event.longitude)

    new_issue = Issue(
        issue_id=issue_id,
        issue_type=event.event_type,
        severity=event.severity,
        confidence=event.confidence,
        latitude=event.latitude,
        longitude=event.longitude,
        observation_count=1,
        department=DEPARTMENT_ROUTING.get(event.event_type, "GENERAL"),
        status="OPEN",
        consensus_level="DETECTED",
        unique_bus_count=1,
        distinct_buses_observed=[bus_str],
        fused_confidence_score=fused_score,
        road_mask_overlap_ratio=event.road_overlap_ratio,
        track_age_frames=event.track_age_frames,
        affected_road=chunk_meta.get("chunk_name"),
        ward=getattr(event, "ward", None) or chunk_meta.get("ward"),
        metadata_json={
            "evidence_urls": evidence_urls,
            "track_id": track_id,
            "bbox": bbox,
            "source_model": source_model,
            "ward": getattr(event, "ward", None) or chunk_meta.get("ward"),
            "chunk_id": chunk_meta.get("chunk_id"),
            "chunk_name": chunk_meta.get("chunk_name"),
            "chunk_chainage": chunk_meta.get("chainage"),
            "corridor_name": chunk_meta.get("corridor_name"),
        },
    )
    db.add(new_issue)
    await db.flush()

    link = IssueEvent(issue_id=new_issue.id, event_id=event.id)
    db.add(link)

    from backend.app.services.audit_service import log_action
    await log_action(
        user_id=None,
        action="ISSUE_CREATED",
        entity_type="ISSUE",
        entity_id=new_issue.issue_id,
        new_value={
            "issue_type": new_issue.issue_type,
            "severity": new_issue.severity,
            "department": new_issue.department,
            "bus": bus_str,
            "consensus": "DETECTED",
        },
        db=db,
    )

    db.add(IssueResolution(
        issue_id=new_issue.id,
        action="CREATED",
        from_status=None,
        to_status="OPEN",
    ))

    await db.commit()
    await db.refresh(new_issue)

    await ws_manager.broadcast("events", {
        "type": "new_issue",
        "issue_id": new_issue.issue_id,
        "issue_type": new_issue.issue_type,
        "severity": new_issue.severity,
        "department": new_issue.department,
    })

    # Notify routed department authorities of the new issue.
    try:
        from backend.app.services.notification_service import create_incident_notification
        await create_incident_notification(
            issue_id=new_issue.issue_id,
            issue_type=new_issue.issue_type,
            severity=new_issue.severity,
            confidence=new_issue.confidence,
            latitude=new_issue.latitude,
            longitude=new_issue.longitude,
            bus_id=event.bus_id,
            department=new_issue.department,
            db=db,
        )
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Issue notification failed: %s", e)

    return new_issue
