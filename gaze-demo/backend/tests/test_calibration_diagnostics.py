import json

from fastapi.testclient import TestClient

from lockin.app import create_app
from lockin.memory import Memory


def test_calibration_diagnostic_writes_one_local_file_per_attempt(tmp_path, monkeypatch):
    directory = tmp_path / 'diagnostics'
    monkeypatch.setenv('LOCKIN_CALIBRATION_DIR', str(directory))
    client = TestClient(create_app(tmp_path / 'lockin.sqlite', memory=Memory()))
    path = '/v1/web-screen/calibration-diagnostics'
    diagnostic = {
        'attemptId': '00000000-0000-4000-8000-000000000001',
        'startedAt': 1794585600000,
        'durationMs': 15000,
        'outcome': 'failed',
        'stage': 'calibration',
        'cameraStatus': 'on',
        'cameraError': None,
        'model': 'blazegaze',
        'viewport': {'width': 1200, 'height': 800, 'pixelRatio': 2},
        'points': [{'mode': 'calibration', 'index': 1, 'total': 9, 'count': 2, 'elapsedMs': 12000}],
        'tracker': {'issue': 'timeout', 'frames': {'usable': 2, 'noFace': 9, 'eyesUnavailable': 1, 'noGaze': 0}},
    }
    assert client.post(path, json={**diagnostic, 'image': 'raw frame'}).status_code == 422
    assert client.post(path, json=diagnostic, headers={'Origin': 'https://example.com'}).status_code == 403
    for _ in range(2):
        assert client.post(path, json=diagnostic, headers={'Origin': 'http://127.0.0.1:5180'}).status_code == 204
    files = list(directory.iterdir())
    assert len(files) == 1
    saved = json.loads(files[0].read_text())
    assert saved['points'] == diagnostic['points']
    assert saved['tracker']['issue'] == 'timeout'
    assert saved['outcome'] == 'failed'
    assert files[0].stat().st_mode & 0o077 == 0
