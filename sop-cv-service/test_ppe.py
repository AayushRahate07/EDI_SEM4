import requests, time

print("Polling CV status every 2s. Stand WITHOUT mask/coat/gloves.\n")
for i in range(5):
    time.sleep(2)
    try:
        r = requests.get('http://localhost:8001/status', timeout=3).json()
        y = r.get('yolo', {})
        coat   = "PASS" if y.get('ppeCoat') else "FAIL"
        mask   = "PASS" if y.get('ppeMask') else "FAIL"
        gloves = y.get('ppeGloves', 'UNKNOWN')
        ppe    = y.get('ppeStatus', '?')
        people = y.get('peopleCount', 0)
        print(f"[{i+1}] Overall={ppe:8s}  coat={coat}  mask={mask}  gloves={gloves:8s}  people={people}")
    except Exception as e:
        print(f"[{i+1}] Error: {e}")
