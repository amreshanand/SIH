from __future__ import annotations

import os
import time
from pathlib import Path

import cv2
import numpy as np

from edge.utils.logger import log


class EvidenceCapture:
    def __init__(self, output_dir: str, max_width: int = 1280) -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.max_width = max_width

    def capture(
        self,
        frame: np.ndarray,
        event_id: str,
        event_type: str,
        confidence: float,
        gps_source: str = "UNKNOWN",
        bus_id: str = "BUS-001",
        camera_id: str = "FRONT",
        latitude: float = 0.0,
        longitude: float = 0.0,
        ai_mode: str = "SIMULATED",
        model_name: str = "mock",
        metadata: dict | None = None,
    ) -> str:
        annotated = frame.copy()
        h, w = annotated.shape[:2]

        if w > self.max_width:
            scale = self.max_width / w
            annotated = cv2.resize(annotated, (self.max_width, int(h * scale)))

        h, w = annotated.shape[:2]

        # Draw bounding box for defect/detection if provided in metadata
        if "bbox" in (metadata or {}):
            bx1, by1, bx2, by2 = metadata["bbox"]
            cv2.rectangle(annotated, (bx1, by1), (bx2, by2), (0, 0, 255), 3)
            cv2.putText(annotated, f"DEFECT: {event_type} ({confidence:.0%})", (bx1, max(by1 - 10, 25)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

        bar_h = 22
        cv2.rectangle(annotated, (0, 0), (w, bar_h), (20, 20, 20), -1)
        cv2.putText(annotated, "URBANSENSE AI", (10, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 220, 255), 2)

        mode_color = (0, 200, 0) if ai_mode == "real" else (0, 180, 255)
        mode_label = "LIVE EDGE AI" if ai_mode == "real" else "SIMULATED DEMO"
        cv2.putText(annotated, mode_label, (w - 200, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, mode_color, 1)

        overlay_y = bar_h + 15
        overlay_items = [
            f"EVENT: {event_type}",
            f"CONFIDENCE: {confidence:.1%}",
            f"BUS: {bus_id}",
            f"CAMERA: {camera_id}",
            f"GPS: {latitude:.6f}, {longitude:.6f}",
            f"TIME: {time.strftime('%Y-%m-%d %H:%M:%S')}",
            f"MODEL: {model_name}",
        ]

        for item in overlay_items:
            text_size = cv2.getTextSize(item, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)[0]
            box_w = text_size[0] + 16
            cv2.rectangle(annotated, (5, overlay_y - 14), (5 + box_w, overlay_y + 6), (0, 0, 0), -1)
            cv2.putText(annotated, item, (10, overlay_y), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 255, 0), 1)
            overlay_y += 20

        filename = f"{event_id}.jpg"
        filepath = self.output_dir / filename
        cv2.imwrite(str(filepath), annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])

        log.info("[EVIDENCE] Saved: %s", filepath)
        return str(filepath)
