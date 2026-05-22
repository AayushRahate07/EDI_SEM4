"""
main.py — SOP CV Service (Dual Camera)
Camera 1: laptop webcam (index 0)  → person, coat, mask, gloves, objects, activity
Camera 2: USB webcam  (index 1)    → desk view, gloves, objects on surface, activity
Results merged with OR logic. Both feeds streamed independently at full webcam speed.

Usage:
    python main.py --run-id <uuid>
"""

import argparse
import json
import os
import threading
import time
from typing import Optional

import cv2
import requests
from flask import Flask, Response

from yolo_pipeline import YoloPipeline

# ─── Load config ───────────────────────────────────────────────────────────────
CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'config.json')
with open(CONFIG_PATH) as f:
    CONFIG = json.load(f)

BACKEND        = 'http://localhost:3000'
FLASK_PORT     = CONFIG.get('flask_port', 8001)
YOLO_INTERVAL  = CONFIG.get('yolo_interval_ms', 500)  / 1000
PUSH_INTERVAL  = CONFIG.get('push_interval_ms', 300)  / 1000
CAM_INDEX      = CONFIG.get('camera_index', 0)
CAM2_INDEX     = CONFIG.get('camera2_index', CONFIG.get('ip_camera_url', 1))
CAM2_ENABLED   = CONFIG.get('camera2_enabled', CONFIG.get('ip_camera_enabled', True))

# ─── Shared state ──────────────────────────────────────────────────────────────
_lock           = threading.Lock()
_latest_raw1    = None   # raw cam1 frame — updated at full webcam speed for streaming
_latest_frame1  = None   # annotated cam1 frame (YOLO overlay, updated at YOLO cadence)
_latest_raw2    = None   # raw cam2 frame — updated at full speed for streaming
_yolo_state     = None   # merged YOLO result dict
_cam2_state     = None   # raw cam2 partial state (None if offline)
_run_id: str    = ""
_cam2_online    = False


# ─── Helpers ───────────────────────────────────────────────────────────────────

def post_event(event_type: str, payload: dict):
    try:
        requests.post(
            f"{BACKEND}/runs/{_run_id}/events",
            json={'type': event_type, 'payload': payload},
            timeout=2,
        )
    except Exception as e:
        print(f"[CV] Event POST failed ({event_type}): {e}")


def get_current_step() -> Optional[dict]:
    try:
        r = requests.get(f"{BACKEND}/runs/{_run_id}/status", timeout=2)
        if r.ok:
            data = r.json()
            current_id = data.get('current_step')
            nodes = data.get('nodes', [])
            return next((n for n in nodes if n['id'] == current_id), None)
    except Exception:
        pass
    return None


def open_camera2(index_or_url, retries: int = 3) -> Optional[cv2.VideoCapture]:
    """Try opening Camera 2 (USB index or IP URL). Returns cap or None."""
    if isinstance(index_or_url, str) and index_or_url.isdigit():
        index_or_url = int(index_or_url)

    for attempt in range(retries):
        cap = cv2.VideoCapture(index_or_url)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)   # keep buffer minimal
        if isinstance(index_or_url, int):
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        if cap.isOpened():
            ret, _ = cap.read()
            if ret:
                print(f"[CAM2] Camera 2 connected: {index_or_url}")
                return cap
        cap.release()
        print(f"[CAM2] Connection attempt {attempt+1}/{retries} failed, retrying...")
        time.sleep(2)
    print(f"[CAM2] Could not connect to {index_or_url} — running with cam1 only.")
    return None


# ─── Camera 2 frame reader — runs at full speed, no inference ─────────────────

def cam2_reader(cap: cv2.VideoCapture):
    """Continuously drain the cam2 buffer so _latest_raw2 is always fresh."""
    global _latest_raw2, _cam2_online
    print("[CAM2] Frame reader started.")
    while True:
        if cap is None or not cap.isOpened():
            time.sleep(0.1)
            continue
        ret, frame = cap.read()
        if not ret:
            with _lock:
                _cam2_online = False
            time.sleep(0.05)
            continue
        with _lock:
            _latest_raw2  = frame
            _cam2_online  = True
        # No sleep — run as fast as possible to drain buffer


# ─── Camera 1 reader — runs at full webcam speed, no inference ───────────────

def cam1_reader(cap: cv2.VideoCapture):
    """Continuously read cam1 frames into _latest_raw1 for low-latency streaming."""
    global _latest_raw1
    print("[CAM1] Frame reader started (full-speed, no inference).")
    while True:
        ret, frame = cap.read()
        if not ret:
            time.sleep(0.02)
            continue
        with _lock:
            _latest_raw1 = frame


# ─── Camera 1 YOLO worker — inference at YOLO_INTERVAL cadence ───────────────

def cam1_worker(cap: cv2.VideoCapture, pipeline: YoloPipeline):
    global _yolo_state, _latest_frame1, _prev_weight
    print("[CAM1] Worker started.")

    while True:
        with _lock:
            frame = _latest_raw1
            c2 = _cam2_state

        if frame is None:
            time.sleep(0.05)
            continue

        # Process cam1 (no weight data — OCR removed)
        cam1_state, annotated1 = pipeline.process_frame(frame, None, None)

        # Merge with cam2
        merged = pipeline.merge_results(cam1_state, c2)

        # ── Tier 3: POST_HOC_VISION auto-verification ──────────────────────────
        current_node = get_current_step()
        if (
            current_node
            and current_node.get('type') == 'VERIFICATION'
            and current_node.get('config', {}).get('mode') == 'POST_HOC_VISION'
        ):
            target_class = current_node['config'].get('yolo_class_name', '').lower()
            if target_class:
                obj_confs = merged.get('objectConfidences', {})
                trigger_conf = pipeline.check_auto_verify(target_class, obj_confs)
                if trigger_conf is not None:
                    entity_name = current_node['config'].get('entity_name', target_class)
                    print(f"[YOLO] AUTO-VERIFY '{target_class}' @ {trigger_conf:.0%} — firing EXECUTE_STEP")
                    post_event('EXECUTE_STEP', {
                        'verified_entity': entity_name,
                        'success': True,
                        'confidence': round(trigger_conf, 3),
                        'source': 'POST_HOC_VISION',
                    })
                    pipeline.reset_auto_verify(target_class)

                hold_count = pipeline._auto_verify_hold.get(target_class, 0)
                hold_total = pipeline.auto_verify_hold_frames
                if hold_count > 0:
                    bar_w = int((hold_count / hold_total) * 200)
                    cv2.rectangle(annotated1, (10, annotated1.shape[0]-30), (210, annotated1.shape[0]-14), (30,30,30), -1)
                    cv2.rectangle(annotated1, (10, annotated1.shape[0]-30), (10+bar_w, annotated1.shape[0]-14), (0,200,100), -1)
                    cv2.putText(annotated1, f"AUTO-VERIFY {target_class}: {hold_count}/{hold_total}",
                                (10, annotated1.shape[0]-35), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0,200,100), 1)

        with _lock:
            _yolo_state    = merged
            _latest_frame1 = annotated1.copy()

        time.sleep(YOLO_INTERVAL)


# ─── Camera 2 worker — YOLO inference on latest snapshot ─────────────────────

def cam2_worker(pipeline: YoloPipeline):
    """
    Reads the latest cam2 snapshot (_latest_raw2) and runs YOLO.
    Runs at a slower cadence (1s) — display is handled by cam2_reader at full speed.
    """
    global _cam2_state
    print("[CAM2] YOLO worker started (1s cadence).")

    while True:
        with _lock:
            frame = _latest_raw2

        if frame is None:
            time.sleep(0.1)
            continue

        # YOLO on desk frame (no weight data — OCR removed)
        desk_state, _ = pipeline.process_desk_frame(frame, None, None)
        with _lock:
            _cam2_state = desk_state

        time.sleep(1.0)   # 1 fps for inference — display is independent


# ─── Push worker ───────────────────────────────────────────────────────────────

def push_worker():
    print("[PUSH] Push worker started.")
    while True:
        with _lock:
            ys = _yolo_state

        if ys:
            post_event('YOLO_UPDATE', {
                'peopleCount':     ys.get('peopleCount', 0),
                'secondVerifier':  ys.get('secondVerifier', False),
                'ppeStatus':       ys.get('ppeStatus', 'UNKNOWN'),
                'ppeGloves':       ys.get('ppeGloves', 'UNKNOWN'),
                'stationOccupied': ys.get('stationOccupied', False),
                'processActivity': ys.get('processActivity', 'UNKNOWN'),
                'detectedObjects': ys.get('detectedObjects', []),
                'cam2Online':      ys.get('cam2Online', False),
            })

        time.sleep(PUSH_INTERVAL)


# ─── Flask ─────────────────────────────────────────────────────────────────────

app = Flask(__name__)


def _draw_quick_hud(frame: 'cv2.Mat', state: dict) -> 'cv2.Mat':
    """
    Composite a lightweight status HUD onto a raw frame.
    Uses only cv2.putText — no inference, runs in microseconds.
    """
    if state is None:
        return frame
    out = frame.copy()
    lines = [
        (f"People : {state.get('peopleCount', '?')}",  state.get('peopleCount', 0) > 0),
        (f"PPE    : {state.get('ppeStatus', '?')}",     state.get('ppeStatus') == 'PASS'),
        (f"Gloves : {state.get('ppeGloves', '?')}",     state.get('ppeGloves') == 'PASS'),
        (f"Activity: {state.get('processActivity', '?')}", state.get('processActivity') not in ('IDLE', 'UNKNOWN', None)),
    ]
    for i, (text, good) in enumerate(lines):
        color = (0, 220, 100) if good else (200, 200, 200)
        cv2.putText(out, text, (10, 22 + i * 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 3)
        cv2.putText(out, text, (10, 22 + i * 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 1)
    return out


def _mjpeg_gen(raw_getter):
    """
    MJPEG generator — always streams the latest raw frame with a lightweight HUD.
    No inference on this path; runs at full webcam speed (~30fps).
    """
    import numpy as np
    while True:
        with _lock:
            frame = raw_getter()
            state = _yolo_state
        if frame is None:
            time.sleep(0.02)
            continue
        out = _draw_quick_hud(frame, state)
        ret, buf = cv2.imencode('.jpg', out, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ret:
            continue
        yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buf.tobytes() + b'\r\n')
        # No artificial sleep — let the network/browser throttle naturally


@app.route('/video_feed')
def video_feed():
    return Response(_mjpeg_gen(lambda: _latest_raw1),
                    mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/video_feed2')
def video_feed2():
    return Response(_mjpeg_gen(lambda: _latest_raw2),
                    mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/status')
def status():
    with _lock:
        ys = _yolo_state
        c2 = _cam2_online
    return {
        'run_id':      _run_id,
        'yolo':        ys,
        'cam2_online': c2,
    }


# ─── Entry point ───────────────────────────────────────────────────────────────

def main():
    global _run_id

    parser = argparse.ArgumentParser(description='SOP CV Service (Dual Camera)')
    parser.add_argument('--run-id', required=True, help='Active workflow run UUID')
    args = parser.parse_args()
    _run_id = args.run_id

    print("=" * 60)
    print("  SOP CV Service — DUAL CAMERA MODE")
    print(f"  Run ID     : {_run_id}")
    print(f"  Backend    : {BACKEND}")
    print(f"  Cam1       : webcam index {CAM_INDEX}")
    print(f"  Cam2       : {CAM2_INDEX if CAM2_ENABLED else 'DISABLED'}")
    print(f"  Stream1    : http://localhost:{FLASK_PORT}/video_feed")
    print(f"  Stream2    : http://localhost:{FLASK_PORT}/video_feed2")
    print("=" * 60)

    # Open Camera 1 (laptop webcam)
    print(f"[CAM1] Opening webcam index {CAM_INDEX}...")
    cap1 = cv2.VideoCapture(CAM_INDEX)
    if not cap1.isOpened():
        raise RuntimeError(f"Cannot open webcam index {CAM_INDEX}")
    cap1.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap1.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    w = cap1.get(cv2.CAP_PROP_FRAME_WIDTH)
    h = cap1.get(cv2.CAP_PROP_FRAME_HEIGHT)
    print(f"[CAM1] Opened. Resolution: {int(w)}x{int(h)}")

    # Open Camera 2 (USB webcam or IP URL)
    cap2 = None
    if CAM2_ENABLED:
        cap2 = open_camera2(CAM2_INDEX)

    yolo_pipe = YoloPipeline(CONFIG)

    # Prime cam1 frame
    ret, frame = cap1.read()
    if ret:
        global _latest_frame1
        _latest_frame1 = frame.copy()

    # Start workers
    # Cam1: reader at full webcam speed + YOLO inference at YOLO_INTERVAL cadence
    threading.Thread(target=cam1_reader, args=(cap1,), daemon=True).start()
    threading.Thread(target=cam1_worker, args=(cap1, yolo_pipe), daemon=True).start()

    if cap2 is not None:
        # Reader thread: drains buffer at full speed (no inference)
        threading.Thread(target=cam2_reader, args=(cap2,), daemon=True).start()
        # YOLO inference thread: 1s cadence on latest snapshot
        threading.Thread(target=cam2_worker, args=(yolo_pipe,), daemon=True).start()

    threading.Thread(target=push_worker, daemon=True).start()

    import logging
    logging.getLogger('werkzeug').setLevel(logging.WARNING)
    app.run(host='0.0.0.0', port=FLASK_PORT, threaded=True)


if __name__ == '__main__':
    main()
