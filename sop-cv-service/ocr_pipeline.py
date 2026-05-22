"""
ocr_pipeline.py — Scale Display OCR
Primary:  EasyOCR (pure Python, no system install, accurate on digits)
Fallback: OpenCV contour heuristic (estimates digits present, no actual value)

The OCR pipeline runs on cam2 (desk camera), which has a top-down/angled view
of the weighing scale. The scale display can move dynamically in the frame.
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
        
        # Dynamic tracking state
        self.dynamic_roi = None
        self.failed_readings = 0
        self.scan_interval = 20  # Periodically scan full frame to keep scale location fresh
        self.scan_count = 0
        
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
        """Use EasyOCR to read digits, testing multiple preprocessing options and 4 rotations."""
        if self._reader is None:
            return None, 0.0
        
        try:
            h_c, w_c = roi_frame.shape[:2]
            if h_c == 0 or w_c == 0:
                return None, 0.0
                
            # Upscale 2x for better digit segment resolution
            roi_resized = cv2.resize(roi_frame, (w_c * 2, h_c * 2), interpolation=cv2.INTER_CUBIC)
            
            # Prepare preprocessed grayscale and contrast-enhanced images
            gray = cv2.cvtColor(roi_resized, cv2.COLOR_BGR2GRAY)
            enhanced = cv2.convertScaleAbs(gray, alpha=2.2, beta=-50)
            
            # Otsu thresholding
            blurred = cv2.GaussianBlur(gray, (3, 3), 0)
            _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            if np.mean(thresh) < 127:
                thresh = cv2.bitwise_not(thresh)
                
            best_val = None
            best_conf = 0.0
            
            # We try OCR on the raw, enhanced, and binarized versions of the crop
            versions = [
                ("raw", roi_resized),
                ("enhanced", enhanced),
                ("thresholded", thresh)
            ]
            
            for ver_name, img_version in versions:
                # Test 4 rotation states (0, 90 CW, 90 CCW, 180) for this image version
                rotations = {
                    "0": img_version,
                    "90_cw": cv2.rotate(img_version, cv2.ROTATE_90_CLOCKWISE),
                    "90_ccw": cv2.rotate(img_version, cv2.ROTATE_90_COUNTERCLOCKWISE),
                    "180": cv2.rotate(img_version, cv2.ROTATE_180)
                }
                
                for rot_name, rot_img in rotations.items():
                    results = self._reader.readtext(rot_img, allowlist='0123456789.-g ', detail=1)
                    for (bbox, text, conf) in results:
                        # Clean up text (remove spaces, 'g' units, etc.)
                        clean_text = text.replace(' ', '').replace('g', '')
                        match = re.search(r'(\d+\.?\d*)', clean_text)
                        if match:
                            val = float(match.group(1))
                            conf_pct = round(conf * 100, 1)
                            # If this reading has higher confidence, lock it in
                            if conf_pct > best_conf:
                                best_val = val
                                best_conf = conf_pct
                                
            return best_val, best_conf
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
        Extract scale ROI dynamically or fallback to config, run OCR, return (weight_g, confidence_pct, annotated_frame).
        """
        h, w = frame.shape[:2]
        annotated = frame.copy()
        
        self.scan_count += 1
        
        # Check if we need to scan the full frame for the scale
        need_full_scan = (self.dynamic_roi is None) or (self.failed_readings >= 8) or (self.scan_count % self.scan_interval == 0)
        
        if need_full_scan and self._reader_init:
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
            # Custom HSV range for the scale screen green/cyan backlight
            lower_green = np.array([30, 25, 80])
            upper_green = np.array([75, 180, 220])
            mask = cv2.inRange(hsv, lower_green, upper_green)
            
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            candidates = []
            for c in contours:
                cx, cy, cw, ch = cv2.boundingRect(c)
                area = cw * ch
                aspect = cw / max(ch, 1)
                # Rotated or upright scale display size filter
                if 1000 < area < 250000 and (0.2 < aspect < 5.0):
                    candidates.append((area, cx, cy, cw, ch))
            
            candidates.sort(reverse=True)
            
            best_roi = None
            best_weight = None
            best_conf = 0.0
            
            for area, bx, by, bw, bh in candidates[:4]:
                pad = 20
                rx = max(0, bx - pad)
                ry = max(0, by - pad)
                rw = min(w - rx, bw + 2 * pad)
                rh = min(h - ry, bh + 2 * pad)
                
                crop = frame[ry:ry+rh, rx:rx+rw]
                if crop.size == 0:
                    continue
                
                val, conf = self._easyocr_read(crop)
                # Require at least 30% confidence to establish initial lock
                if val is not None and conf > 30.0:
                    best_roi = {'x': rx, 'y': ry, 'w': rw, 'h': rh}
                    best_weight = val
                    best_conf = conf
                    break
            
            if best_roi is not None:
                if self.dynamic_roi != best_roi:
                    print(f"[OCR] Scale display dynamically locked at: {best_roi}")
                self.dynamic_roi = best_roi
                self.failed_readings = 0
                self._last_weight = best_weight
                self._last_confidence = best_conf
            elif self.dynamic_roi is not None:
                self.failed_readings += 1
                if self.failed_readings >= 8:
                    print("[OCR] Dynamic ROI search failed. Releasing lock.")
                    self.dynamic_roi = None
        
        current_roi = self.dynamic_roi if self.dynamic_roi is not None else self.roi
        is_dynamic = self.dynamic_roi is not None
        
        rx = min(current_roi['x'], w - 1)
        ry = min(current_roi['y'], h - 1)
        rw = min(current_roi['w'], w - rx)
        rh = min(current_roi['h'], h - ry)
        
        color = (0, 255, 0) if is_dynamic else (0, 165, 255)
        label = "SCALE ROI (LOCKED)" if is_dynamic else "SCALE ROI (SEARCHING)"
        cv2.rectangle(annotated, (rx, ry), (rx + rw, ry + rh), color, 2)
        cv2.putText(annotated, label, (rx, ry - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)
        
        roi_crop = frame[ry:ry + rh, rx:rx + rw]
        if roi_crop.size == 0:
            return self._last_weight, self._last_confidence, annotated
        
        # Run OCR if we didn't just read it in full frame scan
        if not (need_full_scan and is_dynamic):
            weight, confidence = self._easyocr_read(roi_crop)
            
            if weight is None and not is_dynamic:
                processed = self._preprocess(roi_crop)
                weight, confidence = self._contour_fallback(processed)
            
            if weight is not None:
                self._last_weight = weight
                self._last_confidence = confidence
                self.failed_readings = 0
            else:
                self.failed_readings += 1
                if is_dynamic and self.failed_readings >= 8:
                    print("[OCR] Loss of lock on dynamic ROI.")
                    self.dynamic_roi = None
        
        if self._last_weight is not None:
            label_val = f"{self._last_weight:.2f}g  OCR:{self._last_confidence:.0f}%"
            cv2.putText(annotated, label_val, (rx, ry - 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 150), 2)
        else:
            cv2.putText(annotated, f"OCR: {self._last_confidence:.0f}%", (rx + rw + 4, ry + 14),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (100, 100, 200), 1)
        
        return self._last_weight, self._last_confidence, annotated


