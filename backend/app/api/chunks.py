"""API endpoints for 500-Meter Road Chunks."""

from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database.session import get_db
from backend.app.services.road_chunking_service import road_chunk_service

router = APIRouter(prefix="/chunks", tags=["Road Chunks"])


@router.get("")
async def list_road_chunks(
    corridor_id: Optional[str] = None,
    status: Optional[str] = None,
    ward: Optional[str] = None,
    min_issues: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Returns all 500m road chunks with geometry, health scores, and active issue counts."""
    chunks = await road_chunk_service.get_all_chunks_with_metrics(db)

    filtered = chunks
    if corridor_id:
        filtered = [c for c in filtered if c["corridor_id"].lower() == corridor_id.lower()]
    if status:
        filtered = [c for c in filtered if c["status"].upper() == status.upper()]
    if ward:
        filtered = [c for c in filtered if ward.lower() in c.get("ward", "").lower()]
    if min_issues is not None:
        filtered = [c for c in filtered if c["active_issues_count"] >= min_issues]

    return {
        "chunks": filtered,
        "total": len(filtered),
        "total_unfiltered": len(chunks),
    }


@router.get("/summary")
async def road_chunks_summary(db: AsyncSession = Depends(get_db)) -> dict:
    """Returns city-wide network road chunk statistics and PCI health distribution."""
    chunks = await road_chunk_service.get_all_chunks_with_metrics(db)

    total = len(chunks)
    excellent = sum(1 for c in chunks if c["status"] == "EXCELLENT")
    good = sum(1 for c in chunks if c["status"] == "GOOD")
    fair = sum(1 for c in chunks if c["status"] == "FAIR")
    poor = sum(1 for c in chunks if c["status"] == "POOR")

    avg_health = round(sum(c["health_score"] for c in chunks) / total, 1) if total > 0 else 100.0
    total_issues = sum(c["active_issues_count"] for c in chunks)
    hotspot_chunks = [c for c in chunks if c["active_issues_count"] > 0]
    hotspot_chunks.sort(key=lambda c: (c["active_issues_count"], -c["health_score"]), reverse=True)

    return {
        "total_chunks": total,
        "total_network_km": round(total * 0.5, 1),
        "average_pci_health": avg_health,
        "total_active_defects": total_issues,
        "distribution": {
            "excellent": excellent,
            "good": good,
            "fair": fair,
            "poor": poor,
        },
        "critical_hotspots": hotspot_chunks[:8],
    }


@router.get("/{chunk_id}")
async def get_road_chunk(
    chunk_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Returns details and all contained issues for a specific 500m chunk."""
    chunk = await road_chunk_service.get_chunk_details(chunk_id.upper(), db)
    if not chunk:
        raise HTTPException(status_code=404, detail=f"Road chunk '{chunk_id}' not found")
    return chunk


@router.post("/{chunk_id}/dispatch")
async def dispatch_chunk_work_orders(
    chunk_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Dispatches municipal remediation work orders for all open defects in this 500m chunk."""
    chunk = await road_chunk_service.get_chunk_details(chunk_id.upper(), db)
    if not chunk:
        raise HTTPException(status_code=404, detail=f"Road chunk '{chunk_id}' not found")

    from backend.app.models import Issue, AuditLog
    import uuid
    from datetime import datetime, timezone

    DEPT_MAP = {
        "POTHOLE": "ROAD_MAINTENANCE",
        "ROAD_CRACK": "ROAD_MAINTENANCE",
        "DAMAGED_ROAD": "ROAD_MAINTENANCE",
        "WATERLOGGING": "DRAINAGE",
        "STREET_LIGHT": "ELECTRICAL",
        "MISSING_SIGN": "TRAFFIC_ENGINEERING",
        "DAMAGED_SIGN": "TRAFFIC_ENGINEERING",
        "MISSING_CROSSING": "TRAFFIC_ENGINEERING",
        "MISSING_DIVIDER": "ROAD_MAINTENANCE",
    }

    issues_data = chunk.get("issues", [])
    dispatched_count = 0
    work_order_id = f"WO-{chunk_id.upper()}-{int(datetime.now(timezone.utc).timestamp())}"

    for iss in issues_data:
        stmt = select(Issue).where(Issue.id == iss["id"])
        res = await db.execute(stmt)
        issue_model = res.scalar_one_or_none()
        if issue_model and issue_model.status in ["OPEN", "DETECTED", "CONFIRMED", "REOPENED"]:
            target_dept = DEPT_MAP.get(issue_model.issue_type, "ROAD_MAINTENANCE")
            issue_model.status = "ASSIGNED"
            issue_model.department = target_dept
            if not issue_model.metadata_json:
                issue_model.metadata_json = {}
            issue_model.metadata_json["work_order_id"] = work_order_id
            issue_model.metadata_json["dispatched_at"] = datetime.now(timezone.utc).isoformat()
            issue_model.metadata_json["chunk_id"] = chunk_id.upper()

            audit = AuditLog(
                id=uuid.uuid4(),
                user_id=None,
                action="WORK_ORDER_DISPATCHED",
                entity_type="ISSUE",
                entity_id=issue_model.issue_id,
                old_value={"status": "OPEN"},
                new_value={"status": "ASSIGNED", "department": target_dept, "work_order_id": work_order_id},
                metadata_json={"chunk_id": chunk_id.upper()},
                created_at=datetime.now(timezone.utc),
            )
            db.add(audit)
            dispatched_count += 1

    if dispatched_count > 0:
        await db.commit()

    return {
        "status": "success",
        "work_order_id": work_order_id,
        "chunk_id": chunk_id.upper(),
        "chunk_name": chunk["chunk_name"],
        "chainage": chunk["chainage"],
        "dispatched_count": dispatched_count,
        "message": f"Dispatched {dispatched_count} defects in 500m chunk {chunk_id.upper()} to municipal maintenance units.",
    }


@router.get("/{chunk_id}/manifest")
async def get_chunk_manifest(
    chunk_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Generates an engineering Pavement Distress Manifest for this 500m chunk."""
    chunk = await road_chunk_service.get_chunk_details(chunk_id.upper(), db)
    if not chunk:
        raise HTTPException(status_code=404, detail=f"Road chunk '{chunk_id}' not found")

    issues = chunk.get("issues", [])
    potholes = sum(1 for i in issues if i.get("issue_type") == "POTHOLE")
    cracks = sum(1 for i in issues if "CRACK" in i.get("issue_type", ""))
    damaged = sum(1 for i in issues if i.get("issue_type") == "DAMAGED_ROAD")

    est_asphalt_cum = round(potholes * 0.12 + damaged * 1.5, 2)
    est_sealant_m = round(cracks * 25.0, 1)
    crew_size = 6 if potholes > 2 or damaged > 0 else 3

    return {
        "chunk_id": chunk["chunk_id"],
        "corridor_name": chunk["corridor_name"],
        "chunk_name": chunk["chunk_name"],
        "chainage": chunk["chainage"],
        "ward": chunk["ward"],
        "health_score": chunk["health_score"],
        "status": chunk["status"],
        "coordinates": {
            "start": [chunk["start_lat"], chunk["start_lon"]],
            "center": [chunk["center_lat"], chunk["center_lon"]],
            "end": [chunk["end_lat"], chunk["end_lon"]],
        },
        "defect_summary": {
            "total_defects": len(issues),
            "potholes": potholes,
            "cracks": cracks,
            "damaged_surfaces": damaged,
        },
        "remediation_estimates": {
            "asphalt_mix_cum": est_asphalt_cum,
            "crack_sealant_meters": est_sealant_m,
            "estimated_crew_size": crew_size,
            "recommended_sla_hours": 24 if any(i.get("severity") == "CRITICAL" for i in issues) else 48,
        },
        "defects": issues,
    }
