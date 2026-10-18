from __future__ import annotations

from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings


PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent


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

    # Edge / AI capability modes (single source of truth mirrored in .env).
    # UrbanSense is a REAL-inference platform: there is no mock detection mode.
    # These fields are REPORTED to the frontend so it can label data truthfully.
    gps_mode: str = "phone"           # phone | nmea | simulated
    yolo_model_path: str = "models/yolov8n.pt"
    road_damage_model_path: str = "models/road_damage.pt"
    ocr_provider: str = "off"         # paddle | easyocr | off
    ocr_enabled: bool = False
    video_source: str = "phone"       # phone | webcam | file | youtube
    gps_allow_simulated_fallback: bool = True
    rash_driving_enabled: bool = True
    bus_id: str = "BUS-001"
    camera_position: str = "FRONT"    # FRONT | REAR | LEFT | RIGHT | CABIN
    # GPS NMEA receiver settings.
    gps_nmea_device: str = "/dev/ttyUSB0"
    gps_nmea_baudrate: int = 9600
    gps_nmea_host: str = ""
    gps_nmea_port: int | None = None
    # URL of the YouTube live stream the edge pipeline embeds (youtube video source).
    youtube_live_url: str = ""
    youtube_rear_url: str = ""
    youtube_left_url: str = ""
    youtube_right_url: str = ""
    youtube_cabin_url: str = ""

    # Per-camera video configuration surfaced to the Live Command Center.
    front_camera_id: str = "BUS-001-CAM-FRONT"
    front_camera_name: str = "Front Road Camera"
    front_camera_type: str = "OUTSIDE"
    front_stream_url: str = ""
    front_source_mode: str = "LIVE"
    inside_camera_id: str = "BUS-001-CAM-INSIDE"
    inside_camera_name: str = "Inside Cabin Camera"
    inside_camera_type: str = "INSIDE"
    inside_stream_url: str = ""
    inside_source_mode: str = "RECORDED_DEMO"

    # Rate limiting
    login_rate_limit_per_minute: int = 5
    event_rate_limit_per_minute: int = 120

    # CORS
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000,http://11.6.3.45:3000"

    # Production guard
    production: bool = False

    # Evidence
    evidence_dir: str = "data/evidence"
    evidence_retention_days: int = 30

    # Notification
    notification_provider: str = "inapp"

    @property
    def project_root(self) -> Path:
        return PROJECT_ROOT

    def resolve_path(self, relative: str) -> Path:
        p = Path(relative)
        if p.is_absolute():
            return p
        return PROJECT_ROOT / p

    def model_post_init(self, __context) -> None:
        # Render and other clouds provide postgres:// or postgresql://
        # asyncpg requires postgresql+asyncpg://
        url = self.database_url
        if url.startswith("postgres://"):
            self.database_url = url.replace("postgres://", "postgresql+asyncpg://", 1)
            self.database_url_sync = url.replace("postgres://", "postgresql://", 1)
        elif url.startswith("postgresql://") and not url.startswith("postgresql+"):
            self.database_url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
            self.database_url_sync = url
        elif url.startswith("postgresql+asyncpg://"):
            self.database_url_sync = url.replace("postgresql+asyncpg://", "postgresql://", 1)

    model_config = {
        "env_file": str(PROJECT_ROOT / ".env"),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


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
