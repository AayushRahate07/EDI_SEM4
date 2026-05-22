"""
ocr_pipeline.py — Scale Display OCR
Primary:  EasyOCR (pure Python, no system install, accurate on digits)
Fallback: OpenCV contour heuristic (estimates digits present, no actual value)

The OCR pipeline runs on cam2 (desk camera), which has a top-down/angled view
of the weighing scale. The scale_roi in config.json defines the crop region.
"""

import cv2
import numpy as np
import re
from typing import Optional


class OcrPipeline:
    def __init__(self, config: dict):
        self.roi = config.get('scale_roi', {'x': 400, 'y': 50, 'w': 400, 'h': 120})
        self._last_weight: Optional[float] = None
        self._last_confidence: float = 0.0
        self._reader = None
        self._reader_init = False
        self._init_easyocr()

    def _init_easyocr(self):
        """Lazy-load EasyOCR reader (heavy init — done once)."""
        try:
            import easyocr
            print("[OCR] Loading EasyOCR model (digits only)...")
            self._reader = easyocr.Reader(['en'], gpu=False, verbose=False)
            print("[OCR] EasyOCR ready.")
            self._reader_init = True
        except Exception as e:
            print(f"[OCR] EasyOCR unavailable: {e}. Will use contour fallback.")
            self._reader = None
            self._reader_init = False

    def _preprocess(self, roi_frame: np.ndarray) -> np.ndarray:
        """Enhance contrast for digit readability."""
        gray = cv2.cvtColor(roi_frame, cv2.COLOR_BGR2GRAY)
        # Boost contrast — scale LCDs are bright
        gray = cv2.convertScaleAbs(gray, alpha=1.8, beta=-30)
        blurred = cv2.GaussianBlur(gray, (3, 3), 0)
        _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
        return cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

    def _easyocr_read(self, roi_frame: np.ndarray) -> tuple[Optional[float], float]:
        """Use EasyOCR to read digits from the scale display ROI."""
        if self._reader is None:
            return None, 0.0
        try:
            results = self._reader.readtext(roi_frame, allowlist='0123456789.-', detail=1)
            for (bbox, text, conf) in results:
                match = re.search(r'(\d+\.?\d*)', text)
                if match:
                    val = float(match.group(1))
                    return val, round(conf * 100, 1)
            return None, 0.0
        except Exception as e:
            print(f"[OCR] EasyOCR read error: {e}")
            return None, 0.0

    def _contour_fallback(self, processed: np.ndarray) -> tuple[Optional[float], float]:
        """Estimate if digits are present using contour count."""
        contours, _ = cv2.findContours(processed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        digit_like = [c for c in contours if 200 < cv2.contourArea(c) < 15000]
        if 1 <= len(digit_like) <= 6:
            return None, 30.0
        return None, 0.0

    def process_frame(self, frame: np.ndarray) -> tuple[Optional[float], float, np.ndarray]:
        """
        Extract scale ROI, run OCR, return (weight_g, confidence_pct, annotated_frame).
        """
        h, w = frame.shape[:2]
        rx = min(self.roi['x'], w - 1)
        ry = min(self.roi['y'], h - 1)
        rw = min(self.roi['w'], w - rx)
        rh = min(self.roi['h'], h - ry)

        annotated = frame.copy()
        cv2.rectangle(annotated, (rx, ry), (rx + rw, ry + rh), (0, 200, 255), 2)
        cv2.putText(annotated, "SCALE ROI", (rx, ry - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 200, 255), 1)

        roi_crop = frame[ry:ry + rh, rx:rx + rw]
        if roi_crop.size == 0:
            return self._last_weight, self._last_confidence, annotated

        # Primary: EasyOCR
        weight, confidence = self._easyocr_read(roi_crop)

        # Fallback: contour heuristic
        if weight is None:
            processed = self._preprocess(roi_crop)
            weight, confidence = self._contour_fallback(processed)

        if weight is not None:
            self._last_weight = weight
            self._last_confidence = confidence
            label = f"{weight:.2f}g  OCR:{confidence:.0f}%"
            cv2.putText(annotated, label, (rx, ry - 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 150), 2)
        else:
            cv2.putText(annotated, f"OCR: {confidence:.0f}%", (rx + rw + 4, ry + 14),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (100, 100, 200), 1)

        return self._last_weight, self._last_confidence, annotated
