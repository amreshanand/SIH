from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class IncidentCreate(BaseModel):
    incident_id: str
    incident_type: str
    bus_id: uuid.UUID
    camera_id: Optional[uuid.UUID] = None
    severity: str = "HIGH"
    confidence: float
    latitude: float
    longitude: float
    plate_text: Optional[str] = None
    plate_confidence: Optional[float] = None
    evidence_url: Optional[str] = None
    vehicle_track_id: Optional[uuid.UUID] = None


class IncidentResponse(BaseModel):
    id: uuid.UUID
    incident_id: str
    incident_type: str
    bus_id: uuid.UUID
    camera_id: Optional[uuid.UUID] = None
    severity: str
    confidence: float
    latitude: float
    longitude: float
    plate_text: Optional[str] = None
    plate_confidence: Optional[float] = None
    evidence_url: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class IncidentListResponse(BaseModel):
    incidents: list[IncidentResponse]
    total: int
