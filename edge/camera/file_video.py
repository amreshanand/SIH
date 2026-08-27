from __future__ import annotations

import cv2
import numpy as np

from edge.camera.base import VideoSource
from edge.utils.logger import log


class FileVideoSource(VideoSource):
    def __init__(self, file_path: str, width: int = 640, height: int = 480) -> None:
        self.file_path = file_path
        self.width = width
        self.height = height
        self.cap: cv2.VideoCapture | None = None

    @property
    def source_type(self) -> str:
        return "file"

    def open(self) -> None:
        log.info("[EDGE] Opening video file: %s", self.file_path)
        self.cap = cv2.VideoCapture(self.file_path)
        if self.cap.isOpened():
            log.info("[EDGE] Video file opened")
        else:
            log.error("[EDGE] Video file not found: %s", self.file_path)

    def read(self) -> tuple[bool, np.ndarray | None]:
        if self.cap is None or not self.cap.isOpened():
            return False, None
        ret, frame = self.cap.read()
        if not ret:
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ret, frame = self.cap.read()
        if ret and frame is not None:
            frame = cv2.resize(frame, (self.width, self.height))
        return ret, frame

    def is_opened(self) -> bool:
        return self.cap is not None and self.cap.isOpened()

    def release(self) -> None:
        if self.cap:
            self.cap.release()
            log.info("[EDGE] Video file released")
