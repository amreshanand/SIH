from __future__ import annotations

import time

import cv2
import numpy as np

from edge.camera.base import VideoSource
from edge.utils.logger import log


class PhoneStreamSource(VideoSource):
    def __init__(self, stream_url: str, width: int = 640, height: int = 480) -> None:
        self.stream_url = stream_url
        self.width = width
        self.height = height
        self.cap: cv2.VideoCapture | None = None
        self._retries = 0
        self._max_retries = 5

    @property
    def source_type(self) -> str:
        return "phone"

    def open(self) -> None:
        log.info("[EDGE] Connecting to phone stream: %s", self.stream_url)
        self.cap = cv2.VideoCapture(self.stream_url)
        if self.cap.isOpened():
            log.info("[EDGE] Phone camera connected")
            self._retries = 0
        else:
            log.warning("[EDGE] Phone stream unavailable — will retry")

    def read(self) -> tuple[bool, np.ndarray | None]:
        if self.cap is None or not self.cap.isOpened():
            if self._retries < self._max_retries:
                self._retries += 1
                time.sleep(1)
                self.open()
            return False, None

        ret, frame = self.cap.read()
        if not ret:
            return False, None
        if frame is not None:
            frame = cv2.resize(frame, (self.width, self.height))
        return ret, frame

    def is_opened(self) -> bool:
        return self.cap is not None and self.cap.isOpened()

    def release(self) -> None:
        if self.cap:
            self.cap.release()
            log.info("[EDGE] Phone camera released")
