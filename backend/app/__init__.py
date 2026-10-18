from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.core.config import settings
from backend.app.core.logging_setup import configure_logging, get_logger

log = get_logger("urbansense")

configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup / shutdown lifecycle."""
    from backend.app.core.config import validate_config

    validate_config()
    import os
    yolo_found = os.path.exists(settings.yolo_model_path)
    road_damage_found = os.path.exists(settings.road_damage_model_path)

    cors_list = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    log.info_ctx(
        "backend starting",
        project=settings.project_name,
        debug=settings.debug,
        demo_mode=settings.demo_mode,
        database=(settings.database_url.split("@")[-1] if "@" in settings.database_url else settings.database_url),
        cors_origins=cors_list,
        production=settings.production,
        yolo_model="ready" if yolo_found else "missing",
        road_damage_model="ready" if road_damage_found else "missing",
    )

    if not road_damage_found:
        log.warning(
            "Road damage model weights not found at '%s'. Edge sensing will operate in heuristic/fallback mode until custom weights are placed.",
            settings.road_damage_model_path,
        )
    if not yolo_found:
        log.warning("YOLO vehicle model weights not found at '%s'.", settings.yolo_model_path)

    # Startup database-connectivity check
    try:
        from sqlalchemy import text
        from backend.app.database.session import engine
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        log.info("Database connection verified successfully.")
    except Exception as exc:
        err_msg = str(exc)
        if "password authentication failed" in err_msg.lower() or "invalidpassword" in err_msg.lower():
            log.error("Database authentication failed. Check DATABASE_URL and Docker Postgres credentials.")
        else:
            log.warning("Database connectivity check failed: %s", exc.__class__.__name__)

    # Safe asynchronous schema verification and demo data seeding
    import asyncio
    async def _init_database():
        try:
            import backend.app.models  # noqa: F401 - Register all models into Base.metadata
            from backend.app.database.session import engine, Base, async_session_factory
            from backend.app.seed.demo_data import seed_demo_data
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            async with async_session_factory() as db:
                await seed_demo_data(db)
            log.info("Database schema verified and demo data populated.")
        except Exception as exc:
            err_msg = str(exc)
            if "password authentication failed" in err_msg.lower() or "invalidpassword" in err_msg.lower():
                log.error("Database authentication failed. Check DATABASE_URL and Docker Postgres credentials.")
            else:
                log.warning("Database init/seed background notice: %s", str(exc))

    asyncio.create_task(_init_database())

    # Start continuous event streaming when demo mode is active
    if settings.demo_mode:
        from backend.app.services.continuous_sensing import continuous_sensing_service
        continuous_sensing_service.start(interval_seconds=5.0)

    yield

    if settings.demo_mode:
        try:
            from backend.app.services.continuous_sensing import continuous_sensing_service
            continuous_sensing_service.stop()
        except Exception:
            pass

    log.info("backend shutting down")


def create_app() -> FastAPI:
    application = FastAPI(
        title=settings.project_name,
        description="UrbanSense AI — Urban Mobility Intelligence Platform",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    from backend.app.core.security_middleware import (
        AuthRateLimitMiddleware,
        SecurityHeadersMiddleware,
    )
    application.add_middleware(SecurityHeadersMiddleware)
    application.add_middleware(AuthRateLimitMiddleware)

    # CORS: explicitly allow local development origins and required headers/methods.
    # Keep credentials disabled since JWT is transmitted via Authorization header (no cookies).
    origin_list = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    application.add_middleware(
        CORSMiddleware,
        allow_origins=origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
        allow_headers=["Content-Type", "Authorization", "X-API-Key"],
    )

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

    from fastapi.staticfiles import StaticFiles
    import os
    evidence_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "evidence"))
    if not os.path.exists(evidence_dir):
        os.makedirs(evidence_dir, exist_ok=True)
    application.mount("/data/evidence", StaticFiles(directory=evidence_dir), name="evidence")

    return application
