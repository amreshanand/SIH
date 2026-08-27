from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class IssueResponse(BaseModel):
    id: uuid.UUID
    issue_id: str
    issue_type: str
    severity: str
    confidence: float
    latitude: float
    longitude: float
    first_seen: datetime
    last_seen: datetime
    observation_count: int
    affected_road: Optional[str] = None
    department: Optional[str] = None
    status: str
    metadata_json: Optional[dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class IssueListResponse(BaseModel):
    issues: list[IssueResponse]
    total: int


class IssueUpdate(BaseModel):
    status: Optional[str] = None
    severity: Optional[str] = None
    department: Optional[str] = None
    affected_road: Optional[str] = None
    assigned_to: Optional[uuid.UUID] = None


class IssueAssignmentCreate(BaseModel):
    authority_id: uuid.UUID
    notes: Optional[str] = None


class IssueAssignmentResponse(BaseModel):
    id: uuid.UUID
    issue_id: uuid.UUID
    authority_id: uuid.UUID
    notes: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
