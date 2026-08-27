from __future__ import annotations

import enum
import uuid

from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.database.base import BaseModel, TimestampMixin


class BusStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    MAINTENANCE = "MAINTENANCE"


class CameraPosition(str, enum.Enum):
    FRONT = "FRONT"
    REAR = "REAR"
    LEFT = "LEFT"
    RIGHT = "RIGHT"
    CABIN = "CABIN"


class CameraStatus(str, enum.Enum):
    ONLINE = "ONLINE"
    OFFLINE = "OFFLINE"


class Route(BaseModel, TimestampMixin):
    __tablename__ = "routes"

    route_name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    start_stop: Mapped[str] = mapped_column(String(255), nullable=False)
    end_stop: Mapped[str] = mapped_column(String(255), nullable=False)
    stops: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    distance_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    scheduled_duration_min: Mapped[int | None] = mapped_column(Integer, nullable=True)

    buses: Mapped[list["Bus"]] = relationship("Bus", back_populates="route")


class Bus(BaseModel, TimestampMixin):
    __tablename__ = "buses"

    bus_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    route_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("routes.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(20), default=BusStatus.ACTIVE.value, nullable=False
    )

    route: Mapped["Route | None"] = relationship("Route", back_populates="buses")
    cameras: Mapped[list["Camera"]] = relationship("Camera", back_populates="bus")
    gps_points: Mapped[list["GPSPoint"]] = relationship("GPSPoint", back_populates="bus")
    events: Mapped[list["Event"]] = relationship("Event", back_populates="bus")


class Camera(BaseModel):
    __tablename__ = "cameras"

    bus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("buses.id"), nullable=False
    )
    position: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), default=CameraStatus.OFFLINE.value, nullable=False
    )
    stream_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    bus: Mapped["Bus"] = relationship("Bus", back_populates="cameras")


class GPSPoint(BaseModel):
    __tablename__ = "gps_points"

    bus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("buses.id"), nullable=False
    )
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    heading: Mapped[float | None] = mapped_column(Float, nullable=True)
    timestamp: Mapped[str] = mapped_column(String(50), nullable=False)

    bus: Mapped["Bus"] = relationship("Bus", back_populates="gps_points")
