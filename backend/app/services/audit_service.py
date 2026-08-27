from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.audit import AuditLog


async def log_action(
    user_id,
    action: str,
    entity_type: str,
    entity_id: str,
    old_value: dict | None = None,
    new_value: dict | None = None,
    metadata: dict | None = None,
    db: AsyncSession = None,
) -> AuditLog:
    import uuid

    uid = None
    if user_id is not None:
        uid = uuid.UUID(str(user_id)) if not isinstance(user_id, uuid.UUID) else user_id

    log_entry = AuditLog(
        user_id=uid,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        old_value=old_value,
        new_value=new_value,
        metadata_json=metadata,
    )
    db.add(log_entry)
    await db.flush()
    return log_entry
