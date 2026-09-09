"""Structured logging for UrbanSense AI backend.

Provides a JSON-formatter logging setup so logs are machine-parseable in
production and readable in dev. Replaces ad-hoc ``print`` calls in the boot
path with structured, level-aware, request-contextual logging.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any

from backend.app.core.config import settings


class JsonFormatter(logging.Formatter):
    """Emit each log record as a single JSON object."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if getattr(record, "_exc", False) or record.exc_info:
            payload["exc"] = self.formatException(record.exc_info) if record.exc_info else None
        extra = getattr(record, "extra_fields", None)
        if extra:
            payload.update(extra)
        return json.dumps(payload, default=str)


def _configure() -> None:
    root = logging.getLogger()
    root.setLevel(logging.DEBUG if settings.debug else logging.INFO)

    # Clear any existing handlers to avoid duplicate output on reload.
    for h in list(root.handlers):
        root.removeHandler(h)

    handler = logging.StreamHandler(sys.stdout)
    if settings.production or not settings.debug:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)-7s %(name)s: %(message)s"
            )
        )
    root.addHandler(handler)

    # FastAPI/uvicorn access logs keep their own format but at INFO.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers = []
        lg.propagate = True
        lg.setLevel(logging.INFO)


def get_logger(name: str) -> logging.Logger:
    """Return a structured logger with an ``extra_fields`` convenience.

    Usage:
        logger = get_logger("api.events")
        logger.info("event ingested", extra={"event_id": eid})
    """
    logger = logging.getLogger(name)

    def _emit(level: int, msg: str, **fields):
        logger.log(level, msg, extra={"extra_fields": fields})

    logger.info_ctx = lambda msg, **f: _emit(logging.INFO, msg, **f)
    logger.warning_ctx = lambda msg, **f: _emit(logging.WARNING, msg, **f)
    logger.error_ctx = lambda msg, **f: _emit(logging.ERROR, msg, **f)
    logger.debug_ctx = lambda msg, **f: _emit(logging.DEBUG, msg, **f)
    return logger


def configure_logging() -> None:
    _configure()
