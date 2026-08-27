from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class TrafficRecordCreate(BaseModel):
    bus_id: str
    latitude: float
    longitude: float
    road_segment: Optional[str] = None
    vehicle_count: int = 0
    vehicle_distribution: Optional[dict[str, int]] = None
    average_speed: Optional[float] = None
    congestion_score: int = 0
    bus_speed: Optional[float] = None


class TrafficRecordResponse(BaseModel):
    id: Any
    bus_id: Any
    latitude: float
    longitude: float
    road_segment: Optional[str] = None
    vehicle_count: int
    vehicle_distribution: Optional[dict[str, int]] = None
    average_speed: Optional[float] = None
    congestion_score: int
    bus_speed: Optional[float] = None
    created_at: Any

    model_config = {"from_attributes": True}
