"""Evidence frame capture for UrbanSense AI.

Captures an annotated JPEG per generated event. The annotation overlay includes
GPS coordinates, timestamp, confidence, vehicle/object ID, and event type.
When Pillow is available the GPS location is also embedded as EXIF metadata so
an evidence file carries its own geolocation (chain of custody), not just a
pixel overlay.
"""

from __future__ import annotations

import time
from pathlib import Path

import cv2
import numpy as np

from edge.utils.logger import log


def _exif_gps_to_dms(value: float) -> tuple[tuple, tuple, tuple]:
    """Convert a decimal degree to a (deg, min, sec) rational triplet for EXIF."""
    deg = abs(int(value))
    minutes_float = abs(value - int(value)) * 60
    minutes = int(minutes_float)
    seconds = (minutes_float - minutes) * 60
    # (numerator, denominator) pairs
    to_rational = lambda v: ( (int(v * 1000), 1000) if v else (0, 1) )
    return to_rational(deg), to_rational(minutes), to_rational(seconds)


class EvidenceCapture:
    def __init__(
        self,
        output_dir: str,
        max_width: int = 1280,
        thumbnail_width: int = 320,
        archive_dir: str | None = None,
    ) -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.max_width = max_width
        self.thumbnail_width = max(64, thumbnail_width)
        self.archive_dir = Path(archive_dir) if archive_dir else self.output_dir / "archive"
        self.archive_dir.mkdir(parents=True, exist_ok=True)

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
        model_name: str = "UNKNOWN",
        track_id: int | None = None,
        bbox: tuple[int, int, int, int] | None = None,
        metadata: dict | None = None,
    ) -> str:
        annotated = frame.copy()
        h, w = annotated.shape[:2]

        if w > self.max_width:
            scale = self.max_width / w
            annotated = cv2.resize(annotated, (self.max_width, int(h * scale)))
        h, w = annotated.shape[:2]

        if bbox is not None:
            bx1, by1, bx2, by2 = bbox
            cv2.rectangle(annotated, (bx1, by1), (bx2, by2), (0, 0, 255), 3)
            cv2.putText(
                annotated,
                f"{event_type} ({confidence:.0%})",
                (bx1, max(by1 - 10, 25)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 0, 255),
                2,
            )

        # Title bar
        bar_h = 22
        cv2.rectangle(annotated, (0, 0), (w, bar_h), (20, 20, 20), -1)
        cv2.putText(
            annotated, "URBANSENSE AI", (10, 16),
            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 220, 255), 2,
        )
        cv2.putText(
            annotated, "LIVE EDGE AI", (w - 150, 16),
            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 200, 0), 1,
        )

        overlay_items = [
            f"EVENT: {event_type}",
            f"CONFIDENCE: {confidence:.1%}",
            f"BUS: {bus_id}",
            f"CAMERA: {camera_id}",
            f"TRACK: {track_id if track_id is not None else 'N/A'}",
            f"GPS: {latitude:.6f}, {longitude:.6f} [{gps_source}]",
            f"TIME: {time.strftime('%Y-%m-%d %H:%M:%S')}",
            f"MODEL: {model_name}",
        ]

        overlay_y = bar_h + 15
        for item in overlay_items:
            text_size = cv2.getTextSize(item, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)[0]
            box_w = text_size[0] + 16
            cv2.rectangle(
                annotated, (5, overlay_y - 14), (5 + box_w, overlay_y + 6),
                (0, 0, 0), -1,
            )
            cv2.putText(
                annotated, item, (10, overlay_y), cv2.FONT_HERSHEY_SIMPLEX,
                0.42, (0, 255, 0), 1,
            )
            overlay_y += 20

        filepath = self.output_dir / f"{event_id}.jpg"
        cv2.imwrite(str(filepath), annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])

        # WebP thumbnail (compact, fast for map/dashboard thumbnails).
        thumb = self._make_thumbnail(annotated)
        thumb_path = self.output_dir / f"{event_id}.webp"
        if thumb is not None:
            cv2.imwrite(
                str(thumb_path),
                thumb,
                [cv2.IMWRITE_WEBP_QUALITY, 75],
            )

        if latitude or longitude:
            self._embed_exif_gps(str(filepath), latitude, longitude)

        log.info("[EVIDENCE] Saved: %s (+%s)", filepath, thumb_path.name)
        return str(filepath)

    def _make_thumbnail(
        self, annotated: np.ndarray
    ) -> np.ndarray | None:
        """Downscale an annotated frame to a fixed-width WebP thumbnail."""
        try:
            h, w = annotated.shape[:2]
            if w <= self.thumbnail_width:
                return annotated.copy()
            scale = self.thumbnail_width / w
            return cv2.resize(
                annotated, (self.thumbnail_width, int(h * scale))
            )
        except Exception:  # noqa: BLE001
            return None

    def archive_old(self, retention_days: float, now: float | None = None) -> int:
        """Move evidence older than ``retention_days`` into the archive dir.

        Returns the number of files archived. Retention is a soft lifecycle —
        archived files remain available if the archive dir is served, so we
        never delete evidence outright without an operator choosing to purge.
        """
        now = now if now is not None else time.time()
        cutoff = now - retention_days * 86400
        moved = 0
        for ext in ("*.jpg", "*.webp"):
            for fp in self.output_dir.glob(ext):
                try:
                    if fp.stat().st_mtime < cutoff:
                        dest = self.archive_dir / fp.name
                        if not dest.exists():
                            fp.rename(dest)
                            moved += 1
                except OSError:
                    continue
        if moved:
            log.info("[EVIDENCE] Archived %d evidence files", moved)
        return moved

    @staticmethod
    def _embed_exif_gps(filepath: str, latitude: float, longitude: float) -> None:
        """Embed GPS EXIF using Pillow (best-effort, never fails the capture)."""
        try:
            from PIL import Image
            from PIL.ExifTags import TAGS

            img = Image.open(filepath)
            exif = img.getexif()
            gps_ifd = {
                1: "N" if latitude >= 0 else "S",
                2: _exif_gps_to_dms(latitude),
                3: "E" if longitude >= 0 else "W",
                4: _exif_gps_to_dms(longitude),
            }
            gps_tag = next(
                (k for k, v in TAGS.items() if v == "GPSInfo"), 34853
            )
            exif[gps_tag] = gps_ifd
            img.save(filepath, exif=exif)
        except Exception:  # noqa: BLE001
            pass
