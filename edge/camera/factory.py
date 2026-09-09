from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from edge.camera.base import VideoSource
from edge.camera.file_video import FileVideoSource
from edge.camera.phone_stream import PhoneStreamSource
from edge.camera.rtsp import RTSPSource
from edge.camera.webcam import WebcamSource
from edge.camera.youtube import YouTubeSource


class CameraFactoryError(Exception):
    """Raised when a camera source cannot be constructed for a known reason."""


@dataclass
class CameraSpec:
    """Describes one camera on the bus (position + source configuration)."""

    position: str  # FRONT | REAR | LEFT | RIGHT | CABIN
    source_type: str  # phone | webcam | file | youtube | rtsp | off
    url: str | None = None
    device_id: int | None = None
    width: int = 640
    height: int = 480
    mandatory: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)


class CameraFactory:
    """Builds a :class:`VideoSource` from a :class:`CameraSpec`.

    Centralizes the mapping between the user-facing source type strings and the
    concrete source implementations. Sources are keyed by position so a bus can
    run up to 5 cameras (front/rear/left/right/cabin) with a dedicated source
    each. This makes supporting RTSP, USB, Android IP, hotspot and file feeds a
    single configuration concern.
    """

    _SOURCES = {
        "phone": PhoneStreamSource,
        "webcam": WebcamSource,
        "file": FileVideoSource,
        "youtube": YouTubeSource,
        "rtsp": RTSPSource,
    }

    @classmethod
    def create(cls, spec: CameraSpec) -> VideoSource | None:
        """Construct the concrete source for *spec* (or ``None`` if ``off``).

        Returns ``None`` for an explicitly disabled camera so optional cameras
        can be simply omitted from the multi-camera set.
        """
        stype = (spec.source_type or "off").strip().lower()
        if stype in {"", "off", "none", "disabled"}:
            return None

        cls_name = cls._SOURCES.get(stype)
        if cls_name is None:
            raise CameraFactoryError(
                f"Unknown camera source type '{stype}' for position {spec.position}. "
                f"Supported: {sorted(cls._SOURCES)}"
            )

        if stype == "webcam":
            return WebcamSource(
                device_id=spec.device_id if spec.device_id is not None else 0,
                width=spec.width,
                height=spec.height,
            )
        if stype in {"rtsp", "phone", "youtube"}:
            if not spec.url:
                raise CameraFactoryError(
                    f"Camera source '{stype}' at {spec.position} requires a URL."
                )
            if stype == "rtsp":
                return RTSPSource(spec.url, width=spec.width, height=spec.height)
            if stype == "phone":
                return PhoneStreamSource(spec.url, width=spec.width, height=spec.height)
            return YouTubeSource(spec.url, width=spec.width, height=spec.height)
        if stype == "file":
            if not spec.url:
                raise CameraFactoryError(
                    f"File source at {spec.position} requires a video path."
                )
            return FileVideoSource(spec.url, width=spec.width, height=spec.height)

        raise CameraFactoryError(f"Unhandled source type '{stype}'")

    @classmethod
    def default_front_spec(cls, settings: Any) -> CameraSpec:
        """A sane default for the mandatory front camera based on settings."""
        return CameraSpec(
            position="FRONT",
            source_type=settings.video_source.value
            if hasattr(settings.video_source, "value")
            else str(settings.video_source),
            url=(
                settings.phone_stream_url
                if getattr(settings, "phone_stream_url", None)
                else settings.video_file_path
            ),
            width=settings.frame_width,
            height=settings.frame_height,
            mandatory=True,
        )
