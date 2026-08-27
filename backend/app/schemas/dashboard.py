from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class DashboardStats(BaseModel):
    active_buses: int
    events_today: int
    open_issues: int
    critical_incidents: int
    traffic_hotspots: int
    resolved_issues: int
    total_events: int
    total_issues: int
    total_incidents: int


class ActivityItem(BaseModel):
    id: str
    type: str
    title: str
    description: str
    severity: str
    timestamp: str
    metadata: dict[str, Any] | None = None
