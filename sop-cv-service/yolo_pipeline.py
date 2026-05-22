"""
yolo_pipeline.py — YOLOv8-pose Operator & Process Detection Pipeline
Detects: people count, second verifier, PPE, workstation occupancy, process activity.
Uses YOLOv8n-pose (auto-downloaded on first run via ultralytics).
"""

import cv2
import numpy as np
import time
from collections import deque
from typing import Optional
from ultralytics import YOLO

# ─── COCO class indices ────────────────────────────────────────────────────────
PERSON_CLASS_ID = 0
# Minimum confidence for object detection
OBJECT_CONF_THRESHOLD = 0.08   # low: moving objects are blurry — persistence filter handles false positives
OBJECT_CONF_STATIONARY = 0.12  # higher bar when object is still (less blur noise)

# COCO class IDs relevant to a pharmaceutical dispensing workstation
RELEVANT_OBJECTS = {
    39: 'bottle',       # reagent bottles, dispensing containers
    41: 'cup',          # beakers, metallic cups
    45: 'bowl',         # weighing bowls, dishes
    26: 'handbag',      # sample bags, zip-lock bags
    76: 'scissors',     # cutting tools, spatulas (sometimes misclassified)
    73: 'book',         # batch records, lab notebooks
    63: 'laptop',       # workstation computer
    67: 'cell phone',   # operator phone (deviation risk)
    75: 'vase',         # volumetric flasks
    64: 'mouse',        # PC peripherals at workstation
}

# YOLOv8-pose keypoint indices (COCO 17-keypoint format)
KP_LEFT_WRIST  = 9
KP_RIGHT_WRIST = 10

# Status colors (BGR)
COLOR_PASS = (0, 230, 130)
COLOR_FAIL = (30, 30, 240)
COLOR_WARN = (30, 200, 240)
COLOR_IDLE = (150, 150, 150)


class WristTracker:
    def __init__(self, history_frames: int = 15, idle_seconds: float = 2.0):
        self.history = deque(maxlen=history_frames)
        self.idle_seconds = idle_seconds
        self._last_movement_time = time.time()

    def update(self, left_wrist: Optional[tuple], right_wrist: Optional[tuple]):
        self.history.append({'left': left_wrist, 'right': right_wrist, 'time': time.time()})

    def get_velocity(self) -> float:
        if len(self.history) < 3:
            return 0.0
        velocities = []
        entries = list(self.history)
        for i in range(1, len(entries)):
            prev, curr = entries[i - 1], entries[i]
            for side in ['left', 'right']:
                if prev[side] and curr[side]:
                    dx = curr[side][0] - prev[side][0]
                    dy = curr[side][1] - prev[side][1]
                    velocities.append((dx**2 + dy**2) ** 0.5)
        return np.mean(velocities) if velocities else 0.0

    def is_idle(self) -> bool:
        vel = self.get_velocity()
        if vel > 5.0:
            self._last_movement_time = time.time()
        return (time.time() - self._last_movement_time) > self.idle_seconds

    def get_trajectory_direction(self) -> Optional[str]:
        if len(self.history) < 6:
            return None
        entries = list(self.history)[-6:]
        dy_values, dx_values = [], []
        for i in range(1, len(entries)):
            prev, curr = entries[i - 1], entries[i]
            for side in ['left', 'right']:
                if prev[side] and curr[side]:
                    dy_values.append(curr[side][1] - prev[side][1])
                    dx_values.append(abs(curr[side][0] - prev[side][0]))
        if not dy_values:
            return None
        avg_dy = np.mean(dy_values)
        avg_dx = np.mean(dx_values)
        if abs(avg_dy) > avg_dx:
            return 'down' if avg_dy > 3 else 'up'
        return 'lateral'


class YoloPipeline:
    def __init__(self, config: dict):
        self.config = config
        self.workstation_zone   = config.get('workstation_zone', {'x': 0, 'y': 0, 'w': 9999, 'h': 9999})
        self.scale_roi          = config.get('scale_roi', {'x': 400, 'y': 50, 'w': 400, 'h': 120})
        self.white_ratio_threshold = config.get('ppe_white_ratio_threshold', 0.55)   # raised: lab coats are dense white
        self.skin_ratio_threshold  = config.get('ppe_skin_ratio_threshold', 0.28)    # raised: unmasked face has more skin
        self.person_conf           = config.get('person_confidence_threshold', 0.20)

        # ── Tier 3: auto-verification hold counter ──────────────────────────────
        # Key: yolo_class_name → consecutive frames seen above threshold
        self._auto_verify_hold: dict[str, int] = {}
        self.auto_verify_conf_threshold = config.get('auto_verify_confidence_threshold', 0.45)
        self.auto_verify_hold_frames    = config.get('auto_verify_hold_frames', 5)

        self.wrist_tracker = WristTracker(
            history_frames=config.get('wrist_history_frames', 15),
            idle_seconds=config.get('wrist_idle_seconds', 2.0),
        )

        # ── Detection persistence (motion blur compensation) ─────────────────────
        # Stores {class_name: frames_since_last_seen} — keeps objects alive during blur
        self._obj_last_seen: dict[str, int]   = {}   # frames since last confident detection
        self._obj_best_conf: dict[str, float] = {}   # best confidence seen while alive
        self.obj_persistence = config.get('object_persistence_frames', 8)  # keep alive for N frames

        print("[YOLO] Loading YOLOv8n-pose model (person + keypoints)...")
        self.pose_model = YOLO('yolov8n-pose.pt')   # detects: person + keypoints
        print("[YOLO] Loading YOLOv8n detection model (objects)...")
        self.detect_model = YOLO('yolov8n.pt')       # detects: bottle, cup, bowl, etc.
        print("[YOLO] Both models loaded.")

        self._last_result = self._default_state()

    def _default_state(self) -> dict:
        return {
            'peopleCount': 0,
            'secondVerifier': False,
            'ppeStatus': 'UNKNOWN',
            'stationOccupied': False,
            'processActivity': 'UNKNOWN',
            'detectedObjects': [],
            'objectConfidences': {},   # NEW: class_name → best confidence this frame
        }

    def _boxes_overlap(self, box1: tuple, box2: dict) -> bool:
        x1, y1, x2, y2 = box1
        zx, zy = box2['x'], box2['y']
        zx2, zy2 = zx + box2['w'], zy + box2['h']
        return not (x2 < zx or x1 > zx2 or y2 < zy or y1 > zy2)

    def _check_lab_coat(self, frame: np.ndarray, bbox: tuple) -> bool:
        x1, y1, x2, y2 = bbox
        h = y2 - y1
        torso_y1 = y1 + int(h * 0.30)
        torso_y2 = y1 + int(h * 0.70)
        torso = frame[torso_y1:torso_y2, x1:x2]
        if torso.size == 0:
            return False
        hsv = cv2.cvtColor(torso, cv2.COLOR_BGR2HSV)
        white_mask = cv2.inRange(hsv, (0, 0, 180), (180, 60, 255))
        return np.count_nonzero(white_mask) / white_mask.size > self.white_ratio_threshold

    def _check_mask(self, frame: np.ndarray, bbox: tuple) -> bool:
        x1, y1, x2, y2 = bbox
        h = y2 - y1
        face_y2 = y1 + int(h * 0.30)
        face = frame[y1:face_y2, x1:x2]
        if face.size == 0:
            return False  # can't see face → assume no mask
        hsv = cv2.cvtColor(face, cv2.COLOR_BGR2HSV)
        skin1 = cv2.inRange(hsv, (0, 30, 60), (20, 150, 255))
        skin2 = cv2.inRange(hsv, (160, 30, 60), (180, 150, 255))
        skin_ratio = np.count_nonzero(cv2.bitwise_or(skin1, skin2)) / skin1.size
        # If skin ratio is too low, we can't see the face at all → treat as no mask (FAIL)
        if skin_ratio < 0.05:
            return False
        # Mask present = low skin ratio in face region
        return skin_ratio < self.skin_ratio_threshold

    def _infer_activity(self, wrist_l, wrist_r, detected_objects, current_weight, prev_weight) -> str:
        self.wrist_tracker.update(wrist_l, wrist_r)

        # If wrist keypoints unavailable (person only partially in frame),
        # fall back to IDLE rather than UNKNOWN
        if wrist_l is None and wrist_r is None:
            return 'IDLE'

        velocity  = self.wrist_tracker.get_velocity()
        direction = self.wrist_tracker.get_trajectory_direction()

        if self.wrist_tracker.is_idle():
            return 'IDLE'

        scale_z = self.scale_roi
        near_scale = any(
            wrist and scale_z['x'] <= wrist[0] <= scale_z['x'] + scale_z['w']
                    and scale_z['y'] <= wrist[1] <= scale_z['y'] + scale_z['h']
            for wrist in [wrist_l, wrist_r]
        )

        weight_changing = (
            current_weight is not None and prev_weight is not None
            and abs(current_weight - prev_weight) > 0.5
        )
        if near_scale and weight_changing:
            return 'WEIGHING'

        if direction == 'down' and velocity > 8 and any(o in detected_objects for o in ['bottle', 'bowl', 'cup', 'vase']):
            return 'POURING_LIKELY'

        if velocity > 3:
            return 'HANDLING_MATERIAL' if detected_objects else 'ACTIVE'

        if velocity > 0.5:
            return 'ACTIVE'

        return 'IDLE'

    # ── Tier 3: check if object held long enough for auto-verification ──────────
    def check_auto_verify(self, target_class: str, object_confidences: dict) -> Optional[float]:
        """
        Returns the confidence score if `target_class` has been detected
        above threshold for `auto_verify_hold_frames` consecutive frames.
        Returns None otherwise.
        """
        conf = object_confidences.get(target_class, 0.0)
        if conf >= self.auto_verify_conf_threshold:
            self._auto_verify_hold[target_class] = self._auto_verify_hold.get(target_class, 0) + 1
        else:
            self._auto_verify_hold[target_class] = 0

        if self._auto_verify_hold.get(target_class, 0) >= self.auto_verify_hold_frames:
            self._auto_verify_hold[target_class] = 0  # reset after firing
            return conf
        return None

    def reset_auto_verify(self, target_class: str):
        """Call after a step completes to reset the hold counter."""
        self._auto_verify_hold.pop(target_class, None)

    def process_frame(self, frame: np.ndarray, current_weight=None, prev_weight=None) -> tuple[dict, np.ndarray]:
        # pose model → person bboxes + keypoints
        pose_r   = self.pose_model(frame, verbose=False)[0]
        # detect model → bottle, cup, bowl
        detect_r = self.detect_model(frame, classes=list(RELEVANT_OBJECTS.keys()), verbose=False)[0]

        annotated = frame.copy()
        state     = self._default_state()
        detected_objects   = []
        object_confidences = {}
        ppe_results        = []
        person_bboxes      = []
        all_wrist_l, all_wrist_r = [], []

        # ── Object detections (with motion-blur persistence) ───────────────────
        fresh_detections: dict[str, float] = {}   # class_name → conf this frame

        for det in detect_r.boxes:
            cls_id = int(det.cls[0])
            conf   = float(det.conf[0])
            x1, y1, x2, y2 = map(int, det.xyxy[0])
            if cls_id in RELEVANT_OBJECTS and conf > OBJECT_CONF_THRESHOLD:
                obj_name = RELEVANT_OBJECTS[cls_id]
                fresh_detections[obj_name] = max(fresh_detections.get(obj_name, 0.0), conf)
                cv2.rectangle(annotated, (x1, y1), (x2, y2), COLOR_WARN, 2)
                cv2.putText(annotated, f"{obj_name} {conf:.0%}", (x1, y1 - 6),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, COLOR_WARN, 2)

        # Age all tracked objects (+1 frame since last seen)
        for name in list(self._obj_last_seen.keys()):
            self._obj_last_seen[name] += 1

        # Merge fresh detections — reset age & update best confidence
        for name, conf in fresh_detections.items():
            self._obj_last_seen[name] = 0
            self._obj_best_conf[name] = max(self._obj_best_conf.get(name, 0.0), conf)

        # Expire objects not seen for > persistence window
        for name in list(self._obj_last_seen.keys()):
            if self._obj_last_seen[name] > self.obj_persistence:
                del self._obj_last_seen[name]
                self._obj_best_conf.pop(name, None)

        # Final detected set = fresh + recently-seen (ghost detections during blur)
        for name, age in self._obj_last_seen.items():
            conf = self._obj_best_conf.get(name, 0.0)
            if name not in detected_objects:
                detected_objects.append(name)
            object_confidences[name] = conf
            # Draw ghost label (faded) for persisted-but-not-fresh detections
            if name not in fresh_detections:
                cv2.putText(annotated, f"{name} ~{conf:.0%} [held]", (10, 180),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45, (100, 180, 255), 1)

        # ── Person detections ──────────────────────────────────────────────────
        for det in pose_r.boxes:
            cls_id = int(det.cls[0])
            conf   = float(det.conf[0])
            x1, y1, x2, y2 = map(int, det.xyxy[0])
            if cls_id == PERSON_CLASS_ID and conf > self.person_conf:
                person_bboxes.append((x1, y1, x2, y2))

        state['peopleCount']       = len(person_bboxes)
        state['secondVerifier']    = len(person_bboxes) >= 2
        state['detectedObjects']   = detected_objects
        state['objectConfidences'] = object_confidences

        for i, bbox in enumerate(person_bboxes):
            x1, y1, x2, y2 = bbox
            if self._boxes_overlap(bbox, self.workstation_zone):
                state['stationOccupied'] = True

            has_coat = self._check_lab_coat(frame, bbox)
            has_mask = self._check_mask(frame, bbox)
            ppe_results.append(has_coat and has_mask)

            if pose_r.keypoints is not None and i < len(pose_r.keypoints):
                kps     = pose_r.keypoints.xy[i].cpu().numpy()
                kp_conf = pose_r.keypoints.conf[i].cpu().numpy() if pose_r.keypoints.conf is not None else None

                def get_kp(idx):
                    if kps[idx][0] > 0 and kps[idx][1] > 0:
                        if kp_conf is None or kp_conf[idx] > 0.3:
                            return (int(kps[idx][0]), int(kps[idx][1]))
                    return None

                wl = get_kp(KP_LEFT_WRIST)
                wr = get_kp(KP_RIGHT_WRIST)
                all_wrist_l.append(wl)
                all_wrist_r.append(wr)
                for kp in [wl, wr]:
                    if kp:
                        cv2.circle(annotated, kp, 5, (255, 100, 0), -1)

            color = COLOR_PASS if (has_coat and has_mask) else COLOR_FAIL
            label = f"P{i+1} {'coat✓' if has_coat else 'coat✗'} {'mask✓' if has_mask else 'mask✗'}"
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
            cv2.putText(annotated, label, (x1, y1 - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

        if not ppe_results:
            state['ppeStatus'] = 'UNKNOWN'
        elif all(ppe_results):
            state['ppeStatus'] = 'PASS'
        else:
            state['ppeStatus'] = 'FAIL'

        best_wl = next((w for w in all_wrist_l if w), None)
        best_wr = next((w for w in all_wrist_r if w), None)
        state['processActivity'] = self._infer_activity(
            best_wl, best_wr, detected_objects, current_weight, prev_weight
        )

        # Draw workstation zone
        wz = self.workstation_zone
        if wz['w'] < 9000:  # only draw if not full-frame
            wz_color = COLOR_PASS if state['stationOccupied'] else (60, 60, 60)
            cv2.rectangle(annotated, (wz['x'], wz['y']),
                          (wz['x'] + wz['w'], wz['y'] + wz['h']), wz_color, 1)

        self._draw_hud(annotated, state)
        self._last_result = state
        return state, annotated

    def _draw_hud(self, frame: np.ndarray, state: dict):
        lines = [
            f"People: {state['peopleCount']}",
            f"2nd: {'YES' if state['secondVerifier'] else 'NO'}",
            f"PPE: {state['ppeStatus']}",
            f"Station: {'OCC' if state['stationOccupied'] else 'EMPTY'}",
            f"Activity: {state['processActivity']}",
        ]
        for i, line in enumerate(lines):
            color = COLOR_PASS if any(ok in line for ok in ['YES', 'PASS', 'OCC']) else (
                COLOR_FAIL if any(bad in line for bad in ['NO', 'FAIL', 'EMPTY']) else COLOR_IDLE
            )
            cv2.putText(frame, line, (10, 22 + i * 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 3)
            cv2.putText(frame, line, (10, 22 + i * 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 1)
