import requests, cv2, numpy as np

# Grab one frame from cam2 and check what colour ratios we're computing
cap = cv2.VideoCapture("http://192.168.88.166:8080/video")
cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
ret, frame = cap.read()
cap.release()

if not ret:
    print("Could not read cam2 frame")
    exit()

h, w = frame.shape[:2]
roi = frame[h // 2:, :]   # bottom half
hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)

skin1 = cv2.inRange(hsv, (0, 30, 60), (20, 150, 255))
skin2 = cv2.inRange(hsv, (160, 30, 60), (180, 150, 255))
skin_ratio = np.count_nonzero(cv2.bitwise_or(skin1, skin2)) / skin1.size

blue   = cv2.inRange(hsv, (100, 80, 60), (130, 255, 255))
purple = cv2.inRange(hsv, (130, 60, 60), (160, 255, 255))
green  = cv2.inRange(hsv, (40,  80, 60), (85,  255, 255))
colored_ratio = np.count_nonzero(cv2.bitwise_or(cv2.bitwise_or(blue, purple), green)) / skin1.size

print(f"Cam2 bottom-half analysis:")
print(f"  skin_ratio    = {skin_ratio:.4f}  (FAIL if >0.15)")
print(f"  colored_ratio = {colored_ratio:.4f}  (PASS if >0.12)")
print(f"  --> glove result = {'PASS' if colored_ratio>0.12 else 'FAIL' if skin_ratio>0.15 else 'UNKNOWN'}")

# Save annotated debug frame
debug = frame.copy()
cv2.rectangle(debug, (0, h//2), (w, h), (0, 165, 255), 2)
cv2.putText(debug, f"skin={skin_ratio:.3f} color={colored_ratio:.3f}", (10, h//2+30),
            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0,255,0), 2)
cv2.imwrite("cam2_glove_debug.jpg", debug)
print(f"\nSaved debug frame to cam2_glove_debug.jpg")
