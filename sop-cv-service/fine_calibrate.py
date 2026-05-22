"""
fine_calibrate.py — Save multiple crop regions to visually find exact LCD position
"""
import cv2, numpy as np

CAM2_URL = "http://192.168.88.166:8080/video"
cap = cv2.VideoCapture(CAM2_URL)
cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
for _ in range(8): cap.read()
ret, frame = cap.read()
cap.release()
if not ret: print("No frame"); exit(1)

h, w = frame.shape[:2]
print(f"Frame: {w}x{h}")

# Save a downscaled version with grid overlay for reference
small = cv2.resize(frame, (960, 540))
# Draw grid every 100px at original scale (50px on small)
for gx in range(0, 960, 48):  # 48 = 100/2 scaled
    cv2.line(small, (gx, 0), (gx, 540), (100,100,100), 1)
    cv2.putText(small, str(gx*2), (gx+2, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.3, (200,200,200), 1)
for gy in range(0, 540, 48):
    cv2.line(small, (0, gy), (960, gy), (100,100,100), 1)
    cv2.putText(small, str(gy*2), (2, gy+12), cv2.FONT_HERSHEY_SIMPLEX, 0.3, (200,200,200), 1)
cv2.imwrite("grid_reference.jpg", small)

# Save multiple candidate crops
crops = {
    "center_display":  frame[60:350, 850:1180],   # center-right area
    "left_display":    frame[60:350, 600:900],     # left of buttons
    "upper_right":     frame[0:300, 900:1200],     # upper right
    "full_scale":      frame[0:500, 500:1300],     # full scale body
}
for name, crop in crops.items():
    if crop.size > 0:
        cv2.imwrite(f"crop_{name}.jpg", crop)
        print(f"Saved crop_{name}.jpg  shape={crop.shape[:2]}")

print("\nCheck these images and identify which one shows the LCD numbers.")
