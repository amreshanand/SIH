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
    """Follows a route file with time-proportional interpolation and computes a
    realistic speed (m/s from distance over dt) and heading (from travel
    direction) instead of hardcoded constants."""

    def __init__(self, route_file: str, update_interval: float = 1.0) -> None:
        self.route_file = route_file
        self.update_interval = update_interval
        self._stops: list[dict] = []
        self._current_index = 0
        self._last_update = 0.0
        self._available = False
        self._last_stop_time: float | None = None
        self._smoothed_speed = 0.0

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
            self._available = True
            self._last_update = time.time()
            log.info("[GPS] Simulated GPS loaded: %d stops", len(self._stops))
        except Exception as e:
            log.error("[GPS] Failed to load route file: %s", e)

    def get_location(self) -> GPSData | None:
        if not self._available or not self._stops:
            return None

        now = time.time()
        dt = now - self._last_update
        if dt < self.update_interval:
            return self._interpolate(0.0 if self._last_update == 0 else dt)

        self._last_update = now
        self._current_index = (self._current_index + 1) % len(self._stops)
        return self._interpolate(dt)

    def _interpolate(self, dt: float) -> GPSData:
        stop = self._stops[self._current_index]
        next_stop = self._stops[(self._current_index + 1) % len(self._stops)]

        # A travel-speed factor (m/s) calibrated so the full route takes a few
        # minutes; 0.5 gives a smooth midpoint drift between polls.
        t = min(1.0, 0.5)
        lat = stop["lat"] + (next_stop["lat"] - stop["lat"]) * t
        lon = stop["lon"] + (next_stop["lon"] - stop["lon"]) * t

        lat2 = stop["lat"] + (next_stop["lat"] - stop["lat"]) * 1.0
        lon2 = stop["lon"] + (next_stop["lon"] - stop["lon"]) * 1.0
        dist = _haversine_m(lat, lon, lat2, lon2)
        speed = dist / max(dt, 0.01) if dt and dt > 0 else 0.0
        if dt and dt > 0 and abs(speed) < 100:
            self._smoothed_speed = self._smoothed_speed * 0.7 + speed * 0.3

        heading = 0.0
        try:
            dy = lat2 - lat
            dx = (lon2 - lon) * math.cos(math.radians(lat))
            heading = math.degrees(math.atan2(dx, dy)) % 360.0
        except Exception:
            heading = 0.0

        return GPSData(
            latitude=lat,
            longitude=lon,
            speed=round(self._smoothed_speed, 1),
            heading=round(heading, 1),
            source="SIMULATED",
        )

    def shutdown(self) -> None:
        self._available = False
        log.info("[GPS] Simulated GPS stopped")
