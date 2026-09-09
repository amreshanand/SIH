"""NMEA-0183 GPS receiver for UrbanSense AI.

Connects to a serial NMEA GPS device (USB/serial adapters exposing a virtual
COM/UART port) or over TCP, parses the standard $GPGGA/$GPRMC sentences and
produces GPSData fixes. Used for hard-wired GPS receivers on the bus.

Only the two sentences we need are parsed; everything else is ignored. The
parsing is line-oriented and tolerant of partial/buffered reads, which is the
normal behavior of serial devices.
"""

from __future__ import annotations

import re
import threading
import time
from typing import Any

from edge.gps.base import GPSData, GPSProvider
from edge.utils.logger import log

_GGA_RE = re.compile(
    r"^\$GPGGA,(?P<time>[^,]*),(?P<lat>[^,]*),(?P<lat_hem>[NS]),"
    r"(?P<lon>[^,]*),(?P<lon_hem>[EW]),(?P<quality>[0-9]),"
    r"(?P<satellites>[0-9]*),(?P<hdop>[^,]*)"
)
_RMC_RE = re.compile(
    r"^\$GPRMC,(?P<time>[^,]*),(?P<status>[AV]),(?P<lat>[^,]*),(?P<lat_hem>[NS]),"
    r"(?P<lon>[^,]*),(?P<lon_hem>[EW]),(?P<speed>[^,]*),(?P<course>[^,]*)"
)


def _parse_ndeg(value: str) -> float | None:
    """Convert NMEA 'ddmm.mmmm' to decimal degrees, or None."""
    try:
        v = float(value)
    except ValueError:
        return None
    deg = int(v / 100)
    minutes = v - deg * 100
    return deg + minutes / 60.0


class NMEAGPSProvider(GPSProvider):
    def __init__(
        self,
        device: str = "/dev/ttyUSB0",
        baudrate: int = 9600,
        host: str | None = None,
        port: int | None = None,
        poll_interval: float = 0.5,
        max_age: float = 5.0,
    ) -> None:
        """Connect to a serial NMEA device, or a TCP host:port for networked GPS.

        Provide either ``device``/``baudrate`` (serial) or ``host``/``port``
        (TCP socket). ``max_age`` controls when a fix is treated as stale
        (last-known position is still returned, but flagged unfixed).
        """
        self.device = device
        self.baudrate = baudrate
        self.host = host
        self.port = port
        self.poll_interval = poll_interval
        self._gps_max_age = max_age
        self._available = False
        self._last_data: GPSData | None = None
        self._last_fix_time = 0.0
        self._buffer = ""
        self._lock = threading.Lock()
        self._reader_thread: threading.Thread | None = None
        self._shutdown = threading.Event()
        self._stream = None

    @property
    def is_available(self) -> bool:
        return self._available

    def initialize(self) -> None:
        try:
            if self.host and self.port:
                import socket

                self._stream = socket.create_connection((self.host, self.port), timeout=10)
                self._stream.settimeout(1.0)
                log.info("[GPS] NMEA over TCP %s:%s connected", self.host, self.port)
            else:
                import serial

                self._stream = serial.Serial(self.device, self.baudrate, timeout=1.0)
                log.info("[GPS] NMEA serial %s@%d connected", self.device, self.baudrate)
        except Exception as exc:  # noqa: BLE001
            log.warning("[GPS] NMEA not available (%s)", exc)
            self._available = False
            return

        self._available = True
        self._shutdown.clear()
        self._reader_thread = threading.Thread(
            target=self._read_loop, name="nmea-gps", daemon=True
        )
        self._reader_thread.start()
        log.info("[GPS] NMEA reader started")

    def _read_loop(self) -> None:
        while not self._shutdown.is_set():
            try:
                if self.host and self.port:
                    raw = self._stream.recv(4096)
                    if not raw:
                        continue
                    self._buffer += raw.decode("ascii", errors="ignore")
                else:
                    line = self._stream.readline()
                    if not line:
                        continue
                    self._buffer = line.decode("ascii", errors="ignore")
                    self._feed_line(self._buffer)
                    self._buffer = ""
                    continue
                # Split accumulated TCP buffer into lines.
                while "\n" in self._buffer:
                    line, self._buffer = self._buffer.split("\n", 1)
                    self._feed_line(line)
            except Exception:  # noqa: BLE001
                time.sleep(0.5)

    def _feed_line(self, line: str) -> None:
        line = line.strip()
        if not line:
            return
        fix = None
        if line.startswith("$GPGGA"):
            fix = self._parse_gga(line)
        elif line.startswith("$GPRMC"):
            fix = self._parse_rmc(line)
        if fix:
            now = time.time()
            with self._lock:
                self._last_data = fix
                self._last_fix_time = now
                self._available = True

    def _parse_gga(self, line: str) -> GPSData | None:
        m = _GGA_RE.match(line)
        if not m:
            return None
        quality = m.group("quality")
        if quality in ("0", ""):
            return None  # no fix
        lat = _parse_ndeg(m.group("lat"))
        lon = _parse_ndeg(m.group("lon"))
        if lat is None or lon is None:
            return None
        if m.group("lat_hem") == "S":
            lat = -lat
        if m.group("lon_hem") == "W":
            lon = -lon
        satellites = 0
        try:
            satellites = int(m.group("satellites") or 0)
        except ValueError:
            satellites = 0
        hdop = 0.0
        try:
            hdop = float(m.group("hdop") or 0)
        except ValueError:
            hdop = 0.0
        # Standard GPS rule-of-thumb: horizontal error ≈ HDOP * 3 meters.
        accuracy = round(hdop * 3.0, 1) if hdop > 0 else 0.0
        return GPSData(
            latitude=lat,
            longitude=lon,
            source="NMEA",
            accuracy=accuracy,
            hdop=hdop,
            satellites=satellites,
            fixed=True,
        )

    def _parse_rmc(self, line: str) -> GPSData | None:
        m = _RMC_RE.match(line)
        if not m:
            return None
        if m.group("status") != "A":
            return None  # no fix
        lat = _parse_ndeg(m.group("lat"))
        lon = _parse_ndeg(m.group("lon"))
        if lat is None or lon is None:
            return None
        if m.group("lat_hem") == "S":
            lat = -lat
        if m.group("lon_hem") == "W":
            lon = -lon
        try:
            speed_knots = float(m.group("speed"))
            speed_mps = speed_knots * 0.514444
        except (ValueError, TypeError):
            speed_mps = 0.0
        try:
            course = float(m.group("course"))
        except (ValueError, TypeError):
            course = 0.0
        return GPSData(
            latitude=lat,
            longitude=lon,
            speed=round(speed_mps, 1),
            heading=round(course, 1),
            source="NMEA",
        )

    def get_location(self) -> GPSData | None:
        with self._lock:
            if self._last_data is None:
                return None
            staleness = time.time() - self._last_fix_time
            if staleness > self._gps_max_age:
                # GPS dropped. Keep returning the last-known position so the
                # pipeline can continue (clearly marked as a stale/unfixed fix)
                # while the health layer reports the loss.
                self._available = False
                stale = GPSData(
                    latitude=self._last_data.latitude,
                    longitude=self._last_data.longitude,
                    speed=self._last_data.speed,
                    heading=self._last_data.heading,
                    source=self._last_data.source,
                    accuracy=self._last_data.accuracy,
                    hdop=self._last_data.hdop,
                    satellites=self._last_data.satellites,
                    fixed=False,
                )
                return stale
            self._available = True
            if not self._last_data.fixed:
                self._last_data.fixed = True
            return self._last_data

    def shutdown(self) -> None:
        self._shutdown.set()
        try:
            if self._stream is not None:
                self._stream.close()
        except Exception:  # noqa: BLE001
            pass
        if self._reader_thread and self._reader_thread.is_alive():
            self._reader_thread.join(timeout=1.0)
        self._available = False
        log.info("[GPS] NMEA stopped")
