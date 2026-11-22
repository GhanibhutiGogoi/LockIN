"""Serialized OCR requests with bounded I/O and automatic worker recovery."""
import base64
import json
import os
import queue
import subprocess
import sys
import threading
import time

from fastapi import HTTPException

from .ocr_config import MODELS, ROOT, missing_models, worker_environment


class PaddleScreenOCR:
    def __init__(self, timeout=30.0):
        self.timeout = timeout
        self.process = None
        self.responses = queue.Queue()
        self.lock = threading.Lock()
        self.state = 'stopped'
        self.message = 'Local OCR has not started.'
        self.started_at = 0.0
        self.retry_at = 0.0
        self.failures = 0
        self.restarts = 0
        self.last_failure = None
        self.stage = 'idle'
        self.closed = False

    def start(self):
        with self.lock:
            if self.state == 'stopped' and not self.closed:
                self._launch()

    def _launch(self):
        if missing_models():
            self.state, self.message = 'unavailable', 'OCR models are missing. Run scripts/ocr/prepare.py.'
            return
        self.state, self.message = 'loading', 'Loading the local Chinese and English OCR models.'
        self.stage = 'initializing'
        self.started_at = time.monotonic()
        # Each generation owns its queue. Late messages cannot reach a new worker.
        self.responses = queue.Queue()
        try:
            process = subprocess.Popen(
                [sys.executable, '-m', 'lockin.ocr_worker'], cwd=ROOT,
                env=worker_environment(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                text=True, encoding='utf-8', bufsize=1,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
            )
        except OSError:
            self._recover('worker_start_failed')
            return
        self.process = process
        threading.Thread(target=self._read, args=(process, self.responses), daemon=True).start()

    def _read(self, process, responses):
        try:
            for line in process.stdout:
                try:
                    result = json.loads(line)
                except ValueError:
                    continue
                if process is not self.process:
                    return
                if self.state == 'loading':
                    if result.get('status') == 'ready':
                        self.state, self.message = 'ready', 'Local OCR is ready.'
                        self.stage = 'idle'
                    elif result.get('status') == 'error':
                        self.state = 'unavailable'
                        self.message = result.get('message', 'OCR initialization failed.')
                else:
                    responses.put(result)
        except (OSError, ValueError):
            pass
        finally:
            responses.put({'status': 'error', 'code': 503, 'message': 'OCR worker disconnected.'})

    def _recover(self, reason):
        self.last_failure = {'reason': reason, 'stage': self.stage, 'at': int(time.time() * 1000)}
        self._terminate()
        self.failures += 1
        self.retry_at = time.monotonic() + min(30, 2 ** min(self.failures, 5))
        self.state = 'recovering'
        self.message = 'OCR was interrupted. Recovering automatically; keep your study page open.'

    def status(self):
        # Health polling stays responsive while inference owns the request lock.
        if self.lock.acquire(blocking=False):
            try:
                if not self.closed:
                    if self.state == 'loading' and time.monotonic() - self.started_at > 120:
                        self._recover('startup_timeout')
                    elif self.state in ('loading', 'ready') and self.process and self.process.poll() is not None:
                        self._recover('worker_exit')
                    if self.state == 'recovering' and time.monotonic() >= self.retry_at:
                        self.restarts += 1
                        self._launch()
            finally:
                self.lock.release()
        return {'status': self.state, 'message': self.message, 'engine': 'paddleocr',
                'device': 'cpu', 'models': list(MODELS), 'stage': self.stage,
                'restarts': self.restarts, 'lastFailure': self.last_failure}

    @staticmethod
    def _send(process, responses, frame):
        try:
            process.stdin.write(json.dumps({'frame': base64.b64encode(frame).decode('ascii')}) + '\n')
            process.stdin.flush()
        except (OSError, ValueError):
            responses.put({'status': 'error', 'code': 503, 'message': 'OCR input disconnected.'})

    def recognize(self, frame):
        self.status()
        if not self.lock.acquire(blocking=False):
            raise HTTPException(429, 'OCR is busy. Retry with a fresh frame.')
        try:
            if self.state != 'ready':
                raise HTTPException(503, self.message)
            self.stage = 'sending'
            deadline = time.monotonic() + self.timeout
            # Pipe writes can block too; include sending in the request deadline.
            threading.Thread(target=self._send, args=(self.process, self.responses, frame), daemon=True).start()
            while True:
                try:
                    result = self.responses.get(timeout=max(0, deadline - time.monotonic()))
                except queue.Empty:
                    self._recover('request_timeout')
                    raise HTTPException(503, self.message) from None
                if result.get('status') == 'progress':
                    self.stage = result['stage']
                    continue
                if result.get('status') == 'error':
                    if result.get('code', 503) >= 500:
                        self._recover('worker_error')
                        raise HTTPException(503, self.message)
                    self.stage = 'idle'
                    raise HTTPException(result.get('code', 422), result['message'])
                self.failures = 0
                self.stage = 'idle'
                return result
        finally:
            self.lock.release()

    def _terminate(self):
        process, self.process = self.process, None
        if process and process.poll() is None:
            # Windows venv python.exe can launch another Python process. Killing
            # only the launcher leaves inference and inherited pipes alive.
            if os.name == 'nt' and getattr(process, 'pid', None):
                try:
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                   capture_output=True, timeout=5,
                                   creationflags=subprocess.CREATE_NO_WINDOW)
                except (OSError, subprocess.TimeoutExpired):
                    pass
            if process.poll() is None:
                process.kill()
            process.wait(timeout=5)
        if process:
            process.stdin.close()
            process.stdout.close()

    def close(self):
        with self.lock:
            self.closed = True
            self._terminate()
            self.state = 'stopped'
