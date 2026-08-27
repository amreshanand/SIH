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

    def to_dict(self) -> dict:
        return {
            "latitude": self.latitude,
            "longitude": self.longitude,
            "speed": self.speed,
            "heading": self.heading,
            "source": self.source,
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
