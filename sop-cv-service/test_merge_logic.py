import unittest
from unittest.mock import MagicMock
import sys

# Mock ultralytics YOLO class before importing to avoid heavy model loading/downloads
sys.modules['ultralytics'] = MagicMock()

from yolo_pipeline import YoloPipeline

class TestMergeLogic(unittest.TestCase):
    def test_merge_gloves_and_activity(self):
        # Create pipeline with mock config
        config = {
            "workstation_zone": {"x": 0, "y": 0, "w": 9999, "h": 9999},
            "scale_roi": {"x": 400, "y": 50, "w": 400, "h": 120}
        }
        pipeline = YoloPipeline(config)
        
        # Scenario 1: Cam1 detects gloves (PASS), Cam2 does not (UNKNOWN)
        state1 = {
            'peopleCount': 1,
            'secondVerifier': False,
            'ppeCoat': True,
            'ppeMask': True,
            'ppeGloves': 'PASS',
            'stationOccupied': True,
            'processActivity': 'IDLE',
            'detectedObjects': ['bottle'],
            'objectConfidences': {'bottle': 0.8}
        }
        state2 = {
            'detectedObjects': [],
            'objectConfidences': {},
            'ppeGloves': 'UNKNOWN',
            'stationOccupied': False,
            'processActivity': 'UNKNOWN'
        }
        
        merged = pipeline.merge_results(state1, state2)
        self.assertEqual(merged['ppeGloves'], 'PASS')
        self.assertEqual(merged['ppeStatus'], 'PASS')
        self.assertEqual(merged['processActivity'], 'IDLE')
        
        # Scenario 2: Cam1 is UNKNOWN gloves, Cam2 is FAIL gloves
        state1['ppeGloves'] = 'UNKNOWN'
        state2['ppeGloves'] = 'FAIL'
        merged = pipeline.merge_results(state1, state2)
        self.assertEqual(merged['ppeGloves'], 'FAIL')
        self.assertEqual(merged['ppeStatus'], 'FAIL')
        
        # Scenario 3: Activity priority merge (WEIGHING vs POURING_LIKELY vs IDLE)
        state1['processActivity'] = 'IDLE'
        state2['processActivity'] = 'WEIGHING'
        merged = pipeline.merge_results(state1, state2)
        self.assertEqual(merged['processActivity'], 'WEIGHING')
        
        # Scenario 4: Activity priority merge (POURING_LIKELY vs HANDLING_MATERIAL)
        state1['processActivity'] = 'POURING_LIKELY'
        state2['processActivity'] = 'HANDLING_MATERIAL'
        merged = pipeline.merge_results(state1, state2)
        self.assertEqual(merged['processActivity'], 'POURING_LIKELY')
        
        print("All logical merge tests passed successfully!")

if __name__ == '__main__':
    unittest.main()
