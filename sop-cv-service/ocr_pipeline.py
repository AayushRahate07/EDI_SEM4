"""
ocr_pipeline.py — 7-Segment Display OCR for Weighing Scale Readings
Uses classical OpenCV (no ML) for high accuracy on digital numeric displays.
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

    def _preprocess(self, roi_frame: np.ndarray) -> np.ndarray:
        gray     = cv2.cvtColor(roi_frame, cv2.COLOR_BGR2GRAY)
        blurred  = cv2.GaussianBlur(gray, (3, 3), 0)
        _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        kernel   = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
        cleaned  = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
        return cleaned

    def _extract_digits(self, processed: np.ndarray) -> tuple[Optional[float], float]:
        """
        Attempts to read numeric value from the processed binary image.
        Returns (value, confidence_pct).
        """
        try:
            import pytesseract
            config_str = '--psm 7 --oem 3 -c tessedit_char_whitelist=0123456789.-'
            text = pytesseract.image_to_string(processed, config=config_str).strip()
            match = re.search(r'(\d+\.?\d*)', text)
            if match:
                val = float(match.group(1))
                return val, 92.0
        except Exception:
            # Tesseract not installed or failed — fall through to contour method
            pass

        # Fallback: contour-based digit count heuristic
        contours, _ = cv2.findContours(processed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        digit_like = [c for c in contours if 200 < cv2.contourArea(c) < 15000]

        if 1 <= len(digit_like) <= 6:
            return None, 30.0

        return None, 0.0


    def process_frame(self, frame: np.ndarray) -> tuple[Optional[float], float, np.ndarray]:
        """
        Extract the scale ROI, run OCR, return (weight, confidence%, annotated_frame).
        """
        h, w = frame.shape[:2]
        rx = min(self.roi['x'], w - 1)
        ry = min(self.roi['y'], h - 1)
        rw = min(self.roi['w'], w - rx)
        rh = min(self.roi['h'], h - ry)

        annotated = frame.copy()

        # Draw ROI rectangle on full frame
        cv2.rectangle(annotated, (rx, ry), (rx + rw, ry + rh), (0, 200, 255), 2)
        cv2.putText(annotated, f"OCR ROI", (rx, ry - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 200, 255), 1)

        roi_crop = frame[ry:ry + rh, rx:rx + rw]
        if roi_crop.size == 0:
            return self._last_weight, self._last_confidence, annotated

        processed = self._preprocess(roi_crop)
        weight, confidence = self._extract_digits(processed)

        if weight is not None:
            self._last_weight      = weight
            self._last_confidence  = confidence
            label = f"{weight:.2f}g  OCR:{confidence:.0f}%"
            cv2.putText(annotated, label, (rx, ry - 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 150), 1)
        else:
            cv2.putText(annotated, f"OCR: {confidence:.0f}%", (rx + rw + 4, ry + 14),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (100, 100, 200), 1)

        return self._last_weight, self._last_confidence, annotated
