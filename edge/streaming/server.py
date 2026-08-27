from __future__ import annotations

import asyncio
import base64
import time
from pathlib import Path

import cv2
import numpy as np

from edge.utils.logger import log


class MJPEGStreamer:
    def __init__(self, width: int = 640, height: int = 360, quality: int = 80) -> None:
        self.width = width
        self.height = height
        self.quality = quality
        self._clients: list[asyncio.Queue] = []
        self._current_frame: bytes | None = None

    def update_frame(self, frame: np.ndarray) -> None:
        resized = cv2.resize(frame, (self.width, self.height))
        _, buffer = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, self.quality])
        self._current_frame = buffer.tobytes()

        dead: list[asyncio.Queue] = []
        for q in self._clients:
            try:
                q.put_nowait(self._current_frame)
            except asyncio.QueueFull:
                dead.append(q)
        for d in dead:
            self._clients.remove(d)

    async def stream_mjpeg(self) -> None:
        from fastapi import Request
        from fastapi.responses import StreamingResponse

        queue: asyncio.Queue = asyncio.Queue(maxsize=2)
        self._clients.append(queue)

        async def generate():
            try:
                while True:
                    frame = await queue.get()
                    yield (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n\r\n"
                        + frame
                        + b"\r\n"
                    )
            except asyncio.CancelledError:
                pass
            finally:
                if queue in self._clients:
                    self._clients.remove(queue)

        return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")

    @property
    def client_count(self) -> int:
        return len(self._clients)
