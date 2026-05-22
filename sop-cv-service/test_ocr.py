"""
test_ocr.py — Live OCR test on cam2 scale display using EasyOCR
"""
import cv2, numpy as np, re, time

CAM2_URL = "http://192.168.88.166:8080/video"
ROI = {"x": 870, "y": 30, "w": 290, "h": 290}

print("Initializing EasyOCR (first run downloads model ~40MB)...")
t0 = time.time()
import easyocr
reader = easyocr.Reader(['en'], gpu=False, verbose=False)
print(f"EasyOCR ready in {time.time()-t0:.1f}s")

print("\nGrabbing cam2 frame...")
cap = cv2.VideoCapture(CAM2_URL)
cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
for _ in range(8): cap.read()
ret, frame = cap.read()
cap.release()

if not ret:
    print("ERROR: Cannot connect to cam2"); exit(1)

h, w = frame.shape[:2]
print(f"Frame: {w}x{h}")

# Crop display ROI
rx, ry, rw, rh = ROI['x'], ROI['y'], ROI['w'], ROI['h']
roi_crop = frame[ry:ry+rh, rx:rx+rw]

# Preprocess for better OCR
gray = cv2.cvtColor(roi_crop, cv2.COLOR_BGR2GRAY)
enhanced = cv2.convertScaleAbs(gray, alpha=2.0, beta=-40)

print("\nRunning EasyOCR on scale display ROI...")
results = reader.readtext(roi_crop, allowlist='0123456789.-', detail=1)
results_enhanced = reader.readtext(enhanced, allowlist='0123456789.-', detail=1)

print("\n=== OCR Results (original crop) ===")
weight = None
for (bbox, text, conf) in results:
    print(f"  text='{text}'  conf={conf:.2f}")
    m = re.search(r'(\d+\.?\d*)', text)
    if m and conf > 0.3:
        weight = float(m.group(1))

print("\n=== OCR Results (enhanced) ===")
for (bbox, text, conf) in results_enhanced:
    print(f"  text='{text}'  conf={conf:.2f}")
    m = re.search(r'(\d+\.?\d*)', text)
    if m and conf > 0.3 and weight is None:
        weight = float(m.group(1))

print(f"\nFinal parsed weight: {weight}g")

# Save debug images
annotated = frame.copy()
cv2.rectangle(annotated, (rx, ry), (rx+rw, ry+rh), (0, 255, 0), 3)
label = f"{'%.2fg' % weight if weight else 'NO READ'}"
cv2.putText(annotated, label, (rx, ry + rh + 25), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0,255,0), 2)
cv2.imwrite("ocr_test_result.jpg", annotated)
cv2.imwrite("ocr_display_roi.jpg", roi_crop)
cv2.imwrite("ocr_display_enhanced.jpg", enhanced)
print("\nSaved: ocr_test_result.jpg, ocr_display_roi.jpg, ocr_display_enhanced.jpg")
