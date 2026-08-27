from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class EventCreate(BaseModel):
    event_id: str
    event_type: str
    # Accept either a bus UUID or a bus number (e.g. "BUS-001"); the endpoint
    # resolves a bus number to its UUID so edge devices don't need to know ids.
    bus_id: str
    # Edge devices send a camera position label (e.g. "FRONT"); the endpoint
    # stores it only when it is a valid camera UUID, else None.
    camera_id: Optional[str] = None
    severity: str = "MEDIUM"
    confidence: float
    latitude: float
    longitude: float
    evidence_url: Optional[str] = None
    metadata_json: Optional[dict[str, Any]] = None
    source: str = "EDGE_AI"


class EventResponse(BaseModel):
    id: uuid.UUID
    event_id: str
    event_type: str
    bus_id: uuid.UUID
    camera_id: Optional[uuid.UUID] = None
    severity: str
    confidence: float
    latitude: float
    longitude: float
    evidence_url: Optional[str] = None
    metadata_json: Optional[dict[str, Any]] = None
    source: str
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EventListResponse(BaseModel):
    events: list[EventResponse]
    total: int
