"""
main.py — SOP CV Service Entry Point
Runs the YOLO pose pipeline + scale OCR pipeline in parallel threads.
Pushes sensor state to sop-engine and handles POST_HOC_VISION auto-verification.

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

from ocr_pipeline import OcrPipeline
from yolo_pipeline import YoloPipeline

# ─── Load config ───────────────────────────────────────────────────────────────
CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'config.json')
with open(CONFIG_PATH) as f:
    CONFIG = json.load(f)

BACKEND = 'http://localhost:3000'
FLASK_PORT = CONFIG.get('flask_port', 8001)
YOLO_INTERVAL  = CONFIG.get('yolo_interval_ms', 500)  / 1000
OCR_INTERVAL   = CONFIG.get('ocr_interval_ms',  800)  / 1000
PUSH_INTERVAL  = CONFIG.get('push_interval_ms', 300)  / 1000
CAM_INDEX      = CONFIG.get('camera_index', 0)

# ─── Shared state (written by worker threads, read by Flask MJPEG streamer) ───
_lock          = threading.Lock()
_latest_frame  = None        # annotated BGR frame for MJPEG
_yolo_state    = None        # latest YOLO result dict
_ocr_weight    = None        # latest OCR weight (float | None)
_ocr_conf      = 0.0         # latest OCR confidence %
_prev_weight   = None        # previous OCR weight (for delta / activity detection)
_run_id: str   = ""


# ─── Helpers ───────────────────────────────────────────────────────────────────

def post_event(event_type: str, payload: dict):
    """Fire and forget POST to sop-engine event endpoint."""
    if not _run_id:
        return
    try:
        requests.post(
            f"{BACKEND}/runs/{_run_id}/events",
            json={'type': event_type, 'payload': payload},
            timeout=2,
        )
    except Exception:
        pass


def get_current_step() -> Optional[dict]:
    """
    Fetch current run status and return the active node dict, or None.
    Returns: { id, type, config: { mode, entity_name, yolo_class_name, ... } }
    """
    if not _run_id:
        return None
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


def active_run_poller():
    global _run_id
    print("[CV] Active run poller thread started.")
    while True:
        try:
            r = requests.get(f"{BACKEND}/runs/active", timeout=2)
            if r.ok:
                active_id = r.json().get('run_id')
                if active_id and active_id != _run_id:
                    print(f"[CV] Auto-attached/Switched to active run: {active_id}")
                    _run_id = active_id
            else:
                if _run_id != "":
                    print("[CV] No active run detected. Standing by...")
                    _run_id = ""
        except Exception:
            pass
        time.sleep(2.0)


# ─── YOLO worker thread ────────────────────────────────────────────────────────

def yolo_worker(cap: cv2.VideoCapture, pipeline: YoloPipeline):
    global _yolo_state, _latest_frame, _prev_weight
    print("[YOLO] Worker started.")

    while True:
        ret, frame = cap.read()
        if not ret:
            time.sleep(0.1)
            continue

        with _lock:
            cw = _ocr_weight
            pw = _prev_weight

        yolo_result, annotated = pipeline.process_frame(frame, cw, pw)

        # ── Tier 3: POST_HOC_VISION auto-verification ──────────────────────────
        current_node = get_current_step()
        if (
            current_node
            and current_node.get('type') == 'VERIFICATION'
            and current_node.get('config', {}).get('mode') == 'POST_HOC_VISION'
        ):
            target_class = current_node['config'].get('yolo_class_name', '').lower()
            if target_class:
                obj_confs = yolo_result.get('objectConfidences', {})
                trigger_conf = pipeline.check_auto_verify(target_class, obj_confs)

                if trigger_conf is not None:
                    entity_name = current_node['config'].get('entity_name', target_class)
                    print(f"[YOLO] AUTO-VERIFY: '{target_class}' detected at {trigger_conf:.0%} — firing EXECUTE_STEP")
                    post_event('EXECUTE_STEP', {
                        'verified_entity': entity_name,
                        'success': True,
                        'confidence': round(trigger_conf, 3),
                        'source': 'POST_HOC_VISION',
                    })
                    pipeline.reset_auto_verify(target_class)

                # Draw auto-verify progress bar on frame
                hold_count = pipeline._auto_verify_hold.get(target_class, 0)
                hold_total = pipeline.auto_verify_hold_frames
                if hold_count > 0:
                    bar_w = int((hold_count / hold_total) * 200)
                    cv2.rectangle(annotated, (10, annotated.shape[0]-30), (210, annotated.shape[0]-14), (30,30,30), -1)
                    cv2.rectangle(annotated, (10, annotated.shape[0]-30), (10+bar_w, annotated.shape[0]-14), (0,200,100), -1)
                    cv2.putText(annotated, f"AUTO-VERIFY {target_class}: {hold_count}/{hold_total}",
                                (10, annotated.shape[0]-35), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0,200,100), 1)

        with _lock:
            _yolo_state   = yolo_result
            _latest_frame = annotated.copy()

        time.sleep(YOLO_INTERVAL)


# ─── OCR worker thread ─────────────────────────────────────────────────────────

def ocr_worker(cap: cv2.VideoCapture, pipeline: OcrPipeline):
    global _ocr_weight, _ocr_conf, _prev_weight
    print("[OCR] Worker started.")

    while True:
        ret, frame = cap.read()
        if not ret:
            time.sleep(0.1)
            continue

        weight, conf, _ = pipeline.process_frame(frame)

        with _lock:
            if weight != _ocr_weight:
                _prev_weight = _ocr_weight
            _ocr_weight = weight
            _ocr_conf   = conf

        time.sleep(OCR_INTERVAL)


# ─── Push worker thread ────────────────────────────────────────────────────────

def push_worker():
    """Pushes YOLO_UPDATE and WEIGHT_UPDATE events to sop-engine at regular intervals."""
    print("[PUSH] Push worker started.")
    while True:
        with _lock:
            ys = _yolo_state
            ow = _ocr_weight
            oc = _ocr_conf

        if ys:
            post_event('YOLO_UPDATE', {
                'peopleCount':    ys.get('peopleCount', 0),
                'secondVerifier': ys.get('secondVerifier', False),
                'ppeStatus':      ys.get('ppeStatus', 'UNKNOWN'),
                'stationOccupied': ys.get('stationOccupied', False),
                'processActivity': ys.get('processActivity', 'UNKNOWN'),
                'detectedObjects': ys.get('detectedObjects', []),
            })

        post_event('WEIGHT_UPDATE', {
            'currentWeight': ow,
            'initialWeight': None,
            'unit':          'g',
            'ocrConfidence': round(oc, 1),
        })

        time.sleep(PUSH_INTERVAL)


# ─── Flask MJPEG stream ────────────────────────────────────────────────────────

app = Flask(__name__)

def generate_frames():
    while True:
        with _lock:
            frame = _latest_frame
        if frame is None:
            time.sleep(0.05)
            continue
        ret, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ret:
            continue
        yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buf.tobytes() + b'\r\n')
        time.sleep(1 / 25)  # ~25 fps

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/status')
def status():
    with _lock:
        ys = _yolo_state
        ow = _ocr_weight
        oc = _ocr_conf
    return {
        'run_id':    _run_id,
        'yolo':      ys,
        'weight':    ow,
        'ocr_conf':  oc,
    }


# ─── Entry point ───────────────────────────────────────────────────────────────

def main():
    global _run_id

    parser = argparse.ArgumentParser(description='SOP CV Service')
    parser.add_argument('--run-id', required=False, default=None,
                        help='Active workflow run UUID (omit to auto-attach to latest active run)')
    args = parser.parse_args()

    if args.run_id:
        _run_id = args.run_id
        print(f"[CV] Initial Run ID: {_run_id}")

    print("[CV] Starting active run poller...")
    threading.Thread(target=active_run_poller, daemon=True).start()

    print("=" * 60)
    print("  SOP CV Service")
    print(f"  Backend    : {BACKEND}")
    print(f"  Camera     : {CAM_INDEX}")
    print(f"  Stream     : http://localhost:{FLASK_PORT}/video_feed")
    print("=" * 60)

    # Open camera
    print(f"[CV] Opening camera index {CAM_INDEX}...")
    cap = cv2.VideoCapture(CAM_INDEX)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open camera index {CAM_INDEX}")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    w = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
    h = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
    print(f"[CV] Camera opened. Resolution: {int(w)}x{int(h)}")

    yolo_pipe = YoloPipeline(CONFIG)
    ocr_pipe  = OcrPipeline(CONFIG)

    # Prime _latest_frame with one blank frame so stream doesn't hang
    ret, frame = cap.read()
    if ret:
        global _latest_frame
        _latest_frame = frame.copy()

    # Start worker threads
    threading.Thread(target=yolo_worker, args=(cap, yolo_pipe), daemon=True).start()
    threading.Thread(target=ocr_worker,  args=(cap, ocr_pipe),  daemon=True).start()
    threading.Thread(target=push_worker,                         daemon=True).start()

    # Start Flask (blocking)
    import logging
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.WARNING)
    app.run(host='0.0.0.0', port=FLASK_PORT, threaded=True)


if __name__ == '__main__':
    main()
