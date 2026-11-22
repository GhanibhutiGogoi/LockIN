"""Fault-inject a private OCR worker; never interrupt the user's HTTP service."""
from pathlib import Path
import sys
import time

from fastapi import HTTPException
from PIL import ImageFont

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from lockin.screen_ocr import PaddleScreenOCR
from check import jpeg


def ready(service):
    deadline = time.monotonic() + 150
    while time.monotonic() < deadline:
        status = service.status()
        if status['status'] == 'ready':
            return
        if status['status'] not in ('loading', 'recovering'):
            raise RuntimeError(status)
        time.sleep(1)
    raise TimeoutError(service.status())


def main():
    service = PaddleScreenOCR()
    frame = jpeg(['Recovery after timeout'], ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 44))
    try:
        print('Starting private test worker...', flush=True)
        service.start()
        ready(service)
        print('Worker ready; injecting a request timeout...', flush=True)
        old_process = service.process
        service.timeout = 0.001
        try:
            service.recognize(frame)
            raise AssertionError('Expected an injected timeout')
        except HTTPException as error:
            assert error.status_code == 503
        assert old_process.poll() is not None
        assert service.status()['status'] == 'recovering'
        service.timeout = 30
        print('Waiting for automatic timeout recovery...', flush=True)
        ready(service)
        result = service.recognize(frame)
        assert 'Recovery after timeout' in '\n'.join(result['lines']), result
        assert service.restarts == 1
        print('PASS: actual worker timeout, replacement, and fresh OCR result.', flush=True)
        service.process.kill()
        service.process.wait(timeout=5)
        print('Waiting for automatic crash recovery...', flush=True)
        ready(service)
        result = service.recognize(frame)
        assert 'Recovery after timeout' in '\n'.join(result['lines']), result
        assert service.restarts == 2
        print('PASS: unexpected worker exit and automatic recovery.', flush=True)
    finally:
        service.close()


if __name__ == '__main__':
    main()
