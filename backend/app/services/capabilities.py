"""Single source of truth for AI/edge capability status.

UrbanSense AI is a real-inference platform: there is no mock/simulated
detection mode. This module computes a truthful per-capability status based on
configuration and whether the backing YOLO weights actually exist on disk.

The only remaining "simulated" capability is GPS, and only when explicitly
configured as a fallback — that is reported honestly with simulated=True.
"""
from __future__ import annotations

from pathlib import Path

from backend.app.core.config import settings


def _model_present(path: str) -> bool:
    if not path:
        return False
    p = Path(str(settings.project_root)) / path if not Path(path).is_absolute() else Path(path)
    return p.exists()


def capability_status() -> dict:
    vehicle_weights = _model_present(settings.yolo_model_path)
    defect_weights = _model_present(settings.road_damage_model_path)

    def vehicle_status():
        if not settings.yolo_model_path:
            return {"mode": "UNAVAILABLE", "detail": "model path not configured", "live": False}
        if not vehicle_weights:
            return {"mode": "UNAVAILABLE", "detail": f"weights not found: {settings.yolo_model_path}", "live": False}
        return {"mode": "REAL", "detail": f"YOLO {settings.yolo_model_path}", "live": True}

    def defect_status():
        if not settings.road_damage_model_path:
            return {"mode": "UNAVAILABLE", "detail": "model path not configured", "live": False}
        if not defect_weights:
            return {"mode": "UNAVAILABLE", "detail": f"weights not found: {settings.road_damage_model_path}", "live": False}
        return {"mode": "REAL", "detail": f"YOLO {settings.road_damage_model_path}", "live": True}

    def ocr_status():
        if not settings.ocr_enabled:
            return {"mode": "OFF", "detail": "ocr disabled", "live": False}
        if str(settings.ocr_provider).lower() in ("mock", "off"):
            return {"mode": "OFF", "detail": "no real ocr provider configured", "live": False}
        return {"mode": str(settings.ocr_provider).upper(), "detail": f"{settings.ocr_provider} provider", "live": True}

    def gps_status():
        if str(settings.gps_mode).lower() == "simulated":
            return {
                "mode": "SIMULATED", "detail": "simulated route fallback",
                "live": False, "simulated": True,
            }
        # phone / nmea are real.
        return {
            "mode": str(settings.gps_mode).upper(),
            "detail": "real GPS source",
            "live": True,
            "simulated": False,
        }

    return {
        "vehicle_detection": vehicle_status(),
        "road_defect_detection": defect_status(),
        "tracking": {
            "mode": "REAL",
            "detail": "bytetrack (persistent IDs)",
            "live": vehicle_weights,
        },
        "ocr": ocr_status(),
        "pedestrian_detection": {
            "mode": "REAL",
            "detail": "person class + proximity risk",
            "live": vehicle_weights,
        },
        "incident_detection": {
            "mode": "REAL",
            "detail": "rule-based on tracked motion",
            "live": vehicle_weights,
        },
        "gps": gps_status(),
    }


def pipeline_mode() -> str:
    """Overall pipeline label.

    Because detection is always real inference when configured, the pipeline is
    LIVE unless the YOLO weights are missing.
    """
    if _model_present(settings.yolo_model_path) or _model_present(settings.road_damage_model_path):
        return "LIVE"
    return "UNAVAILABLE"
