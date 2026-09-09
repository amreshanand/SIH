"""Real license-plate OCR for UrbanSense AI.

Only real OCR backends are supported: PaddleOCR or EasyOCR. There is no mocked
plate text. If an OCR backend is unavailable the provider returns None and the
pipeline simply omits plate attribution rather than fabricating one.

The pipeline should gate this module behind ``OCR_ENABLED=true``; when disabled
the module is never imported so its heavy deps are not pulled in.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class OCRResult:
    plate_text: str
    confidence: float
    raw_text: str = ""
    source: str = "UNKNOWN"


class OCRProvider:
    def detect_plate(
        self, frame: np.ndarray, bbox: tuple[int, int, int, int]
    ) -> OCRResult | None:
        raise NotImplementedError


class _BaseRealOCR(OCRProvider):
    def _crop(self, frame: np.ndarray, bbox: tuple[int, int, int, int]) -> np.ndarray:
        x1, y1, x2, y2 = bbox
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(frame.shape[1], x2), min(frame.shape[0], y2)
        if x2 <= x1 or y2 <= y1:
            return np.array([])
        return frame[y1:y2, x1:x2]

    def _clean(self, text: str) -> str:
        # Uppercase and strip spaces/newlines to a compact plate candidate.
        return "".join(ch for ch in text.upper() if ch.isalnum())


class AdaptiveEasyOCRProvider(_BaseRealOCR):
    """EasyOCR-based plate OCR with lazy loading and honest failure."""

    def __init__(self) -> None:
        self._ocr = None
        self._init_error: str | None = None

    def _get_reader(self):
        if self._ocr is not None:
            return self._ocr
        if self._init_error:
            return None
        try:
            import easyocr

            self._ocr = easyocr.Reader(["en"], gpu=False)
        except Exception as exc:  # noqa: BLE001
            self._init_error = str(exc)
            return None
        return self._ocr

    def detect_plate(
        self, frame: np.ndarray, bbox: tuple[int, int, int, int]
    ) -> OCRResult | None:
        reader = self._get_reader()
        if reader is None:
            return None
        crop = self._crop(frame, bbox)
        if crop.size == 0:
            return None
        try:
            results = reader.readtext(crop)
        except Exception:  # noqa: BLE001
            return None
        if not results:
            return None
        # Select the highest-confidence text region.
        best = max(results, key=lambda r: r[2])
        text = self._clean(best[1])
        if not text:
            return None
        return OCRResult(
            plate_text=text,
            confidence=float(best[2]),
            raw_text=str(results),
            source="EASYOCR",
        )


class PaddleOCRProvider(_BaseRealOCR):
    def __init__(self) -> None:
        self._ocr = None
        self._init_error: str | None = None

    def _get_ocr(self):
        if self._ocr is not None:
            return self._ocr
        if self._init_error:
            return None
        try:
            from paddleocr import PaddleOCR

            self._ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
        except Exception as exc:  # noqa: BLE001
            self._init_error = str(exc)
            return None
        return self._ocr

    def detect_plate(
        self, frame: np.ndarray, bbox: tuple[int, int, int, int]
    ) -> OCRResult | None:
        ocr = self._get_ocr()
        if ocr is None:
            return None
        crop = self._crop(frame, bbox)
        if crop.size == 0:
            return None
        try:
            result = ocr.ocr(crop, cls=True)
        except Exception:  # noqa: BLE001
            return None
        if not result or not result[0]:
            return None
        texts = []
        confs = []
        for line in result[0]:
            texts.append(line[1][0])
            confs.append(line[1][1])
        if not texts:
            return None
        return OCRResult(
            plate_text=self._clean(" ".join(texts)),
            confidence=float(sum(confs) / len(confs)),
            raw_text=str(result),
            source="PADDLE_OCR",
        )


def build_ocr_provider(provider: str) -> OCRProvider | None:
    """Build a real OCR provider by name. Returns None if the only option is a
    disabled/mock provider or an unknown name."""
    p = provider.strip().lower()
    if p == "easyocr":
        return AdaptiveEasyOCRProvider()
    if p == "paddle":
        return PaddleOCRProvider()
    return None
