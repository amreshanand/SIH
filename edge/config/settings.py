from __future__ import annotations

from enum import Enum
from pathlib import Path

from pydantic_settings import BaseSettings
from pydantic import Field


class VideoSourceType(str, Enum):
    PHONE = "phone"
    WEBCAM = "webcam"
    FILE = "file"
    MOCK = "mock"
    YOUTUBE = "youtube"


class GPSMode(str, Enum):
    PHONE = "phone"
    SIMULATED = "simulated"


class ModelMode(str, Enum):
    REAL = "real"
    MOCK = "mock"


class OCRProviderType(str, Enum):
    PADDLE = "paddle"
    EASYOCR = "easyocr"
    MOCK = "mock"


class CameraPosition(str, Enum):
    FRONT = "FRONT"
    REAR = "REAR"
    LEFT = "LEFT"
    RIGHT = "RIGHT"
    CABIN = "CABIN"


PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    project_name: str = "UrbanSense AI"
    debug: bool = True
    demo_mode: bool = False

    edge_host: str = "0.0.0.0"
    edge_port: int = 8001
    phone_stream_url: str = "http://192.168.1.100:8080/video"
    phone_gps_url: str = "http://192.168.1.100:8080/gps"
    video_source: VideoSourceType = VideoSourceType.PHONE
    video_file_path: str = "data/videos/front.mp4"
    youtube_live_url: str = ""
    youtube_rear_url: str = ""
    youtube_left_url: str = ""
    youtube_right_url: str = ""
    youtube_cabin_url: str = ""
    inference_fps: int = 10
    frame_width: int = 640
    frame_height: int = 480

    model_mode: ModelMode = ModelMode.MOCK
    yolo_model_path: str = "models/yolov8n.pt"
    road_damage_model_path: str = "models/road_damage.pt"
    confidence_threshold: float = 0.4
    road_defect_confidence_threshold: float = 0.5

    ocr_enabled: bool = False
    ocr_provider: OCRProviderType = OCRProviderType.MOCK

    gps_mode: GPSMode = GPSMode.SIMULATED
    gps_simulated_route: str = "data/gps/pune_route.json"
    gps_update_interval: float = 1.0

    bus_id: str = "BUS-001"
    camera_position: CameraPosition = CameraPosition.FRONT

    stream_width: int = 640
    stream_height: int = 360
    stream_quality: int = 80

    evidence_dir: str = "data/evidence"
    evidence_retention_days: int = 30
    evidence_max_width: int = 1280

    event_min_confidence: float = 0.5
    event_temporal_window: float = 3.0
    event_min_observations: int = 2
    cluster_distance_meters: float = 50.0

    traffic_detection_threshold: int = 5
    traffic_congestion_threshold: int = 5

    event_upload_max_retries: int = 5
    event_upload_batch_size: int = 10

    backend_url: str = "http://localhost:8000"
    backend_api_key: str = "urbansense-edge-key-change-me"

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
