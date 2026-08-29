from __future__ import annotations

import cv2
import numpy as np
import time
import streamlink

from edge.camera.base import VideoSource
from edge.utils.logger import log


class YouTubeSource(VideoSource):
    def __init__(self, youtube_url: str, width: int = 640, height: int = 480) -> None:
        self.youtube_url = youtube_url
        self.width = width
        self.height = height
        self.cap: cv2.VideoCapture | None = None
        self._retries = 0
        self._max_retries = 5

    @property
    def source_type(self) -> str:
        return "youtube"

    def open(self) -> None:
        log.info("[EDGE] Resolving YouTube URL: %s", self.youtube_url)
        try:
            streams = streamlink.streams(self.youtube_url)
            if not streams:
                raise RuntimeError("No streams found for YouTube URL")
            stream_url = streams["best"].url
            log.info("[EDGE] Resolved YouTube stream URL successfully")
            self.cap = cv2.VideoCapture(stream_url)
            if not self.cap.isOpened():
                raise RuntimeError("Could not open YouTube VideoCapture stream")
            log.info("[EDGE] YouTube video stream connected")
            self._retries = 0
        except Exception as e:
            log.error("[EDGE] Failed to open YouTube stream: %s", e)
            raise

    def read(self) -> tuple[bool, np.ndarray | None]:
        if self.cap is None or not self.cap.isOpened():
            if self._retries < self._max_retries:
                self._retries += 1
                log.info("[EDGE] YouTube stream disconnected, retrying connect (%d/%d)", self._retries, self._max_retries)
                time.sleep(1)
                try:
                    self.open()
                except Exception:
                    pass
            return False, None

        ret, frame = self.cap.read()
        if not ret or frame is None:
            log.warning("[EDGE] YouTube stream read empty or failed")
            self.release()
            return False, None

        frame = cv2.resize(frame, (self.width, self.height))
        return ret, frame

    def is_opened(self) -> bool:
        return self.cap is not None and self.cap.isOpened()

    def release(self) -> None:
        if self.cap:
            self.cap.release()
            self.cap = None
            log.info("[EDGE] YouTube stream released")
