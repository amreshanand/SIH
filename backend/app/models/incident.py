from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.database.base import BaseModel, TimestampMixin


class IncidentType(str, enum.Enum):
    RASH_DRIVING = "RASH_DRIVING"
    HIT_AND_RUN = "HIT_AND_RUN"
    PEDESTRIAN_RISK = "PEDESTRIAN_RISK"
    COLLISION = "COLLISION"


class IncidentStatus(str, enum.Enum):
    DETECTED = "DETECTED"
    REPORTED = "REPORTED"
    INVESTIGATING = "INVESTIGATING"
    RESOLVED = "RESOLVED"


class Incident(BaseModel, TimestampMixin):
    __tablename__ = "incidents"

    incident_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    incident_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    bus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("buses.id"), nullable=False
    )
    camera_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cameras.id"), nullable=True
    )
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    plate_text: Mapped[str | None] = mapped_column(String(50), nullable=True)
    plate_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    evidence_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    vehicle_track_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicle_tracks.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(30), default=IncidentStatus.DETECTED.value, nullable=False
    )
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
