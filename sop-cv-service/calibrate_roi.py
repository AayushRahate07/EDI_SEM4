"""
calibrate_roi.py — Point cam2 at the scale display and run this.
Finds the brightest rectangle (scale LCD) and saves suggested config values.
"""
import cv2, numpy as np

CAM2_URL = "http://192.168.88.166:8080/video"
print("Grabbing fresh cam2 frame (draining buffer)...")
cap = cv2.VideoCapture(CAM2_URL)
cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
for _ in range(8): cap.read()   # drain
ret, frame = cap.read()
cap.release()

if not ret:
    print("Cannot connect to cam2"); exit(1)

h, w = frame.shape[:2]
print(f"Frame: {w}x{h}")

gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

# Find ALL bright rectangular regions
_, bright = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY)
contours, _ = cv2.findContours(bright, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

debug = frame.copy()
candidates = []
for c in contours:
    x, y, cw, ch = cv2.boundingRect(c)
    area = cw * ch
    aspect = cw / max(ch, 1)
    if area > 3000 and 0.3 < aspect < 8.0:
        candidates.append((area, x, y, cw, ch))
        cv2.rectangle(debug, (x,y), (x+cw, y+ch), (100,100,255), 1)

candidates.sort(reverse=True)   # largest first

print(f"\nTop bright regions detected:")
for i, (area, x, y, cw, ch) in enumerate(candidates[:5]):
    print(f"  [{i+1}] x={x} y={y} w={cw} h={ch}  area={area}")
    cv2.rectangle(debug, (x,y), (x+cw, y+ch), (0,255,255), 2)
    cv2.putText(debug, f"#{i+1}", (x+2, y+16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,255,255), 1)

if candidates:
    _, bx, by, bw, bh = candidates[0]
    # Add 20px padding
    pad = 20
    rx = max(0, bx - pad)
    ry = max(0, by - pad)
    rw = min(w - rx, bw + 2*pad)
    rh = min(h - ry, bh + 2*pad)
    print(f"\nSuggested scale_roi config:")
    print(f'  "scale_roi": {{ "x": {rx}, "y": {ry}, "w": {rw}, "h": {rh} }}')
    cv2.rectangle(debug, (rx,ry), (rx+rw, ry+rh), (0,255,0), 3)
    cv2.putText(debug, "SUGGESTED ROI", (rx, ry-8), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0,255,0), 2)

cv2.imwrite("calibrate_roi_debug.jpg", debug)
print("\nSaved: calibrate_roi_debug.jpg — check this image to verify the ROI")
