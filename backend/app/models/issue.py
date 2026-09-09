from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.database.base import BaseModel, TimestampMixin


class IssueStatus(str, enum.Enum):
    OPEN = "OPEN"
    ASSIGNED = "ASSIGNED"
    IN_PROGRESS = "IN_PROGRESS"
    PENDING_VERIFICATION = "PENDING_VERIFICATION"
    RESOLVED = "RESOLVED"
    REOPENED = "REOPENED"


class Issue(BaseModel, TimestampMixin):
    __tablename__ = "issues"

    issue_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    issue_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    first_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    last_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    observation_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    affected_road: Mapped[str | None] = mapped_column(String(255), nullable=True)
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(
        String(30), default=IssueStatus.OPEN.value, nullable=False, index=True
    )
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ward: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    consensus_level: Mapped[str | None] = mapped_column(String(30), default="DETECTED", nullable=True, index=True)
    fused_confidence_score: Mapped[float | None] = mapped_column(Float, default=0.0, nullable=True)
    unique_bus_count: Mapped[int | None] = mapped_column(Integer, default=1, nullable=True)
    distinct_buses_observed: Mapped[list | None] = mapped_column(JSONB, default=list, nullable=True)
    road_mask_overlap_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    track_age_frames: Mapped[int | None] = mapped_column(Integer, nullable=True)


class IssueEvent(BaseModel):
    __tablename__ = "issue_events"

    issue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("issues.id"), nullable=False
    )
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("events.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )


class IssueAssignment(BaseModel, TimestampMixin):
    __tablename__ = "issue_assignments"

    issue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("issues.id"), nullable=False
    )
    authority_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="ASSIGNED", nullable=False)


class IssueResolution(BaseModel):
    """Immutable append-only record of the issue resolution lifecycle.

    Each write captures one transition (assignment, status change, resolution,
    reopen) so an authority's full resolution history can be replayed for the
    "Authority Performance" and audit requirements."
    """

    __tablename__ = "issue_resolutions"

    issue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("issues.id"), nullable=False, index=True
    )
    authority_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(30), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
