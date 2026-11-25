"""Request-local timings. Never record prompts, credentials, URLs or model output."""

import json
import logging
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime
from functools import wraps
from time import perf_counter
from uuid import uuid4

from filelock import FileLock

_current = ContextVar("media_timing", default=None)


def annotate(**values):
    if trace := _current.get():
        trace["metadata"].update(values)


def durations():
    trace = _current.get()
    return dict(trace["stages_ms"]) if trace else {}


def remote_durations(values):
    if trace := _current.get():
        for name in ("tts", "pace", "audio_probe", "alignment", "audio_encode", "queue"):
            value = values.get(name)
            if isinstance(value, (int, float)) and 0 <= value < 3_600_000:
                trace["stages_ms"]["remote_" + name] = value


@contextmanager
def stage(name):
    start = perf_counter()
    try:
        yield
    finally:
        if trace := _current.get():
            trace["stages_ms"][name] = round(
                trace["stages_ms"].get(name, 0) + (perf_counter() - start) * 1000, 3
            )


def timed(name):
    def decorate(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            with stage(name):
                return fn(*args, **kwargs)

        return wrapped

    return decorate


def install_timing(app, log_path=None):
    @app.middleware("http")
    async def measure(request, call_next):
        if request.url.path not in ("/scripts", "/media", "/narration"):
            return await call_next(request)
        trace = {
            "request_id": uuid4().hex,
            "timestamp": datetime.now(UTC).isoformat(),
            "endpoint": request.url.path,
            "stages_ms": {},
            "metadata": {},
        }
        token = _current.set(trace)
        start = perf_counter()
        try:
            response = await call_next(request)
            trace["status"] = response.status_code
            response.headers["X-Request-ID"] = trace["request_id"]
            response.headers["Server-Timing"] = ", ".join(
                f"{name};dur={value}" for name, value in trace["stages_ms"].items()
            )
            return response
        finally:
            trace["total_ms"] = round((perf_counter() - start) * 1000, 3)
            line = json.dumps(trace, allow_nan=False)
            logging.getLogger("uvicorn.error").info("media_timing %s", line)
            if log_path:
                try:
                    with FileLock(str(log_path) + ".lock", timeout=1):
                        with log_path.open("a", encoding="utf-8") as out:
                            out.write(line + "\n")
                except (OSError, TimeoutError):
                    logging.getLogger("uvicorn.error").warning("Could not persist media timings")
            _current.reset(token)
