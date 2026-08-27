from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database.session import get_db
from backend.app.models import TrafficRecord

router = APIRouter(prefix="/traffic", tags=["Traffic"])


@router.get("")
async def list_traffic(
    road_segment: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
) -> dict:
    q = select(TrafficRecord)
    count_q = select(func.count(TrafficRecord.id))

    if road_segment:
        q = q.where(TrafficRecord.road_segment == road_segment)
        count_q = count_q.where(TrafficRecord.road_segment == road_segment)

    total = (await db.execute(count_q)).scalar() or 0
    q = q.order_by(TrafficRecord.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(q)
    records = list(result.scalars().all())

    return {
        "traffic": [
            {
                "id": str(r.id),
                "bus_id": str(r.bus_id),
                "road_segment": r.road_segment,
                "vehicle_count": r.vehicle_count,
                "vehicle_distribution": r.vehicle_distribution,
                "average_speed": r.average_speed,
                "congestion_score": r.congestion_score,
                "latitude": r.latitude,
                "longitude": r.longitude,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in records
        ],
        "total": total,
    }


@router.get("/heatmap")
async def traffic_heatmap(db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(
        select(
            TrafficRecord.road_segment,
            func.avg(TrafficRecord.congestion_score).label("avg_congestion"),
            func.count(TrafficRecord.id).label("record_count"),
            func.avg(TrafficRecord.latitude).label("avg_lat"),
            func.avg(TrafficRecord.longitude).label("avg_lon"),
        )
        .where(TrafficRecord.road_segment.isnot(None))
        .group_by(TrafficRecord.road_segment)
        .order_by(func.avg(TrafficRecord.congestion_score).desc())
    )
    rows = result.all()

    return {
        "heatmap": [
            {
                "road_segment": row.road_segment,
                "avg_congestion": round(float(row.avg_congestion or 0), 1),
                "record_count": row.record_count,
                "latitude": float(row.avg_lat or 0),
                "longitude": float(row.avg_lon or 0),
            }
            for row in rows
        ]
    }
