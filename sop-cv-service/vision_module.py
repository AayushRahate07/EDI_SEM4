"""
vision_module.py — YOLO Vision Module
======================================
Provides `get_frame_status(frame, model)` which analyses a single BGR frame
and returns a JSON-serialisable event dict containing:

  {
    "event_type": "YOLO_FRAME_STATUS",
    "timestamp": "<ISO-8601>",
    "person_count": <int>,
    "gowning": {
      "status": "PASS" | "FAIL" | "UNKNOWN",
      "per_person": [
        {"person_id": 1, "lab_coat": true, "mask": true, "compliant": true},
        ...
      ]
    },
    "second_verifier": <bool>,
    "station_occupied": <bool>,
    "process_activity": "IDLE" | "ACTIVE" | "HANDLING_MATERIAL" | ...,
    "detected_objects": ["bottle", ...],
    "raw_yolo_state": { ... }   # full internal state dict from YoloPipeline
  }

Drop-in usage
-------------
  from vision_module import build_pipeline, get_frame_status
  import cv2, json

  model = build_pipeline()          # load once at startup
  cap   = cv2.VideoCapture(0)

  while True:
      ret, frame = cap.read()
      if not ret: break
      event = get_frame_status(frame, model)
      print(json.dumps(event, indent=2))

Integration with sop-engine
----------------------------
The returned dict maps directly to the YOLO_UPDATE event expected by
`workflow.compiler.ts`.  Send it to the engine like this:

  import requests
  requests.post(
      f"http://localhost:3000/runs/{run_id}/events",
      json={"type": "YOLO_UPDATE", "payload": event},
  )

For POST_HOC_VISION auto-verification, `gowning.status == "PASS"` can be
used as the trigger condition — or pass `raw_yolo_state` directly to the
existing YoloPipeline.check_auto_verify() method in main.py.

Model argument
--------------
`model` is the YoloPipeline instance returned by `build_pipeline()`.
You can also construct it yourself:

  from yolo_pipeline import YoloPipeline
  import json, os
  cfg = json.load(open(os.path.join(os.path.dirname(__file__), "config.json")))
  model = YoloPipeline(cfg)
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Optional

import numpy as np

# ---------------------------------------------------------------------------
# Lazy import guard — ultralytics / cv2 are heavy; fail gracefully at import
# so unit-tests can mock the pipeline without a GPU.
# ---------------------------------------------------------------------------
try:
    from yolo_pipeline import YoloPipeline as _YoloPipeline
except ImportError as _err:  # pragma: no cover
    _YoloPipeline = None  # type: ignore
    _IMPORT_ERR = _err
else:
    _IMPORT_ERR = None

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def build_pipeline(config_path: str = _CONFIG_PATH) -> "_YoloPipeline":
    """
    Load config.json, initialise YoloPipeline, and return it.

    This is the recommended way to create the `model` object once at startup:

        model = build_pipeline()   # downloads/loads .pt weights once

    Parameters
    ----------
    config_path : path to config.json (default: same directory as this file)

    Returns
    -------
    YoloPipeline instance ready to be passed to get_frame_status()
    """
    if _YoloPipeline is None:
        raise ImportError(
            "YoloPipeline could not be imported. "
            "Make sure ultralytics and opencv-python are installed."
        ) from _IMPORT_ERR

    with open(config_path) as fh:
        cfg = json.load(fh)

    return _YoloPipeline(cfg)


def get_frame_status(
    frame: np.ndarray,
    model: "_YoloPipeline",
    current_weight: Optional[float] = None,
    prev_weight: Optional[float] = None,
) -> dict[str, Any]:
    """
    Analyse one BGR frame and return a structured compliance event.

    Parameters
    ----------
    frame          : BGR numpy array from cv2.VideoCapture.read()
    model          : YoloPipeline instance (created once via build_pipeline())
    current_weight : latest scale reading in grams, forwarded to activity inference
    prev_weight    : previous scale reading, used to detect weight delta

    Returns
    -------
    JSON-serialisable dict — see module docstring for full schema.

    The returned dict is intentionally a *superset* of the YOLO_UPDATE payload
    consumed by workflow.compiler.ts so it can be sent directly as an event
    payload without any transformation.

    Example
    -------
    >>> event = get_frame_status(frame, model)
    >>> event["gowning"]["status"]
    'PASS'
    >>> event["person_count"]
    2
    """
    if frame is None or frame.size == 0:
        return _empty_event("frame is None or empty")

    # ── Run the YOLO pipeline ─────────────────────────────────────────────────
    yolo_state, _annotated = model.process_frame(
        frame,
        current_weight=current_weight,
        prev_weight=prev_weight,
    )

    # ── Build per-person gowning breakdown ────────────────────────────────────
    # YoloPipeline does not expose per-person details in its return value, but
    # ppeStatus already aggregates coat+mask for all detected persons.
    # We reconstruct a per-person list from the bounding-box loop that ran
    # internally.  Because process_frame() only returns a summary dict, we
    # derive per-person records from the aggregate flags here.
    #
    # If you need true per-person detail, call model._check_lab_coat() and
    # model._check_mask() directly with each bounding box — but that requires
    # re-running pose inference.  For the compliance event the aggregate is
    # sufficient.
    person_count: int = yolo_state.get("peopleCount", 0)
    ppe_status: str = yolo_state.get("ppeStatus", "UNKNOWN")

    per_person = _build_per_person(person_count, ppe_status)

    # ── Assemble canonical event ──────────────────────────────────────────────
    event: dict[str, Any] = {
        "event_type": "YOLO_FRAME_STATUS",
        "timestamp": _utcnow(),
        # Top-level fields expected by YOLO_UPDATE handler in workflow.compiler
        "person_count": person_count,
        "second_verifier": yolo_state.get("secondVerifier", False),
        "station_occupied": yolo_state.get("stationOccupied", False),
        "process_activity": yolo_state.get("processActivity", "UNKNOWN"),
        "detected_objects": yolo_state.get("detectedObjects", []),
        # Gowning compliance block
        "gowning": {
            "status": ppe_status,           # "PASS" | "FAIL" | "UNKNOWN"
            "per_person": per_person,
        },
        # Object confidence scores (used by POST_HOC_VISION auto-verify)
        "object_confidences": yolo_state.get("objectConfidences", {}),
        # Full raw state for callers that need everything
        "raw_yolo_state": yolo_state,
    }

    return event


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty_event(reason: str) -> dict[str, Any]:
    """Return a safe empty event when the frame cannot be processed."""
    return {
        "event_type": "YOLO_FRAME_STATUS",
        "timestamp": _utcnow(),
        "person_count": 0,
        "second_verifier": False,
        "station_occupied": False,
        "process_activity": "UNKNOWN",
        "detected_objects": [],
        "gowning": {
            "status": "UNKNOWN",
            "per_person": [],
            "error": reason,
        },
        "object_confidences": {},
        "raw_yolo_state": {},
    }


def _build_per_person(
    person_count: int,
    ppe_status: str,
) -> list[dict[str, Any]]:
    """
    Build a per-person gowning list.

    YoloPipeline aggregates PPE across all persons to a single status string:
      "PASS"    → every detected person is compliant
      "FAIL"    → at least one person is non-compliant
      "UNKNOWN" → no persons detected or frame unreadable

    Since the pipeline does not expose individual person results through its
    public API, we produce best-effort records:
      - PASS  → all persons are marked compliant
      - FAIL  → the *last* person is marked as the offending one (conservative)
      - UNKNOWN → all persons are unknown

    For a true per-person breakdown wire up the YoloPipeline internals directly
    or extend process_frame() to return per-bbox PPE flags.
    """
    if person_count == 0:
        return []

    records = []
    for idx in range(person_count):
        person_id = idx + 1
        if ppe_status == "PASS":
            coat, mask = True, True
        elif ppe_status == "FAIL":
            # Conservative: mark the last person as failing.
            # In a real deployment you'd propagate per-bbox flags from the pipeline.
            if idx == person_count - 1:
                coat, mask = False, False
            else:
                coat, mask = True, True
        else:  # UNKNOWN
            coat, mask = False, False

        records.append(
            {
                "person_id": person_id,
                "lab_coat": coat,
                "mask": mask,
                "compliant": coat and mask,
            }
        )

    return records
