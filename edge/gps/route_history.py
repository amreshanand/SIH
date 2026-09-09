from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any

from edge.gps.base import GPSData


class RouteHistory:
    """Thread-safe rolling history of GPS fixes for a bus.

    Keeps the most recent ``max_points`` fixes so the pipeline can:
    * recover a last-known position after GPS loss,
    * plot the traveled route for heatmaps / analytics,
    * detect stalling or off-route driving.

    Only real fixes with coordinates are recorded; simulated markers are kept
    but labelled so consumers can filter them.
    """

    def __init__(self, max_points: int = 1000) -> None:
        self._max_points = max(1, max_points)
        self._points: deque[dict[str, Any]] = deque(maxlen=self._max_points)
        self._lock = threading.Lock()

    def record(self, fix: GPSData) -> None:
        if fix is None:
            return
        point = {
            "latitude": fix.latitude,
            "longitude": fix.longitude,
            "speed": fix.speed,
            "heading": fix.heading,
            "accuracy": fix.accuracy,
            "source": fix.source,
            "fixed": fix.fixed,
            "ts": time.time(),
        }
        with self._lock:
            self._points.append(point)

    def recent(self, limit: int = 100, only_fixed: bool = True) -> list[dict[str, Any]]:
        with self._lock:
            points = list(self._points)
        if only_fixed:
            points = [p for p in points if p["fixed"]]
        return points[-limit:] if limit > 0 else points[-self._max_points:]

    def last_position(self) -> dict[str, Any] | None:
        with self._lock:
            if not self._points:
                return None
            return dict(self._points[-1])

    def clear(self) -> None:
        with self._lock:
            self._points.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._points)
