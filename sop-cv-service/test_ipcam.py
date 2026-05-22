import requests, cv2, numpy as np, time

BASE = "http://192.168.88.166:8080"

# Test all known IP Webcam endpoints
endpoints = ["/", "/shot.jpg", "/video", "/videofeed", "/cam/1/stream"]
print("=== HTTP endpoint tests ===")
for ep in endpoints:
    try:
        r = requests.get(BASE + ep, timeout=4, stream=True)
        ct = r.headers.get("content-type", "?")
        print(f"OK   {ep:25s} status={r.status_code} type={ct[:50]}")
    except Exception as e:
        print(f"FAIL {ep:25s} {str(e)[:60]}")

# Test which URL OpenCV can open
print("\n=== OpenCV VideoCapture tests ===")
cv_urls = [
    BASE + "/video",
    BASE + "/videofeed",
    BASE + "/cam/1/stream",
    BASE + "/shot.jpg",  # JPEG snapshot mode
]
for url in cv_urls:
    print(f"Trying: {url}")
    cap = cv2.VideoCapture(url)
    opened = cap.isOpened()
    if opened:
        t0 = time.time()
        ret, frame = cap.read()
        elapsed = time.time() - t0
        print(f"  -> opened={opened}, read={ret}, shape={frame.shape if ret else 'N/A'}, time={elapsed:.2f}s")
        if ret:
            cv2.imwrite("ipcam_test_frame.jpg", frame)
            print(f"  -> Saved test frame to ipcam_test_frame.jpg")
    else:
        print(f"  -> FAILED to open")
    cap.release()
    if opened and ret:
        print(f"\nWORKING URL: {url}")
        break
