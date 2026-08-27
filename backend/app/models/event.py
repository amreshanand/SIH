from __future__ import annotations

import enum
import uuid

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.database.base import BaseModel, TimestampMixin


class EventType(str, enum.Enum):
    POTHOLE = "POTHOLE"
    ROAD_CRACK = "ROAD_CRACK"
    DAMAGED_ROAD = "DAMAGED_ROAD"
    WATERLOGGING = "WATERLOGGING"
    VEHICLE_COUNT = "VEHICLE_COUNT"
    TRAFFIC_CONGESTION = "TRAFFIC_CONGESTION"
    MISSING_SIGN = "MISSING_SIGN"
    MISSING_CROSSING = "MISSING_CROSSING"
    DAMAGED_SIGN = "DAMAGED_SIGN"
    STREET_LIGHT = "STREET_LIGHT"
    PEDESTRIAN_RISK = "PEDESTRIAN_RISK"
    INCIDENT = "INCIDENT"


class Severity(str, enum.Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class EventStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"


class Event(BaseModel, TimestampMixin):
    __tablename__ = "events"

    event_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    bus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("buses.id"), nullable=False
    )
    camera_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cameras.id"), nullable=True
    )
    severity: Mapped[str] = mapped_column(
        String(20), default=Severity.MEDIUM.value, nullable=False
    )
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    evidence_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="EDGE_AI", nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), default=EventStatus.ACTIVE.value, nullable=False
    )

    bus: Mapped["Bus"] = relationship("Bus", back_populates="events")
    camera: Mapped["Camera | None"] = relationship("Camera")

    # PostgreSQL spatial column added via raw DDL in migration
    __table_args__ = (
        {"schema": None},
    )
