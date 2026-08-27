from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.core.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup / shutdown lifecycle."""
    from backend.app.core.config import validate_config
    validate_config()
    print(f"[BOOT] {settings.project_name} backend starting...")
    print(f"[BOOT] Debug: {settings.debug}")
    print(f"[BOOT] Demo mode: {settings.demo_mode}")
    print(f"[BOOT] Database: {settings.database_url.split('@')[-1] if '@' in settings.database_url else settings.database_url}")
    yield
    print("[SHUTDOWN] Backend shutting down...")


def create_app() -> FastAPI:
    application = FastAPI(
        title=settings.project_name,
        description="UrbanSense AI — Urban Mobility Intelligence Platform",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # CORS: use configured origins (never mix "*" with credentials).
    origin_list = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    allow_any = "*" in origin_list
    application.add_middleware(
        CORSMiddleware,
        allow_origins=origin_list,
        allow_credentials=not allow_any,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from backend.app.core.security_middleware import (
        AuthRateLimitMiddleware,
        SecurityHeadersMiddleware,
    )
    application.add_middleware(AuthRateLimitMiddleware)
    application.add_middleware(SecurityHeadersMiddleware)

    @application.get("/health")
    async def health_check() -> dict[str, str]:
        return {"status": "ok", "project": settings.project_name}

    @application.get("/")
    async def root() -> dict[str, str]:
        return {
            "project": settings.project_name,
            "version": "0.1.0",
            "docs": "/docs",
            "status": "running",
        }

    from backend.app.api.router import api_router
    application.include_router(api_router)

    from backend.app.api.health import router as health_router
    application.include_router(health_router)

    return application
