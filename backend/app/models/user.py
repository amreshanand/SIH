from __future__ import annotations

import enum
import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.database.base import BaseModel, TimestampMixin


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    AUTHORITY = "AUTHORITY"
    VIEWER = "VIEWER"


class User(BaseModel, TimestampMixin):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default=UserRole.VIEWER.value, nullable=False)
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)


class Notification(BaseModel, TimestampMixin):
    __tablename__ = "notifications"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    notification_type: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
