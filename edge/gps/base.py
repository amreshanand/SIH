from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class GPSData:
    latitude: float
    longitude: float
    speed: float = 0.0
    heading: float = 0.0
    source: str = "UNKNOWN"
    # Signal quality / precision (real receivers populate these; simulated/phone
    # providers leave them at defaults so consumers can treat "0" as unknown).
    accuracy: float = 0.0  # horizontal position error in meters (0 = unknown)
    hdop: float = 0.0  # horizontal dilution of precision (0 = unknown)
    satellites: int = 0  # number of tracked satellites (0 = unknown)
    fixed: bool = False  # whether a valid 3D/2D fix is currently held

    @property
    def has_fix(self) -> bool:
        return self.fixed and self.satellites > 0

    @property
    def signal_quality(self) -> str:
        """A coarse but useful label for dashboards based on HDOP/accuracy."""
        if not self.fixed or self.satellites == 0:
            return "NO_FIX"
        if self.hdop > 0:
            if self.hdop <= 2:
                return "EXCELLENT"
            if self.hdop <= 5:
                return "GOOD"
            if self.hdop <= 10:
                return "FAIR"
            return "POOR"
        # No HDOP available — fall back to accuracy in meters.
        if self.accuracy <= 0:
            return "UNKNOWN"
        if self.accuracy <= 5:
            return "EXCELLENT"
        if self.accuracy <= 15:
            return "GOOD"
        if self.accuracy <= 50:
            return "FAIR"
        return "POOR"

    def to_dict(self) -> dict:
        return {
            "latitude": self.latitude,
            "longitude": self.longitude,
            "speed": self.speed,
            "heading": self.heading,
            "source": self.source,
            "accuracy": self.accuracy,
            "hdop": self.hdop,
            "satellites": self.satellites,
            "fixed": self.fixed,
            "signal_quality": self.signal_quality,
        }


class GPSProvider(ABC):
    @abstractmethod
    def initialize(self) -> None:
        ...

    @abstractmethod
    def get_location(self) -> GPSData | None:
        ...

    @abstractmethod
    def shutdown(self) -> None:
        ...

    @property
    @abstractmethod
    def is_available(self) -> bool:
        ...
