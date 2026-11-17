import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from lockin.calibration_diagnostics import register


def test_numeric_calibration_details_survive_local_storage(tmp_path):
    app = FastAPI()
    register(app, tmp_path)
    client = TestClient(app)
    summary = {
        'index': 1, 'mode': 'validation', 'target': [-.23, -.19],
        'sampleCount': 7, 'rawSamples': [[.1, .2]] * 7,
        'rawMedian': [.1, .2], 'rawMad': [0, 0], 'rawRange': [0, 0],
        'mappedMedian': [-2, 3], 'unclippedMedian': [-1, 2],
        'predicted': [-.5, .5], 'clippedSamples': 7, 'durationMs': 1900.5,
        'errorNormalized': .74, 'errorPx': 772.2,
    }
    report = {
        'schemaVersion': 2, 'attemptId': '00000000-0000-4000-8000-000000000002',
        'startedAt': 1794585600000, 'durationMs': 30000, 'outcome': 'failed',
        'stage': 'calibration', 'cameraStatus': 'on', 'cameraError': None,
        'model': 'blazegaze', 'viewport': {'width': 1707, 'height': 898, 'pixelRatio': 1.5},
        'points': [], 'tracker': {
            'issue': 'validation_failed', 'frames': {'usable': 150, 'noFace': 0, 'eyesUnavailable': 0, 'noGaze': 0},
            'camera': [640, 480], 'method': 'median-7-affine-v1', 'points': [summary],
            'fit': {'method': 'median-7-affine-v1', 'inputSingularValues': [1, 0],
                    'inputConditionNumber': None, 'matrix': [[1, 0, 0], [0, 1, 0]],
                    'pointErrors': [0] * 9, 'rmse': 0},
        },
    }
    assert client.post('/v1/web-screen/calibration-diagnostics', json=report).status_code == 204
    saved = json.loads(next(tmp_path.glob('*.json')).read_text())
    assert saved['tracker']['points'] == [summary]
    assert saved['tracker']['fit'] == report['tracker']['fit']
    summary['image'] = 'not allowed'
    assert client.post('/v1/web-screen/calibration-diagnostics', json=report).status_code == 422
