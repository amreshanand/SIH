from __future__ import annotations

import cv2
import numpy as np

from edge.camera.base import VideoSource
from edge.utils.logger import log


class WebcamSource(VideoSource):
    def __init__(self, device_id: int = 0, width: int = 640, height: int = 480) -> None:
        self.device_id = device_id
        self.width = width
        self.height = height
        self.cap: cv2.VideoCapture | None = None

    @property
    def source_type(self) -> str:
        return "webcam"

    def open(self) -> None:
        log.info("[EDGE] Opening webcam device %d", self.device_id)
        self.cap = cv2.VideoCapture(self.device_id)
        if not self.cap.isOpened():
            raise RuntimeError(f"Could not open webcam device {self.device_id}")
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        log.info("[EDGE] Webcam connected")

    def read(self) -> tuple[bool, np.ndarray | None]:
        if self.cap is None or not self.cap.isOpened():
            return False, None
        ret, frame = self.cap.read()
        if ret and frame is not None:
            frame = cv2.resize(frame, (self.width, self.height))
        return ret, frame

    def is_opened(self) -> bool:
        return self.cap is not None and self.cap.isOpened()

    def release(self) -> None:
        if self.cap:
            self.cap.release()
            log.info("[EDGE] Webcam released")
