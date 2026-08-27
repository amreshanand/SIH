from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.database.base import BaseModel, TimestampMixin


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


class SensingSession(BaseModel, TimestampMixin):
    """A single continuous sensing session from one edge device (bus/camera).

    Reports per-session provenance: when it started/ended, what source fed it
    (GPS + AI mode + camera), and how many frames/events/uploads/errors it
    produced. This gives an operator an honest, end-to-end view of data quality.
    """

    __tablename__ = "sensing_sessions"

    session_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    bus_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    camera_id: Mapped[str] = mapped_column(String(32), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now_utc, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    gps_source: Mapped[str] = mapped_column(String(32), nullable=False, default="simulated")
    ai_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="mock")
    model_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    frame_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    event_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    upload_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE")
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
