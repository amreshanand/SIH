from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional


class FrameStore:
    """Thread-safe holder for the most recent annotated frame (JPEG bytes)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jpeg: bytes | None = None
        self._frame_no: int = 0
        self._timestamp: float = 0.0

    def set(self, jpeg: bytes, frame_no: int) -> None:
        with self._lock:
            self._jpeg = jpeg
            self._frame_no = frame_no
            import time

            self._timestamp = time.time()

    def get(self) -> tuple[bytes | None, int]:
        with self._lock:
            return self._jpeg, self._frame_no

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "jpeg_ready": self._jpeg is not None,
                "frame_no": self._frame_no,
                "timestamp": self._timestamp,
            }


MJPEG_BOUNDARY = "urbansense-frame"
MJPEG_HEADER = b"--" + MJPEG_BOUNDARY.encode() + b"\r\nContent-Type: image/jpeg\r\n"
MJPEG_TRAILER = b"\r\n"
_MJPEG_CONTENT_TYPE = "multipart/x-mixed-replace; boundary=" + MJPEG_BOUNDARY


def encode_mjpeg_part(jpeg: bytes) -> bytes:
    return (
        MJPEG_HEADER
        + b"Content-Length: "
        + str(len(jpeg)).encode()
        + b"\r\n\r\n"
        + jpeg
        + MJPEG_TRAILER
    )


def _make_handler(store: FrameStore):
    class MjpegHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "UrbanSenseEdge/1.0"

        def log_message(self, format: str, *args) -> None:  # noqa: A002
            return

        def _send_common_headers(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")

        def do_GET(self) -> None:  # noqa: N802
            if self.path.rstrip("/") in ("", "/index.html", "/"):
                body = (
                    b"<html><body><h2>UrbanSense Edge MJPEG Stream</h2>"
                    b'<img src="/stream.mjpg" style="width:100%;max-width:960px"></body></html>'
                )
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.send_header("Content-Length", str(len(body)))
                self._send_common_headers()
                self.end_headers()
                self.wfile.write(body)
                return

            if not self.path.startswith("/stream"):
                self.send_response(404)
                self.end_headers()
                return

            self.send_response(200)
            self.send_header("Content-Type", _MJPEG_CONTENT_TYPE)
            self._send_common_headers()
            self.end_headers()

            try:
                while True:
                    jpeg, _ = store.get()
                    if jpeg:
                        self.wfile.write(encode_mjpeg_part(jpeg))
                        self.wfile.flush()
                    else:
                        self.wfile.write(
                            encode_mjpeg_part(
                                b"\xff\xd8"  # placeholder empty JPEG marker
                                b"\xff\xd9"
                            )
                        )
                        self.wfile.flush()
                    self._sleep(0.05)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def _sleep(self, seconds: float) -> None:
            import time

            time.sleep(seconds)

    return MjpegHandler


class MjpegStreamServer:
    """Background MJPEG HTTP server exposing the latest annotated frame."""

    def __init__(self, host: str = "0.0.0.0", port: int = 8001) -> None:
        self.host = host
        self.port = port
        self.store = FrameStore()
        self._httpd: ThreadingHTTPServer | None = None
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        from functools import partial

        handler = _make_handler(self.store)
        try:
            self._httpd = ThreadingHTTPServer((self.host, self.port), handler)
            self._thread = threading.Thread(daemon=True, target=self._httpd.serve_forever)
            self._thread.start()
        except OSError as exc:
            self._httpd = None
            raise RuntimeError(f"Could not bind MJPEG server on {self.host}:{self.port}: {exc}") from exc

    @property
    def running(self) -> bool:
        return self._httpd is not None

    def publish(self, jpeg: bytes, frame_no: int) -> None:
        if self._httpd is None:
            return
        self.store.set(jpeg, frame_no)

    def snapshot(self) -> dict:
        return {"host": self.host, "port": self.port, "running": self.running, **self.store.snapshot()}

    def stop(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None
