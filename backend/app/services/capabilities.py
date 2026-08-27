"""Single source of truth for AI/edge capability status.

UrbanSense AI must NEVER claim "AI ONLINE" when everything is mock/simulated.
This module computes a truthful per-capability status based on configuration
and, where possible, whether the backing resource actually exists (e.g. a YOLO
weights file). UIs should render these badges directly.
"""
from __future__ import annotations

from pathlib import Path

from backend.app.core.config import settings


def _is_real(model_mode: str) -> bool:
    return str(model_mode).lower() == "real"


def _model_present(path: str) -> bool:
    if not path:
        return False
    p = Path(str(settings.project_root)) / path if not Path(path).is_absolute() else Path(path)
    return p.exists()


def capability_status() -> dict:
    real = _is_real(settings.model_mode)
    vehicle_weights = _model_present(settings.yolo_model_path) if real else False

    def vehicle_status():
        if not real:
            return {"mode": "MOCK", "detail": "deterministic simulated detections", "live": False}
        if not vehicle_weights:
            return {"mode": "UNAVAILABLE", "detail": "real requested but weights not found", "live": False}
        return {"mode": "REAL", "detail": f"YOLO {settings.yolo_model_path}", "live": True}

    def defect_status():
        if not real:
            return {"mode": "MOCK", "detail": "deterministic mock pothole cadence", "live": False}
        if not _model_present(settings.road_damage_model_path):
            return {"mode": "UNAVAILABLE", "detail": "real requested but weights not found", "live": False}
        return {"mode": "REAL", "detail": f"YOLO {settings.road_damage_model_path}", "live": True}

    def ocr_status():
        if not settings.ocr_enabled:
            return {"mode": "OFF", "detail": "ocr disabled", "live": False}
        if str(settings.ocr_provider).lower() == "mock":
            return {"mode": "MOCK", "detail": "deterministic plate text", "live": False}
        return {"mode": str(settings.ocr_provider).upper(), "detail": f"{settings.ocr_provider} provider", "live": True}

    def gps_status():
        if str(settings.gps_mode).lower() == "phone":
            return {"mode": "PHONE", "detail": "phone provider", "live": True, "simulated": False}
        return {"mode": "SIMULATED", "detail": "simulated route provider", "live": False, "simulated": True}

    return {
        "vehicle_detection": vehicle_status(),
        "road_defect_detection": defect_status(),
        "tracking": {
            "mode": "REAL" if real else "MOCK",
            "detail": "bytetrack (IoU-matched)" if real else "iou mock tracker",
            "live": real,
        },
        "ocr": ocr_status(),
        "pedestrian_detection": {
            "mode": "REAL" if real else "MOCK",
            "detail": "person class + proximity risk",
            "live": real,
        },
        "incident_detection": {
            "mode": "REAL" if real else "MOCK",
            "detail": "explainable rule-based",
            "live": real,
        },
        "gps": gps_status(),
    }


def pipeline_mode() -> str:
    """Overall pipeline label: LIVE vs SIMULATED."""
    real = _is_real(settings.model_mode)
    return "LIVE" if real else "SIMULATED"
