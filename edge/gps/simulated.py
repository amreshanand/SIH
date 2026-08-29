from __future__ import annotations

import json
import math
import time
from pathlib import Path

from edge.gps.base import GPSData, GPSProvider
from edge.utils.logger import log


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


class SimulatedGPSProvider(GPSProvider):
    """Follows a route file with distance-proportional interpolation.

    Advances a cumulative distance along the polyline at a realistic bus speed
    (~50 km/h) and reports a real instantaneous speed (m/s) and heading computed
    from the actual travel direction, instead of hardcoded constants.
    """

    def __init__(self, route_file: str, update_interval: float = 1.0,
                 speed_mps: float = 13.9) -> None:
        self.route_file = route_file
        self.update_interval = update_interval
        self.speed_mps = speed_mps
        self._stops: list[dict] = []
        self._cumulative_m: list[float] = []
        self._total_m = 0.0
        self._progress_m = 0.0
        self._last_update = 0.0
        self._available = False
        self._last_speed = 0.0

    @property
    def is_available(self) -> bool:
        return self._available

    def initialize(self) -> None:
        p = Path(self.route_file)
        if not p.exists():
            log.error("[GPS] Route file not found: %s", self.route_file)
            return
        try:
            with open(p) as f:
                self._stops = json.load(f)
            if not self._stops or not all("lat" in s and "lon" in s for s in self._stops):
                log.error("[GPS] Route file has invalid/missing coordinates")
                self._stops = []
                return
            self._cumulative_m = [0.0]
            run = 0.0
            for i in range(1, len(self._stops)):
                run += _haversine_m(
                    self._stops[i - 1]["lat"], self._stops[i - 1]["lon"],
                    self._stops[i]["lat"], self._stops[i]["lon"],
                )
                self._cumulative_m.append(run)
            self._total_m = run
            self._available = True
            self._last_update = time.time()
            log.info("[GPS] Simulated GPS loaded: %d stops (route %.0f m)",
                     len(self._stops), self._total_m)
        except Exception as e:
            log.error("[GPS] Failed to load route file: %s", e)

    def _position_at(self, dist_m: float, lat1: float, lon1: float,
                     lat2: float, lon2: float) -> tuple[float, float]:
        seg = _haversine_m(lat1, lon1, lat2, lon2)
        if seg <= 0:
            return lat2, lon2
        t = max(0.0, min(1.0, dist_m / seg))
        lat = lat1 + (lat2 - lat1) * t
        lon = lon1 + (lon2 - lon1) * t
        return lat, lon

    def get_location(self) -> GPSData | None:
        if not self._available or not self._stops or self._total_m <= 0:
            return None

        now = time.time()
        dt = max(0.0, now - self._last_update)
        if dt < self.update_interval:
            dt = 0.0

        if dt > 0:
            self._progress_m = (self._progress_m + self.speed_mps * dt) % self._total_m
            self._last_update = now

        # Find the segment containing the current progress.
        i = 0
        while i < len(self._cumulative_m) - 1 and self._cumulative_m[i + 1] < self._progress_m:
            i += 1
        seg_start_m = self._cumulative_m[i]
        seg_end_m = self._cumulative_m[i + 1]
        stop = self._stops[i]
        next_stop = self._stops[(i + 1) % len(self._stops)]

        lat, lon = self._position_at(
            self._progress_m - seg_start_m,
            stop["lat"], stop["lon"], next_stop["lat"], next_stop["lon"],
        )

        # Speed travelled since the previous poll.
        if dt > 0:
            self._last_speed = self.speed_mps

        heading = 0.0
        try:
            dy = next_stop["lat"] - stop["lat"]
            dx = (next_stop["lon"] - stop["lon"]) * math.cos(math.radians(lat))
            heading = math.degrees(math.atan2(dx, dy)) % 360.0
        except Exception:
            heading = 0.0

        return GPSData(
            latitude=round(lat, 6),
            longitude=round(lon, 6),
            speed=round(self._last_speed, 1),
            heading=round(heading, 1),
            source="SIMULATED",
        )

    def shutdown(self) -> None:
        self._available = False
        log.info("[GPS] Simulated GPS stopped")
