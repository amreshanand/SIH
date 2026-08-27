from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone


class ColorFormatter(logging.Formatter):
    COLORS = {
        "EDGE": "\033[96m",
        "AI": "\033[93m",
        "EVENT": "\033[91m",
        "GPS": "\033[92m",
        "EVIDENCE": "\033[95m",
        "API": "\033[94m",
        "DB": "\033[33m",
        "WS": "\033[35m",
        "STREAM": "\033[90m",
        "CONFIG": "\033[97m",
    }
    RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.name, "")
        ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
        level = record.levelname[0]
        msg = record.getMessage()
        return f"{color}[{ts}] [{record.name}] {level}: {msg}{self.RESET}"


def setup_logger(name: str = "URBANSENSE") -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(ColorFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.DEBUG)
    return logger


log = setup_logger()
