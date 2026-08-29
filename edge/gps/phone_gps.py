from __future__ import annotations

import time

import httpx

from edge.gps.base import GPSData, GPSProvider
from edge.utils.logger import log


class PhoneGPSProvider(GPSProvider):
    """Polls the phone GPS over HTTP. Recovers from transient failures.

    State: ONLINE -> DEGRADED (transient error) -> ONLINE on next success.
    A DEGRADED provider keeps returning the last known fix, so the pipeline
    never loses history permanently on a momentary disconnect.
    """

    def __init__(self, gps_url: str, poll_interval: float = 1.0) -> None:
        self.gps_url = gps_url
        self.poll_interval = poll_interval
        self._available = False
        self._degraded = False
        self._last_data: GPSData | None = None
        self._last_poll = 0.0

    @property
    def is_available(self) -> bool:
        return self._available

    @property
    def is_degraded(self) -> bool:
        return self._degraded

    def initialize(self) -> None:
        log.info("[GPS] Connecting to phone GPS: %s", self.gps_url)
        try:
            resp = httpx.get(self.gps_url, timeout=3)
            if resp.status_code == 200:
                self._available = True
                self._degraded = False
                log.info("[GPS] Phone GPS connected")
            else:
                log.warning("[GPS] Phone GPS not responding — will retry")
        except Exception:
            log.warning("[GPS] Phone GPS unavailable")

    def get_location(self) -> GPSData | None:
        now = time.time()
        if now - self._last_poll < self.poll_interval:
            # Return the last known fix (cache) within the poll interval.
            return self._last_data

        self._last_poll = now
        try:
            resp = httpx.get(self.gps_url, timeout=2)
            if resp.status_code == 200:
                d = resp.json()
                self._last_data = GPSData(
                    latitude=d["latitude"],
                    longitude=d["longitude"],
                    speed=d.get("speed", 0),
                    heading=d.get("heading", 0),
                    source="PHONE",
                )
                # Success clears both the degraded and unavailable flags so the
                # provider recovers after any transient (or initial) failure.
                self._available = True
                if self._degraded:
                    self._degraded = False
                    log.info("[GPS] Phone GPS recovered")
                return self._last_data
            else:
                self._degraded = True
                return self._last_data
        except Exception:
            self._degraded = True
            return self._last_data

    def shutdown(self) -> None:
        self._available = False
        log.info("[GPS] Phone GPS disconnected")
