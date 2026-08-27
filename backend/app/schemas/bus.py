from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class BusCreate(BaseModel):
    bus_number: str
    route_id: Optional[uuid.UUID] = None
    status: str = "ACTIVE"


class BusResponse(BaseModel):
    id: uuid.UUID
    bus_number: str
    route_id: Optional[uuid.UUID] = None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CameraResponse(BaseModel):
    id: uuid.UUID
    bus_id: uuid.UUID
    position: str
    status: str
    stream_url: Optional[str] = None

    model_config = {"from_attributes": True}


class RouteCreate(BaseModel):
    route_name: str
    start_stop: str
    end_stop: str
    stops: Optional[dict] = None
    distance_km: Optional[float] = None
    scheduled_duration_min: Optional[int] = None


class RouteResponse(BaseModel):
    id: uuid.UUID
    route_name: str
    start_stop: str
    end_stop: str
    stops: Optional[dict] = None
    distance_km: Optional[float] = None
    scheduled_duration_min: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}
