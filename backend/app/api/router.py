from __future__ import annotations

from fastapi import APIRouter

from backend.app.api import (
    admin,
    analytics,
    authorities,
    auth,
    buses,
    dashboard,
    demo,
    events,
    incidents,
    notifications,
    streaming,
    traffic,
    verification,
    issues,
    sensing,
    chunks,
)
from backend.app.websocket import handlers as ws_handlers

api_router = APIRouter(prefix="/api")

api_router.include_router(events.router)
api_router.include_router(issues.router)
api_router.include_router(chunks.router)
api_router.include_router(incidents.router)
api_router.include_router(buses.router)
api_router.include_router(dashboard.router)
api_router.include_router(traffic.router)
api_router.include_router(verification.router)
api_router.include_router(notifications.router)
api_router.include_router(analytics.router)
api_router.include_router(authorities.router)
api_router.include_router(auth.router)
api_router.include_router(streaming.router)
api_router.include_router(demo.router)
api_router.include_router(sensing.router)
api_router.include_router(admin.router)

api_router.include_router(ws_handlers.router)
