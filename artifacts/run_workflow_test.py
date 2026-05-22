import requests
import time

BACKEND = 'http://localhost:3000'
SOP_ID = 'SOP-sop-run-1779478288632'

print("1. Starting run...")
r = requests.post(f"{BACKEND}/runs", json={"sopId": SOP_ID})
print(r.text)
run_id = r.json()['run_id']

print(f"\nCreated Run ID: {run_id}")

print("\n2. Executing step 1 (Verification of Salt)...")
time.sleep(1.0)
r = requests.post(f"{BACKEND}/runs/{run_id}/events", json={
    "type": "EXECUTE_STEP",
    "payload": {
        "verified_entity": "Salt",
        "success": True
    }
})
print(r.text)

print("\n3. Executing step 2 (Measurement target 10, value 10)...")
time.sleep(1.5)
r = requests.post(f"{BACKEND}/runs/{run_id}/events", json={
    "type": "EXECUTE_STEP",
    "payload": {
        "delta": 10.0,
        "value": 10.0,
        "initial_weight": 0.0,
        "final_weight": 10.0
    }
})
print(r.text)

print("\n4. Executing step 3 (Measurement target 10, value 10)...")
time.sleep(1.5)
r = requests.post(f"{BACKEND}/runs/{run_id}/events", json={
    "type": "EXECUTE_STEP",
    "payload": {
        "delta": 10.0,
        "value": 20.0,
        "initial_weight": 10.0,
        "final_weight": 20.0
    }
})
print(r.text)

print("\n5. Fetching report...")
r = requests.get(f"{BACKEND}/runs/{run_id}/report")
print(r.text)
