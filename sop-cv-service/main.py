"""
main.py — SOP CV Service (Dual Camera)
Camera 1: laptop webcam (index 0)   → person, coat, mask, objects at body height
Camera 2: phone IP webcam (MJPEG)   → desk view, gloves, objects on surface, scale OCR
Results merged with OR logic for objects/activity. Both feeds streamed independently.

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

BACKEND        = 'http://localhost:3000'
FLASK_PORT     = CONFIG.get('flask_port', 8001)
YOLO_INTERVAL  = CONFIG.get('yolo_interval_ms', 500)  / 1000
OCR_INTERVAL   = CONFIG.get('ocr_interval_ms',  800)  / 1000
PUSH_INTERVAL  = CONFIG.get('push_interval_ms', 300)  / 1000
CAM_INDEX      = CONFIG.get('camera_index', 0)
IP_CAM_URL     = CONFIG.get('ip_camera_url', 'http://192.168.88.166:8080/video')
IP_CAM_ENABLED = CONFIG.get('ip_camera_enabled', True)

# ─── Shared state ──────────────────────────────────────────────────────────────
_lock           = threading.Lock()
_latest_frame1  = None   # annotated cam1 frame
_latest_frame2  = None   # annotated cam2 frame (YOLO overlay)
_latest_raw2    = None   # raw cam2 frame — updated at full speed for streaming
_yolo_state     = None   # merged YOLO result dict
_cam2_state     = None   # raw cam2 partial state (None if offline)
_ocr_weight     = None
_ocr_conf       = 0.0
_prev_weight    = None
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


def open_ip_camera(url: str, retries: int = 3) -> Optional[cv2.VideoCapture]:
    """Try opening the IP camera stream. Returns cap or None."""
    for attempt in range(retries):
        cap = cv2.VideoCapture(url)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)   # keep buffer minimal
        if cap.isOpened():
            ret, _ = cap.read()
            if ret:
                print(f"[CAM2] IP camera connected: {url}")
                return cap
        cap.release()
        print(f"[CAM2] Connection attempt {attempt+1}/{retries} failed, retrying...")
        time.sleep(2)
    print(f"[CAM2] Could not connect to {url} — running with cam1 only.")
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


# ─── Camera 1 worker (webcam) ──────────────────────────────────────────────────

def cam1_worker(cap: cv2.VideoCapture, pipeline: YoloPipeline):
    global _yolo_state, _latest_frame1, _prev_weight
    print("[CAM1] Worker started.")

    while True:
        ret, frame = cap.read()
        if not ret:
            time.sleep(0.1)
            continue

        with _lock:
            cw = _ocr_weight
            pw = _prev_weight
            c2 = _cam2_state

        # Process cam1
        cam1_state, annotated1 = pipeline.process_frame(frame, cw, pw)

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

def cam2_worker(pipeline: YoloPipeline, ocr_pipe: OcrPipeline):
    """
    Reads the latest cam2 snapshot (_latest_raw2) and runs YOLO + OCR.
    Runs at a slower cadence (1s) — display is handled by cam2_reader at full speed.
    """
    global _cam2_state, _latest_frame2, _ocr_weight, _ocr_conf, _prev_weight
    print("[CAM2] YOLO worker started (1s cadence).")

    while True:
        with _lock:
            frame = _latest_raw2

        if frame is None:
            time.sleep(0.1)
            continue

        # YOLO on desk frame
        desk_state, annotated2 = pipeline.process_desk_frame(frame)

        # OCR on desk frame
        weight, conf, _ = ocr_pipe.process_frame(frame)
        with _lock:
            if weight != _ocr_weight:
                _prev_weight = _ocr_weight
            _ocr_weight  = weight
            _ocr_conf    = conf
            _cam2_state   = desk_state
            _latest_frame2 = annotated2.copy()

        time.sleep(1.0)   # 1 fps for inference — display is independent


# ─── OCR worker (single camera mode fallback) ──────────────────────────────────

def ocr_worker_cam1(cap: cv2.VideoCapture, pipeline: OcrPipeline):
    """Used only when cam2 is offline — reads scale from cam1."""
    global _ocr_weight, _ocr_conf, _prev_weight
    print("[OCR] Fallback OCR worker (cam1) started.")
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


# ─── Push worker ───────────────────────────────────────────────────────────────

def push_worker():
    print("[PUSH] Push worker started.")
    while True:
        with _lock:
            ys = _yolo_state
            ow = _ocr_weight
            oc = _ocr_conf

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

        post_event('WEIGHT_UPDATE', {
            'currentWeight': ow,
            'initialWeight': None,
            'unit':          'g',
            'ocrConfidence': round(oc, 1),
        })

        time.sleep(PUSH_INTERVAL)


# ─── Flask ─────────────────────────────────────────────────────────────────────

app = Flask(__name__)


def _mjpeg_gen(frame_getter):
    while True:
        with _lock:
            frame = frame_getter()
        if frame is None:
            time.sleep(0.03)
            continue
        ret, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        if not ret:
            continue
        yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buf.tobytes() + b'\r\n')
        time.sleep(1 / 25)  # 25 fps cap


@app.route('/video_feed')
def video_feed():
    return Response(_mjpeg_gen(lambda: _latest_frame1),
                    mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/video_feed2')
def video_feed2():
    """Stream raw cam2 frames (no YOLO overlay) at full speed for low latency."""
    def raw_cam2_gen():
        while True:
            with _lock:
                frame = _latest_raw2  # raw frame — no inference blocking
            if frame is None:
                time.sleep(0.03)
                continue
            ret, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 65])
            if not ret:
                continue
            yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buf.tobytes() + b'\r\n')
            time.sleep(1 / 20)  # 20 fps
    return Response(raw_cam2_gen(), mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/status')
def status():
    with _lock:
        ys = _yolo_state
        ow = _ocr_weight
        oc = _ocr_conf
        c2 = _cam2_online
    return {
        'run_id':      _run_id,
        'yolo':        ys,
        'weight':      ow,
        'ocr_conf':    oc,
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
    print(f"  Cam2       : {IP_CAM_URL if IP_CAM_ENABLED else 'DISABLED'}")
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

    # Open Camera 2 (IP webcam — desk)
    cap2 = None
    if IP_CAM_ENABLED:
        cap2 = open_ip_camera(IP_CAM_URL)

    yolo_pipe = YoloPipeline(CONFIG)
    ocr_pipe  = OcrPipeline(CONFIG)

    # Prime cam1 frame
    ret, frame = cap1.read()
    if ret:
        global _latest_frame1
        _latest_frame1 = frame.copy()

    # Start workers
    threading.Thread(target=cam1_worker, args=(cap1, yolo_pipe), daemon=True).start()

    if cap2 is not None:
        # Reader thread: drains buffer at full speed (no inference)
        threading.Thread(target=cam2_reader, args=(cap2,), daemon=True).start()
        # YOLO inference thread: runs at 1s cadence on latest snapshot
        threading.Thread(target=cam2_worker, args=(yolo_pipe, ocr_pipe), daemon=True).start()
    else:
        # Fallback: OCR from cam1
        threading.Thread(target=ocr_worker_cam1, args=(cap1, ocr_pipe), daemon=True).start()

    threading.Thread(target=push_worker, daemon=True).start()

    import logging
    logging.getLogger('werkzeug').setLevel(logging.WARNING)
    app.run(host='0.0.0.0', port=FLASK_PORT, threaded=True)


if __name__ == '__main__':
    main()
