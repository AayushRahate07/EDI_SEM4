"""
yolo_pipeline.py — Dual-Camera YOLO Pipeline
Camera 1 (webcam):  person, coat, mask, objects held at body, wrist tracking
Camera 2 (IP cam):  gloves on desk, objects on desk, scale OCR region
Object/activity detected on EITHER camera = detected (OR logic).
"""

import cv2
import numpy as np
import time
from collections import deque
from typing import Optional
from ultralytics import YOLO

# ─── COCO class indices ────────────────────────────────────────────────────────
PERSON_CLASS_ID = 0
BOTTLE_CLASS_ID = 39
CUP_CLASS_ID    = 41
BOWL_CLASS_ID   = 45

RELEVANT_OBJECTS = {
    BOTTLE_CLASS_ID: 'bottle',
    CUP_CLASS_ID:    'cup',
    BOWL_CLASS_ID:   'bowl',
}

OBJECT_CONF_THRESHOLD = 0.15

KP_LEFT_WRIST  = 9
KP_RIGHT_WRIST = 10

COLOR_PASS = (0, 230, 130)
COLOR_FAIL = (30, 30, 240)
COLOR_WARN = (30, 200, 240)
COLOR_IDLE = (150, 150, 150)
COLOR_CAM2 = (255, 165, 0)   # orange — desk camera annotations


class WristTracker:
    def __init__(self, history_frames: int = 15, idle_seconds: float = 2.0):
        self.history = deque(maxlen=history_frames)
        self.idle_seconds = idle_seconds
        self._last_movement_time = time.time()

    def update(self, left_wrist, right_wrist):
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
        self.workstation_zone      = config.get('workstation_zone', {'x': 0, 'y': 0, 'w': 9999, 'h': 9999})
        self.scale_roi             = config.get('scale_roi', {'x': 400, 'y': 50, 'w': 400, 'h': 120})
        self.white_ratio_threshold = config.get('ppe_white_ratio_threshold', 0.55)
        self.skin_ratio_threshold  = config.get('ppe_skin_ratio_threshold', 0.28)
        self.glove_skin_threshold  = config.get('glove_skin_ratio_threshold', 0.10)
        self.person_conf           = config.get('person_confidence_threshold', 0.20)

        self._auto_verify_hold: dict[str, int] = {}
        self.auto_verify_conf_threshold = config.get('auto_verify_confidence_threshold', 0.45)
        self.auto_verify_hold_frames    = config.get('auto_verify_hold_frames', 5)

        self.wrist_tracker = WristTracker(
            history_frames=config.get('wrist_history_frames', 15),
            idle_seconds=config.get('wrist_idle_seconds', 2.0),
        )

        print("[YOLO] Loading YOLOv8n-pose model (cam1: person + keypoints)...")
        self.pose_model   = YOLO('yolov8n-pose.pt')
        print("[YOLO] Loading YOLOv8n detect model (objects)...")
        self.detect_model = YOLO('yolov8n.pt')
        print("[YOLO] Both models loaded.")

        self._last_result = self._default_state()

    # ─── State ────────────────────────────────────────────────────────────────
    def _default_state(self) -> dict:
        return {
            'peopleCount':      0,
            'secondVerifier':   False,
            'ppeStatus':        'UNKNOWN',
            'ppeCoat':          False,
            'ppeMask':          False,
            'ppeGloves':        'UNKNOWN',   # from cam2
            'stationOccupied':  False,
            'processActivity':  'UNKNOWN',
            'detectedObjects':  [],
            'objectConfidences': {},
            'cam2Online':       False,
        }

    # ─── Helpers ──────────────────────────────────────────────────────────────
    def _boxes_overlap(self, box1: tuple, box2: dict) -> bool:
        x1, y1, x2, y2 = box1
        zx, zy = box2['x'], box2['y']
        zx2, zy2 = zx + box2['w'], zy + box2['h']
        return not (x2 < zx or x1 > zx2 or y2 < zy or y1 > zy2)

    def _check_lab_coat(self, frame: np.ndarray, bbox: tuple) -> bool:
        """Lab coats are optical white (V>210, S<35). Regular t-shirts are dimmer."""
        x1, y1, x2, y2 = bbox
        h = y2 - y1
        torso = frame[y1 + int(h * 0.20): y1 + int(h * 0.80), x1:x2]
        if torso.size == 0:
            return False
        hsv = cv2.cvtColor(torso, cv2.COLOR_BGR2HSV)
        # Optical white: V>210, S<35 — lab coat level brightness
        white_mask = cv2.inRange(hsv, (0, 0, 210), (180, 35, 255))
        return np.count_nonzero(white_mask) / white_mask.size > self.white_ratio_threshold

    def _check_mask(self, frame: np.ndarray, bbox: tuple,
                    nose_kp: Optional[tuple] = None, nose_conf: float = 0.0) -> bool:
        """
        Primary: nose keypoint clearly detected (conf>0.5) → face exposed → no mask.
        Fallback: skin-ratio check in face ROI.
        """
        if nose_kp is not None and nose_conf > 0.50:
            return False  # nose clearly visible → definitely no mask
        x1, y1, x2, y2 = bbox
        h = y2 - y1
        face = frame[y1: y1 + int(h * 0.30), x1:x2]
        if face.size == 0:
            return False
        hsv = cv2.cvtColor(face, cv2.COLOR_BGR2HSV)
        skin1 = cv2.inRange(hsv, (0, 30, 60), (20, 150, 255))
        skin2 = cv2.inRange(hsv, (160, 30, 60), (180, 150, 255))
        skin_ratio = np.count_nonzero(cv2.bitwise_or(skin1, skin2)) / skin1.size
        if skin_ratio < 0.05:
            return False
        return skin_ratio < self.skin_ratio_threshold

    def _check_gloves_in_region(self, frame: np.ndarray) -> str:
        """
        Scan desk-camera frame for gloves.
        PASS    = hands visible AND covered by glove colour.
        FAIL    = hands visible AND bare skin exposed.
        UNKNOWN = hands not in frame (can't make determination).
        """
        if frame is None or frame.size == 0:
            return 'UNKNOWN'

        h, w = frame.shape[:2]
        roi = frame[h // 2:, :]   # lower half — where hands usually are
        if roi.size == 0:
            return 'UNKNOWN'

        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)

        # Skin tone detection — hands must be in frame to make any determination
        skin1 = cv2.inRange(hsv, (0, 40, 80), (20, 170, 255))
        skin2 = cv2.inRange(hsv, (160, 40, 80), (180, 170, 255))
        skin_mask = cv2.bitwise_or(skin1, skin2)
        skin_ratio = np.count_nonzero(skin_mask) / skin1.size

        # If very little skin visible → hands not in frame → can't judge gloves
        if skin_ratio < 0.03:
            return 'UNKNOWN'

        # Glove colours — strict saturation to avoid ambient lighting artefacts
        # NOTE: green hue narrowed to 70-85 to avoid scale LCD green (hue ~60)
        blue_gloves   = cv2.inRange(hsv, (100, 90, 60), (130, 255, 255))   # nitrile blue
        purple_gloves = cv2.inRange(hsv, (130, 70, 60), (160, 255, 255))   # purple nitrile
        green_gloves  = cv2.inRange(hsv, (70,  90, 60), (85,  255, 255))   # green latex (NOT scale green)

        colored_ratio = np.count_nonzero(
            cv2.bitwise_or(cv2.bitwise_or(blue_gloves, purple_gloves), green_gloves)
        ) / skin1.size

        # Gloves detected: skin visible AND significantly covered with glove colour
        if colored_ratio > 0.20 and skin_ratio > 0.03:
            return 'PASS'
        # Bare hands clearly visible
        if skin_ratio > 0.08:
            return 'FAIL'
        return 'UNKNOWN'

    def _infer_activity(self, wrist_l, wrist_r, detected_objects, current_weight, prev_weight) -> str:
        self.wrist_tracker.update(wrist_l, wrist_r)
        velocity  = self.wrist_tracker.get_velocity()
        direction = self.wrist_tracker.get_trajectory_direction()

        if self.wrist_tracker.is_idle():
            return 'IDLE'

        scale_z   = self.scale_roi
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
        if direction == 'down' and velocity > 8 and any(o in detected_objects for o in ['bottle', 'bowl', 'cup']):
            return 'POURING_LIKELY'
        if velocity > 3:
            return 'HANDLING_MATERIAL' if detected_objects else 'ACTIVE'
        return 'UNKNOWN'

    # ─── Camera 1: body / face / objects held ─────────────────────────────────
    def process_frame(self, frame: np.ndarray, current_weight=None, prev_weight=None) -> tuple[dict, np.ndarray]:
        pose_r   = self.pose_model(frame, verbose=False)[0]
        detect_r = self.detect_model(frame, classes=list(RELEVANT_OBJECTS.keys()), verbose=False)[0]

        annotated          = frame.copy()
        state              = self._default_state()
        detected_objects   = []
        object_confidences = {}
        ppe_results        = []
        person_bboxes      = []
        all_wrist_l, all_wrist_r = [], []

        # Objects from cam1
        for det in detect_r.boxes:
            cls_id = int(det.cls[0])
            conf   = float(det.conf[0])
            x1, y1, x2, y2 = map(int, det.xyxy[0])
            if cls_id in RELEVANT_OBJECTS and conf > OBJECT_CONF_THRESHOLD:
                obj_name = RELEVANT_OBJECTS[cls_id]
                if obj_name not in detected_objects:
                    detected_objects.append(obj_name)
                object_confidences[obj_name] = max(object_confidences.get(obj_name, 0.0), conf)
                cv2.rectangle(annotated, (x1, y1), (x2, y2), COLOR_WARN, 2)
                cv2.putText(annotated, f"{obj_name} {conf:.0%}", (x1, y1 - 6),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, COLOR_WARN, 2)

        # Persons from cam1
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

            # Mask check — pass nose keypoint for more reliable detection
            nose_kp, nose_conf = None, 0.0
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

                # Nose is keypoint index 0
                if kps[0][0] > 0 and kps[0][1] > 0:
                    nose_kp   = (int(kps[0][0]), int(kps[0][1]))
                    nose_conf = float(kp_conf[0]) if kp_conf is not None else 0.0

            has_mask = self._check_mask(frame, bbox, nose_kp, nose_conf)
            ppe_results.append((has_coat, has_mask))

            color = COLOR_PASS if (has_coat and has_mask) else COLOR_FAIL
            label = f"P{i+1} {'coat✓' if has_coat else 'coat✗'} {'mask✓' if has_mask else 'mask✗'}"
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
            cv2.putText(annotated, label, (x1, y1 - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

        # PPE coat+mask from cam1 (gloves merged later in process_dual)
        if ppe_results:
            state['ppeCoat'] = all(r[0] for r in ppe_results)
            state['ppeMask'] = all(r[1] for r in ppe_results)
        else:
            state['ppeCoat'] = False
            state['ppeMask'] = False

        # ppeStatus set provisionally (gloves unknown until cam2 merges)
        state['ppeStatus'] = 'UNKNOWN'

        best_wl = next((w for w in all_wrist_l if w), None)
        best_wr = next((w for w in all_wrist_r if w), None)
        state['processActivity'] = self._infer_activity(
            best_wl, best_wr, detected_objects, current_weight, prev_weight
        )

        wz = self.workstation_zone
        if wz['w'] < 9000:
            wz_color = COLOR_PASS if state['stationOccupied'] else (60, 60, 60)
            cv2.rectangle(annotated, (wz['x'], wz['y']),
                          (wz['x'] + wz['w'], wz['y'] + wz['h']), wz_color, 1)

        # Add CAM1 label
        cv2.putText(annotated, "CAM1: OPERATOR", (10, annotated.shape[0] - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180, 180, 180), 1)

        self._last_result = state
        return state, annotated

    # ─── Camera 2: desk / gloves / objects on surface ─────────────────────────
    def process_desk_frame(self, frame: np.ndarray, current_weight=None, prev_weight=None) -> tuple[dict, np.ndarray]:
        """
        Process a desk-camera frame (Camera 2).
        Returns a partial state dict + annotated frame.
        Detects: objects on desk, gloves, hand activity on desk.
        """
        annotated          = frame.copy()
        detected_objects   = []
        object_confidences = {}

        # Object detection on desk
        detect_r = self.detect_model(frame, classes=list(RELEVANT_OBJECTS.keys()), verbose=False)[0]
        for det in detect_r.boxes:
            cls_id = int(det.cls[0])
            conf   = float(det.conf[0])
            x1, y1, x2, y2 = map(int, det.xyxy[0])
            if cls_id in RELEVANT_OBJECTS and conf > OBJECT_CONF_THRESHOLD:
                obj_name = RELEVANT_OBJECTS[cls_id]
                if obj_name not in detected_objects:
                    detected_objects.append(obj_name)
                object_confidences[obj_name] = max(object_confidences.get(obj_name, 0.0), conf)
                cv2.rectangle(annotated, (x1, y1), (x2, y2), COLOR_CAM2, 2)
                cv2.putText(annotated, f"{obj_name} {conf:.0%}", (x1, y1 - 6),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, COLOR_CAM2, 2)

        # Glove detection
        glove_status = self._check_gloves_in_region(frame)
        glove_color  = COLOR_PASS if glove_status == 'PASS' else (COLOR_FAIL if glove_status == 'FAIL' else COLOR_IDLE)
        cv2.putText(annotated, f"Gloves: {glove_status}", (10, 22),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 3)
        cv2.putText(annotated, f"Gloves: {glove_status}", (10, 22),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, glove_color, 1)

        # Station occupied (any person visible on desk cam)
        pose_r = self.pose_model(frame, verbose=False)[0]
        desk_people = sum(
            1 for det in pose_r.boxes
            if int(det.cls[0]) == PERSON_CLASS_ID and float(det.conf[0]) > self.person_conf
        )
        station_occupied = desk_people > 0

        cv2.putText(annotated, "CAM2: DESK", (10, annotated.shape[0] - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 165, 0), 1)

        return {
            'detectedObjects':   detected_objects,
            'objectConfidences': object_confidences,
            'ppeGloves':         glove_status,
            'stationOccupied':   station_occupied,
        }, annotated

    # ─── Merge cam1 + cam2 results ────────────────────────────────────────────
    def merge_results(self, state1: dict, state2: Optional[dict]) -> dict:
        """
        Merge Camera 1 (operator) and Camera 2 (desk) states.
        OR logic: object/station detected on either camera = detected.
        """
        merged = dict(state1)

        if state2 is None:
            # cam2 offline — gloves unknown, use cam1 data only
            merged['ppeGloves'] = 'UNKNOWN'
            merged['cam2Online'] = False
            # PPE: coat + mask only (no glove requirement)
            if state1['ppeCoat'] and state1['ppeMask']:
                merged['ppeStatus'] = 'PASS'
            elif state1['peopleCount'] > 0:
                merged['ppeStatus'] = 'FAIL'
            else:
                merged['ppeStatus'] = 'UNKNOWN'
            return merged

        merged['cam2Online'] = True

        # Objects: union from both cameras
        obj_union = list(state1.get('detectedObjects', []))
        for obj in state2.get('detectedObjects', []):
            if obj not in obj_union:
                obj_union.append(obj)
        merged['detectedObjects'] = obj_union

        # Confidences: take max per class
        confs = dict(state1.get('objectConfidences', {}))
        for cls, conf in state2.get('objectConfidences', {}).items():
            confs[cls] = max(confs.get(cls, 0.0), conf)
        merged['objectConfidences'] = confs

        # Gloves from cam2
        merged['ppeGloves'] = state2.get('ppeGloves', 'UNKNOWN')

        # Station: occupied if either camera sees activity
        merged['stationOccupied'] = state1.get('stationOccupied', False) or state2.get('stationOccupied', False)

        # PPE: coat (cam1) + mask (cam1) + gloves (cam2)
        has_coat   = state1.get('ppeCoat', False)
        has_mask   = state1.get('ppeMask', False)
        gloves     = state2.get('ppeGloves', 'UNKNOWN')

        if state1['peopleCount'] == 0:
            merged['ppeStatus'] = 'UNKNOWN'
        elif has_coat and has_mask and gloves == 'PASS':
            merged['ppeStatus'] = 'PASS'
        elif gloves == 'UNKNOWN':
            # Can't confirm gloves — partial pass (coat+mask OK)
            merged['ppeStatus'] = 'PASS' if (has_coat and has_mask) else 'FAIL'
        else:
            merged['ppeStatus'] = 'FAIL'

        return merged

    # ─── Tier 3: auto-verify ──────────────────────────────────────────────────
    def check_auto_verify(self, target_class: str, object_confidences: dict) -> Optional[float]:
        conf = object_confidences.get(target_class, 0.0)
        if conf >= self.auto_verify_conf_threshold:
            self._auto_verify_hold[target_class] = self._auto_verify_hold.get(target_class, 0) + 1
        else:
            self._auto_verify_hold[target_class] = 0
        if self._auto_verify_hold.get(target_class, 0) >= self.auto_verify_hold_frames:
            self._auto_verify_hold[target_class] = 0
            return conf
        return None

    def reset_auto_verify(self, target_class: str):
        self._auto_verify_hold.pop(target_class, None)

    def _draw_hud(self, frame: np.ndarray, state: dict):
        gloves = state.get('ppeGloves', 'UNKNOWN')
        lines = [
            f"People: {state['peopleCount']}",
            f"PPE: {state['ppeStatus']}",
            f"Gloves: {gloves}",
            f"Activity: {state['processActivity']}",
        ]
        for i, line in enumerate(lines):
            color = COLOR_PASS if any(ok in line for ok in ['YES', 'PASS', 'OCC']) else (
                COLOR_FAIL if any(bad in line for bad in ['NO', 'FAIL', 'EMPTY']) else COLOR_IDLE
            )
            cv2.putText(frame, line, (10, 22 + i * 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 3)
            cv2.putText(frame, line, (10, 22 + i * 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 1)
