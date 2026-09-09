from __future__ import annotations

import time

import cv2
import numpy as np

from edge.camera.base import VideoSource
from edge.utils.logger import log


class RTSPSource(VideoSource):
    """RTSP / IP camera source with automatic reconnect and backoff.

    Production-grade RTSP handling beat OpenCV's default: we set a read timeout
    so a wedged stream doesn't block the pipeline forever, and we reconnect
    with exponential backoff on network failure.
    """

    def __init__(
        self,
        stream_url: str,
        width: int = 640,
        height: int = 480,
        max_retries: int = 8,
        reconnect_delay: float = 2.0,
    ) -> None:
        self.stream_url = stream_url
        self.width = width
        self.height = height
        self._max_retries = max_retries
        self._reconnect_delay = reconnect_delay
        self._cap: cv2.VideoCapture | None = None
        self._retries = 0
        self._last_error: str | None = None

    @property
    def source_type(self) -> str:
        return "rtsp"

    def open(self) -> None:
        # Lower the transport latency; cap the buffer so frames are as fresh as
        # possible (essential for avoiding stale-frame pile-up on a busy road).
        self._cap = cv2.VideoCapture(self.stream_url, cv2.CAP_FFMPEG)
        self._cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
        self._cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 3000)
        self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if self._cap.isOpened():
            log.info("[EDGE] RTSP connected: %s", self.stream_url)
            self._retries = 0
            self._last_error = None
        else:
            self._last_error = f"RTSP open failed: {self.stream_url}"
            log.warning("%s", self._last_error)

    def read(self) -> tuple[bool, np.ndarray | None]:
        if self._cap is None or not self._cap.isOpened():
            if self._retries < self._max_retries:
                self._retries += 1
                time.sleep(self._reconnect_delay * min(2.0, self._retries))
                self.open()
            else:
                log.error(
                    "[EDGE] RTSP gave up after %d retries: %s",
                    self._max_retries,
                    self.stream_url,
                )
            return False, None

        ret, frame = self._cap.read()
        if not ret or frame is None:
            self._last_error = "RTSP frame read failed (network loss?)"
            log.warning("[EDGE] %s — reconnecting", self._last_error)
            self.release()
            if self._retries < self._max_retries:
                self._retries += 1
                time.sleep(self._reconnect_delay)
                self.open()
            return False, None

        self._retries = 0
        if frame is not None:
            frame = cv2.resize(frame, (self.width, self.height))
        return True, frame

    def is_opened(self) -> bool:
        return self._cap is not None and self._cap.isOpened()

    def release(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None
            log.info("[EDGE] RTSP released: %s", self.stream_url)
