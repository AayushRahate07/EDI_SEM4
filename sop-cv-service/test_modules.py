"""
test_modules.py — Quick tests for vision_module + sop_parser
=============================================================
Run with:  python test_modules.py

These tests use mocks so they work without a GPU, a camera, or an API key.
They verify:
  1. get_frame_status() returns the expected JSON schema
  2. parse_sop() runs the full parse → validate → review pipeline
  3. push_dag_to_engine() correctly POSTs to sop-engine
"""

import json
import sys
import unittest
from unittest.mock import MagicMock, patch

import numpy as np


# ─── Helpers ───────────────────────────────────────────────────────────────────

def _make_frame(h=480, w=640):
    """Return a random BGR frame."""
    return np.random.randint(0, 256, (h, w, 3), dtype=np.uint8)


MINIMAL_VALID_DAG = {
    "template_id": "SOP-TEST-001",
    "version": "1.0.0",
    "start_node_id": "step_ppe_1",
    "nodes": [
        {
            "id": "step_ppe_1",
            "type": "VERIFICATION",
            "title": "PPE Gowning Check",
            "x": 400, "y": 0,
            "config": {
                "entity_name": "gowning",
                "mode": "POST_HOC_VISION",
                "confidence_threshold": 0.6,
                "yolo_class_name": "person",
            },
            "next_nodes": ["step_weigh_api"],
        },
        {
            "id": "step_weigh_api",
            "type": "MEASUREMENT",
            "title": "Weigh API",
            "x": 400, "y": 120,
            "config": {
                "target_value": 500.0,
                "unit": "mg",
                "tolerance_positive": 5.0,
                "tolerance_negative": 5.0,
            },
            "next_nodes": ["WORKFLOW_COMPLETE"],
        },
    ],
}

SAMPLE_SOP_TEXT = """
SOP-KETOPROFEN-001  Manufacturing of Ketoprofen 100 mg Tablets

1. Operator gowning: Wear lab coat, gloves, and face mask before entering.
2. Weigh 500 mg ± 5 mg of Ketoprofen API on calibrated balance.
3. Weigh 200 mg ± 2 mg of Microcrystalline Cellulose (MCC).
4. Verify batch number of Ketoprofen against approved list (barcode scan).
5. Mix API and MCC for 15 minutes.
6. Second verifier must confirm blend uniformity and co-sign record.
"""


# ─── Test 1: vision_module.get_frame_status ────────────────────────────────────

class TestVisionModule(unittest.TestCase):

    def _make_mock_pipeline(self, people=2, ppe="PASS"):
        """Return a mock YoloPipeline whose process_frame() returns canned data."""
        mock_pipeline = MagicMock()
        fake_yolo_state = {
            "peopleCount": people,
            "secondVerifier": people >= 2,
            "ppeStatus": ppe,
            "stationOccupied": True,
            "processActivity": "ACTIVE",
            "detectedObjects": ["bottle"],
            "objectConfidences": {"bottle": 0.72},
        }
        fake_annotated = _make_frame()
        mock_pipeline.process_frame.return_value = (fake_yolo_state, fake_annotated)
        return mock_pipeline

    def test_returns_expected_keys(self):
        from vision_module import get_frame_status
        model = self._make_mock_pipeline()
        event = get_frame_status(_make_frame(), model)

        required_keys = {
            "event_type", "timestamp", "person_count",
            "second_verifier", "station_occupied",
            "process_activity", "detected_objects",
            "gowning", "object_confidences", "raw_yolo_state",
        }
        self.assertEqual(required_keys, required_keys & event.keys())

    def test_person_count(self):
        from vision_module import get_frame_status
        model = self._make_mock_pipeline(people=3)
        event = get_frame_status(_make_frame(), model)
        self.assertEqual(event["person_count"], 3)

    def test_gowning_pass(self):
        from vision_module import get_frame_status
        model = self._make_mock_pipeline(people=1, ppe="PASS")
        event = get_frame_status(_make_frame(), model)
        self.assertEqual(event["gowning"]["status"], "PASS")
        self.assertTrue(event["gowning"]["per_person"][0]["compliant"])

    def test_gowning_fail(self):
        from vision_module import get_frame_status
        model = self._make_mock_pipeline(people=2, ppe="FAIL")
        event = get_frame_status(_make_frame(), model)
        self.assertEqual(event["gowning"]["status"], "FAIL")
        # Last person should be flagged as non-compliant
        self.assertFalse(event["gowning"]["per_person"][-1]["compliant"])

    def test_empty_frame_returns_unknown(self):
        from vision_module import get_frame_status
        event = get_frame_status(None, MagicMock())
        self.assertEqual(event["gowning"]["status"], "UNKNOWN")
        self.assertEqual(event["person_count"], 0)

    def test_second_verifier_flag(self):
        from vision_module import get_frame_status
        model = self._make_mock_pipeline(people=2)
        event = get_frame_status(_make_frame(), model)
        self.assertTrue(event["second_verifier"])

    def test_json_serialisable(self):
        from vision_module import get_frame_status
        model = self._make_mock_pipeline()
        event = get_frame_status(_make_frame(), model)
        # Should not raise
        json.dumps(event)

    def test_yolo_update_payload_compatible(self):
        """Event must contain all fields expected by workflow.compiler.ts YOLO_UPDATE."""
        from vision_module import get_frame_status
        model = self._make_mock_pipeline()
        event = get_frame_status(_make_frame(), model)
        # Fields consumed by the XState machine
        required_by_engine = {
            "person_count", "second_verifier", "station_occupied",
            "process_activity", "detected_objects",
        }
        for field in required_by_engine:
            self.assertIn(field, event, f"Missing engine field: {field}")


# ─── Test 2: sop_parser (LLM mocked) ──────────────────────────────────────────

class TestSopParser(unittest.TestCase):

    def _patch_llm(self):
        """Patch _call_llm to return the minimal valid DAG without hitting the API."""
        return patch(
            "sop_parser._call_llm",
            return_value=json.dumps(MINIMAL_VALID_DAG),
        )

    def test_parse_returns_valid_dag(self):
        from sop_parser import parse_sop
        with self._patch_llm():
            dag = parse_sop(SAMPLE_SOP_TEXT, skip_review=True)
        self.assertEqual(dag["template_id"], "SOP-TEST-001")
        self.assertIn("nodes", dag)
        self.assertEqual(len(dag["nodes"]), 2)

    def test_validation_catches_missing_start_node(self):
        from sop_parser import SopValidationError, _validate_dag
        bad_dag = {**MINIMAL_VALID_DAG, "start_node_id": "nonexistent"}
        with self.assertRaises(SopValidationError):
            _validate_dag(bad_dag)

    def test_validation_catches_dangling_next_node(self):
        from sop_parser import SopValidationError, _validate_dag
        import copy
        bad_dag = copy.deepcopy(MINIMAL_VALID_DAG)
        bad_dag["nodes"][0]["next_nodes"] = ["ghost_node"]
        with self.assertRaises(SopValidationError):
            _validate_dag(bad_dag)

    def test_validation_catches_bad_unit(self):
        from sop_parser import SopValidationError, _validate_dag
        import copy
        bad_dag = copy.deepcopy(MINIMAL_VALID_DAG)
        bad_dag["nodes"][1]["config"]["unit"] = "kg"  # not in enum
        with self.assertRaises(SopValidationError):
            _validate_dag(bad_dag)

    def test_repair_loop_on_first_fail(self):
        """If the first LLM response is invalid, it should call LLM again to repair."""
        from sop_parser import parse_sop
        import copy

        bad_dag = copy.deepcopy(MINIMAL_VALID_DAG)
        bad_dag["start_node_id"] = "ghost"  # invalid

        call_count = {"n": 0}

        def fake_llm(text):
            call_count["n"] += 1
            if call_count["n"] == 1:
                return json.dumps(bad_dag)
            return json.dumps(MINIMAL_VALID_DAG)

        with patch("sop_parser._call_llm", side_effect=fake_llm):
            dag = parse_sop(SAMPLE_SOP_TEXT, skip_review=True, max_retries=2)

        self.assertGreaterEqual(call_count["n"], 2)
        self.assertEqual(dag["start_node_id"], "step_ppe_1")

    def test_push_dag_posts_to_correct_url(self):
        from sop_parser import push_dag_to_engine

        with patch("sop_parser.requests.post") as mock_post:
            mock_resp = MagicMock()
            mock_resp.json.return_value = {"status": "saved", "id": "SOP-TEST-001"}
            mock_resp.raise_for_status = MagicMock()
            mock_post.return_value = mock_resp

            result = push_dag_to_engine(
                MINIMAL_VALID_DAG,
                engine_url="http://localhost:3000",
            )

        mock_post.assert_called_once()
        call_url = mock_post.call_args[0][0]
        self.assertEqual(call_url, "http://localhost:3000/api/sop/templates")
        self.assertEqual(result["status"], "saved")

    def test_extract_json_strips_markdown_fences(self):
        from sop_parser import _extract_json
        wrapped = f"```json\n{json.dumps(MINIMAL_VALID_DAG)}\n```"
        dag = _extract_json(wrapped)
        self.assertEqual(dag["template_id"], "SOP-TEST-001")

    def test_extract_json_handles_prose_prefix(self):
        from sop_parser import _extract_json
        with_prose = f"Sure, here is the DAG:\n{json.dumps(MINIMAL_VALID_DAG)}"
        dag = _extract_json(with_prose)
        self.assertEqual(dag["template_id"], "SOP-TEST-001")


# ─── Test 3: End-to-end pipeline smoke test ────────────────────────────────────

class TestEndToEnd(unittest.TestCase):
    """
    Simulates the full flow:
      1. parse_sop() generates a DAG from SOP text
      2. get_frame_status() generates a YOLO event
      3. The event payload contains the fields sop-engine expects
    """

    def test_full_pipeline_smoke(self):
        from sop_parser import parse_sop
        from vision_module import get_frame_status

        # Step 1: parse SOP
        with patch("sop_parser._call_llm", return_value=json.dumps(MINIMAL_VALID_DAG)):
            dag = parse_sop(SAMPLE_SOP_TEXT, skip_review=True)

        self.assertEqual(dag["nodes"][0]["type"], "VERIFICATION")

        # Step 2: get frame status
        mock_pipeline = MagicMock()
        mock_pipeline.process_frame.return_value = (
            {
                "peopleCount": 2,
                "secondVerifier": True,
                "ppeStatus": "PASS",
                "stationOccupied": True,
                "processActivity": "ACTIVE",
                "detectedObjects": [],
                "objectConfidences": {},
            },
            _make_frame(),
        )

        event = get_frame_status(_make_frame(), mock_pipeline)

        # The VERIFICATION node wants ppeStatus == PASS
        self.assertEqual(event["gowning"]["status"], "PASS")

        # Check this can be sent directly as YOLO_UPDATE payload
        yolo_update_payload = {
            "peopleCount":    event["person_count"],
            "secondVerifier": event["second_verifier"],
            "ppeStatus":      event["gowning"]["status"],
            "stationOccupied":event["station_occupied"],
            "processActivity":event["process_activity"],
            "detectedObjects":event["detected_objects"],
        }
        self.assertIsInstance(yolo_update_payload, dict)


# ─── Runner ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Running tests for vision_module + sop_parser\n" + "-" * 50)
    loader  = unittest.TestLoader()
    suite   = unittest.TestSuite()
    for cls in [TestVisionModule, TestSopParser, TestEndToEnd]:
        suite.addTests(loader.loadTestsFromTestCase(cls))
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
