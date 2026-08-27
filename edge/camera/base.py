from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np


class VideoSource(ABC):
    @abstractmethod
    def open(self) -> None:
        ...

    @abstractmethod
    def read(self) -> tuple[bool, np.ndarray | None]:
        ...

    @abstractmethod
    def release(self) -> None:
        ...

    @abstractmethod
    def is_opened(self) -> bool:
        ...

    @property
    @abstractmethod
    def source_type(self) -> str:
        ...
