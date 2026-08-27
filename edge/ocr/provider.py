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
    def detect_plate(self, frame: np.ndarray, bbox: tuple[int, int, int, int]) -> OCRResult | None:
        raise NotImplementedError


class MockOCRProvider(OCRProvider):
    def detect_plate(self, frame: np.ndarray, bbox: tuple[int, int, int, int]) -> OCRResult | None:
        return OCRResult(
            plate_text="MH12AB1234",
            confidence=0.94,
            raw_text="MH12AB1234",
            source="SIMULATED",
        )


class PaddleOCRProvider(OCRProvider):
    def __init__(self) -> None:
        self._ocr = None

    def detect_plate(self, frame: np.ndarray, bbox: tuple[int, int, int, int]) -> OCRResult | None:
        if self._ocr is None:
            try:
                from paddleocr import PaddleOCR
                self._ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
            except ImportError:
                return None

        x1, y1, x2, y2 = bbox
        cropped = frame[y1:y2, x1:x2]
        if cropped.size == 0:
            return None

        result = self._ocr.ocr(cropped, cls=True)
        if not result or not result[0]:
            return None

        texts = []
        total_conf = 0.0
        for line in result[0]:
            text = line[1][0]
            conf = line[1][1]
            texts.append(text)
            total_conf += conf

        plate_text = " ".join(texts)
        avg_conf = total_conf / len(texts) if texts else 0.0

        return OCRResult(
            plate_text=plate_text,
            confidence=avg_conf,
            raw_text=str(result),
            source="PADDLE_OCR",
        )
