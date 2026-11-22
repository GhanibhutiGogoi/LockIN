import io

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from lockin.app import create_app
from lockin.memory import Memory
from lockin.screen_ocr import PaddleScreenOCR


class Process:
    def __init__(self):
        self.stdin = io.StringIO()
        self.stdout = io.StringIO()
        self.killed = False

    def poll(self):
        return 0 if self.killed else None

    def kill(self):
        self.killed = True

    def wait(self, timeout):
        return 0


def test_busy_request_is_rejected_without_queueing():
    service = PaddleScreenOCR()
    service.lock.acquire()
    try:
        with pytest.raises(HTTPException) as error:
            service.recognize(b'frame')
        assert error.value.status_code == 429
    finally:
        service.lock.release()


def test_timeout_kills_worker_and_does_not_reuse_stale_results():
    service = PaddleScreenOCR(timeout=0.001)
    service.state = 'ready'
    process = service.process = Process()
    with pytest.raises(HTTPException) as error:
        service.recognize(b'frame')
    assert error.value.status_code == 503
    assert process.killed
    assert service.status()['status'] == 'recovering'
    assert service.last_failure['reason'] == 'request_timeout'


def test_recovery_replaces_queue_and_accepts_fresh_results(monkeypatch):
    service = PaddleScreenOCR(timeout=0.001)
    service.state = 'ready'
    service.process = Process()
    with pytest.raises(HTTPException):
        service.recognize(b'frame')
    old_queue = service.responses
    old_queue.put({'status': 'ready', 'lines': ['Stale']})
    import queue

    def launch():
        service.responses = queue.Queue()
        service.process = Process()
        service.state = 'ready'
    monkeypatch.setattr(service, '_launch', launch)
    service.retry_at = 0
    assert service.status()['status'] == 'ready'
    assert service.restarts == 1
    service.responses.put({'status': 'ready', 'lines': ['Fresh']})
    assert service.recognize(b'frame')['lines'] == ['Fresh']


def test_idle_worker_exit_recovers_and_close_prevents_restart():
    service = PaddleScreenOCR()
    service.state = 'ready'
    service.process = Process()
    service.process.killed = True
    assert service.status()['status'] == 'recovering'
    assert service.last_failure['reason'] == 'worker_exit'
    service.close()
    service.retry_at = 0
    assert service.status()['status'] == 'stopped'


def test_blocked_pipe_write_is_bounded(monkeypatch):
    import threading
    release = threading.Event()
    service = PaddleScreenOCR(timeout=0.01)
    service.state = 'ready'
    service.process = Process()
    monkeypatch.setattr(service, '_send', lambda *args: release.wait(2))
    try:
        with pytest.raises(HTTPException):
            service.recognize(b'frame')
        assert service.last_failure['stage'] == 'sending'
        assert service.state == 'recovering'
    finally:
        release.set()


def test_windows_timeout_terminates_only_owned_process_tree(monkeypatch):
    import lockin.screen_ocr as module
    calls = []
    process = Process()
    process.pid = 12345
    monkeypatch.setattr(module.os, 'name', 'nt')
    monkeypatch.setattr(module.subprocess, 'CREATE_NO_WINDOW', 0, raising=False)
    monkeypatch.setattr(module.subprocess, 'run', lambda args, **kwargs: calls.append(args))
    service = PaddleScreenOCR()
    service.process = process
    service.close()
    assert calls == [['taskkill', '/PID', '12345', '/T', '/F']]
    assert process.killed


def test_invalid_image_does_not_poison_worker():
    service = PaddleScreenOCR()
    service.state = 'ready'
    service.process = Process()
    service.responses.put({'status': 'error', 'code': 422, 'message': 'Invalid image'})
    with pytest.raises(HTTPException) as error:
        service.recognize(b'invalid')
    assert error.value.status_code == 422
    service.responses.put({'status': 'ready', 'lines': ['Text']})
    assert service.recognize(b'valid')['lines'] == ['Text']


def test_paddle_routes_and_trial_origin(tmp_path, monkeypatch):
    monkeypatch.setenv('LOCKIN_SCREEN_OCR', 'paddleocr')
    monkeypatch.setattr(PaddleScreenOCR, 'start', lambda self: None)
    monkeypatch.setattr(PaddleScreenOCR, 'status', lambda self: {'status': 'ready'})
    monkeypatch.setattr(PaddleScreenOCR, 'recognize', lambda self, frame: {'lines': ['Text'], 'engine': 'paddleocr'})
    app = create_app(tmp_path / 'ocr.sqlite', memory=Memory())
    with TestClient(app) as client:
        assert client.get('/v1/web-screen/status').json() == {'status': 'ready'}
        for origin in ['http://localhost:5181', 'http://127.0.0.1:5181']:
            response = client.post('/v1/web-screen/text', content=b'\xff\xd8\xfftest',
                                   headers={'content-type': 'image/jpeg', 'origin': origin})
            assert response.status_code == 200
            assert response.json()['engine'] == 'paddleocr'
        assert client.post('/v1/web-screen/text', headers={'origin': 'https://example.org'}).status_code == 403
