from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.database.base import BaseModel


class VehicleTrack(BaseModel):
    __tablename__ = "vehicle_tracks"

    track_id: Mapped[int] = mapped_column(Integer, nullable=False)
    bus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("buses.id"), nullable=False
    )
    camera_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cameras.id"), nullable=True
    )
    vehicle_class: Mapped[str] = mapped_column(String(50), nullable=False)
    first_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    last_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    trajectory: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    speed_estimate: Mapped[float | None] = mapped_column(Float, nullable=True)
    frame_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
