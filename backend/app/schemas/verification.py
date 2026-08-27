from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class VerificationCreate(BaseModel):
    issue_id: uuid.UUID
    bus_id: uuid.UUID
    latitude: float
    longitude: float
    detection_result: str
    confidence: float
    evidence_url: Optional[str] = None


class VerificationResponse(BaseModel):
    id: uuid.UUID
    issue_id: uuid.UUID
    bus_id: uuid.UUID
    timestamp: datetime
    latitude: float
    longitude: float
    detection_result: str
    confidence: float
    evidence_url: Optional[str] = None
    result: str

    model_config = {"from_attributes": True}
