from __future__ import annotations

from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings


PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    # General
    project_name: str = "UrbanSense AI"
    debug: bool = True
    demo_mode: bool = False

    # Backend
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    secret_key: str = "change-me-to-a-random-secret-key"
    access_token_expire_minutes: int = 1440

    # Database
    database_url: str = "postgresql+asyncpg://urbansense:urbansense@localhost:5432/urbansense"
    database_url_sync: str = "postgresql://urbansense:urbansense@localhost:5432/urbansense"

    # Spatial
    cluster_distance_meters: int = 50
    min_events_for_issue: int = 1
    verification_clear_threshold: int = 3
    verification_reopen_threshold: int = 2
    observation_dedup_window_seconds: int = 30
    # Minimum seconds between verifications from DISTINCT buses (0 = disabled).
    # Enables an anti-burst guard without slowing the deterministic demo.
    verification_separation_seconds: int = 0
    # auto | postgis | haversine
    spatial_engine: str = "auto"

    # Edge
    edge_api_key: str = "urbansense-edge-key-change-me"

    # Edge / AI capability modes (single source of truth mirrored in .env)
    # These are REPORTED to the frontend so it can label data truthfully.
    model_mode: str = "mock"          # real | mock
    gps_mode: str = "simulated"       # phone | simulated
    yolo_model_path: str = "models/yolov8n.pt"
    ocr_provider: str = "mock"        # paddle | easyocr | mock
    ocr_enabled: bool = False
    video_source: str = "phone"       # phone | webcam | file | mock
    bus_id: str = "BUS-001"
    camera_position: str = "FRONT"    # FRONT | REAR | LEFT | RIGHT | CABIN
    allow_mock_fallback: bool = True

    # Rate limiting
    login_rate_limit_per_minute: int = 5
    event_rate_limit_per_minute: int = 120

    # CORS
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Production guard
    production: bool = False

    # Evidence
    evidence_dir: str = "data/evidence"
    evidence_retention_days: int = 30

    # Notification
    notification_provider: str = "inapp"

    model_config = {
        "env_file": str(PROJECT_ROOT / ".env"),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }

    @property
    def project_root(self) -> Path:
        return PROJECT_ROOT

    def resolve_path(self, relative: str) -> Path:
        p = Path(relative)
        if p.is_absolute():
            return p
        return PROJECT_ROOT / p


settings = Settings()


def validate_config() -> None:
    """Fail fast on insecure/half-configured deploys.

    Default secrets are acceptable in dev/demo but must be overridden for any
    PRODUCTION deploy, otherwise the backend refuses to start.
    """
    defaults = ("change-me-to-a-random-secret-key", "urbansense-edge-key-change-me")
    if settings.production:
        if settings.secret_key in defaults or not settings.secret_key:
            raise RuntimeError(
                "PRODUCTION=true requires a strong SECRET_KEY (set it in your environment)."
            )
        if settings.edge_api_key in defaults or not settings.edge_api_key:
            raise RuntimeError(
                "PRODUCTION=true requires a real EDGE_API_KEY for device authentication."
            )
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required.")
