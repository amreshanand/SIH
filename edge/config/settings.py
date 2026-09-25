from __future__ import annotations

from enum import Enum
from pathlib import Path

from pydantic_settings import BaseSettings


class VideoSourceType(str, Enum):
    PHONE = "phone"
    WEBCAM = "webcam"
    FILE = "file"
    YOUTUBE = "youtube"
    RTSP = "rtsp"
    OFF = "off"


class GPSMode(str, Enum):
    PHONE = "phone"
    NMEA = "nmea"
    SIMULATED = "simulated"


class CameraPosition(str, Enum):
    FRONT = "FRONT"
    REAR = "REAR"
    LEFT = "LEFT"
    RIGHT = "RIGHT"
    CABIN = "CABIN"


class OCRProviderType(str, Enum):
    PADDLE = "paddle"
    EASYOCR = "easyocr"
    OFF = "off"


class ModelMode(str, Enum):
    REAL = "real"
    MOCK = "mock"


PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    project_name: str = "UrbanSense AI"
    debug: bool = True
    model_mode: ModelMode = ModelMode.MOCK

    edge_host: str = "0.0.0.0"
    edge_port: int = 8001
    phone_stream_url: str = "http://192.168.1.100:8080/video"
    phone_gps_url: str = "http://192.168.1.100:8080/gps"
    video_source: VideoSourceType = VideoSourceType.PHONE
    video_file_path: str = "data/videos/rad_front.mp4"
    rtsp_front_url: str = ""
    youtube_live_url: str = ""
    youtube_rear_url: str = ""
    youtube_left_url: str = ""
    youtube_right_url: str = ""
    youtube_cabin_url: str = ""

    # Multi-camera architecture (Phase 3).
    # Front is mandatory; rear/left/right/cabin are optional. Each position maps
    # to its own source type + URL so a single bus can fuse up to 5 feeds.
    # Examples: multi_camera_enabled=true, cam_rear_source=rtsp,
    #           cam_rear_url=rtsp://192.168.1.20:554/Streaming/Channels/102
    multi_camera_enabled: bool = False
    cam_front_source: str = ""  # fall back to video_source when empty
    cam_front_url: str = ""
    cam_rear_source: str = "off"
    cam_rear_url: str = ""
    cam_left_source: str = "off"
    cam_left_url: str = ""
    cam_right_source: str = "off"
    cam_right_url: str = ""
    cam_cabin_source: str = "off"
    cam_cabin_url: str = ""

    inference_fps: int = 10
    inference_batch_size: int = 1
    # Models may be pre-exported to onnx / tensorrt / torchscript for speed.
    inference_engine_format: str = ""  # "", onnx, tensorrt, torchscript
    frame_width: int = 640
    frame_height: int = 480

    # Real inference models (MANDATORY — there is no mock mode).
    yolo_model_path: str = "models/yolov8n.pt"
    road_damage_model_path: str = "models/road_damage.pt"
    confidence_threshold: float = 0.4
    road_defect_confidence_threshold: float = 0.5

    # Real OCR (optional; real backends only).
    ocr_enabled: bool = False
    ocr_provider: OCRProviderType = OCRProviderType.OFF

    # Real GPS. "phone" or "nmea" are the production providers; "simulated"
    # is an explicit fallback/dev mode.
    gps_mode: GPSMode = GPSMode.PHONE
    gps_simulated_route: str = "data/gps/pune_route.json"
    gps_update_interval: float = 1.0
    # NMEA receiver settings (used when gps_mode = nmea).
    gps_nmea_device: str = "/dev/ttyUSB0"
    gps_nmea_baudrate: int = 9600
    gps_nmea_host: str = ""
    gps_nmea_port: int | None = None
    # Whether to transparently fall back to the simulated route if the primary
    # real GPS source is unavailable. Honest labeling is preserved (the event
    # carries gps_source=SIMULATED).
    gps_allow_simulated_fallback: bool = True
    # Route history: how many recent fixes to retain per bus (for heatmaps and
    # recovery). Older fixes beyond this are pruned from memory.
    gps_route_history_max: int = 1000
    # Maximum age (seconds) before a NMEA fix is considered stale / unavailable.
    gps_nmea_max_age: float = 5.0

    bus_id: str = "BUS-001"
    camera_position: CameraPosition = CameraPosition.FRONT

    stream_width: int = 640
    stream_height: int = 360
    stream_quality: int = 80

    evidence_dir: str = "data/evidence"
    evidence_retention_days: int = 30
    evidence_archive_enabled: bool = True
    evidence_archive_dir: str = "data/evidence/archive"
    evidence_max_width: int = 1280
    evidence_thumbnail_width: int = 320

    event_min_confidence: float = 0.5
    event_temporal_window: float = 3.0
    event_min_observations: int = 2
    cluster_distance_meters: float = 50.0

    # Rash-driving detection (real, rule-based on tracked motion).
    rash_driving_enabled: bool = True

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
