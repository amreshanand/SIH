from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.database.base import BaseModel, TimestampMixin


class TrafficRecord(BaseModel, TimestampMixin):
    __tablename__ = "traffic_records"

    bus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("buses.id"), nullable=False
    )
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    road_segment: Mapped[str | None] = mapped_column(String(255), nullable=True)
    vehicle_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    vehicle_distribution: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    average_speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    congestion_score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    bus_speed: Mapped[float | None] = mapped_column(Float, nullable=True)
