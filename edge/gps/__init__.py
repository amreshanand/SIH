from __future__ import annotations

from enum import Enum
from typing import Any, Callable

from edge.gps.base import GPSData, GPSProvider
from edge.gps.phone_gps import PhoneGPSProvider
from edge.gps.simulated import SimulatedGPSProvider
from edge.gps.nmea_gps import NMEAGPSProvider
from edge.gps.route_history import RouteHistory


class GPSMode(str, Enum):
    PHONE = "phone"
    NMEA = "nmea"
    SIMULATED = "simulated"


def build_gps_provider(
    mode: str,
    phone_gps_url: str | None = None,
    nmea_device: str | None = None,
    nmea_baudrate: int = 9600,
    nmea_host: str | None = None,
    nmea_port: int | None = None,
    simulated_route: str | None = None,
    gps_update_interval: float = 1.0,
    simulated_speed_mps: float = 13.9,
    nmea_max_age: float = 5.0,
) -> GPSProvider:
    """Construct a real GPS provider (phone or NMEA), or a simulated fallback.

    ``mode`` controls the PRIMARY provider:
      * "phone"     -> Android phone HTTP GPS
      * "nmea"      -> NMEA serial/TCP receiver
      * "simulated" -> simulated route follower (explicit fallback/dev only)

    A simulated provider is never the default for a production deployment; it
    must be selected explicitly. See the top-level pipeline which decides
    fallback policy.
    """
    if mode == GPSMode.PHONE.value:
        if not phone_gps_url:
            raise ValueError("phone GPS mode requires PHONE_GPS_URL")
        return PhoneGPSProvider(phone_gps_url, gps_update_interval)
    if mode == GPSMode.NMEA.value:
        return NMEAGPSProvider(
            device=nmea_device or "/dev/ttyUSB0",
            baudrate=nmea_baudrate,
            host=nmea_host,
            port=nmea_port,
            poll_interval=min(gps_update_interval, 0.5),
            max_age=nmea_max_age,
        )
    if mode == GPSMode.SIMULATED.value:
        if not simulated_route:
            raise ValueError("simulated GPS mode requires a route file")
        return SimulatedGPSProvider(
            simulated_route, gps_update_interval, simulated_speed_mps
        )
    raise ValueError(f"unknown GPS mode: {mode}")


__all__ = [
    "GPSData",
    "GPSMode",
    "GPSProvider",
    "RouteHistory",
    "build_gps_provider",
]
