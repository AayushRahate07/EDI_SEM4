import requests

try:
    print("--- CV SERVICE STATUS ---")
    r = requests.get("http://localhost:8001/status")
    print(f"Status: {r.status_code}")
    print(r.text)
except Exception as e:
    print(f"Error fetching CV status: {e}")
