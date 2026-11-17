"""Extract text from a shared screen frame on this machine."""
import json
import subprocess
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from starlette.concurrency import run_in_threadpool


MAX_FRAME_BYTES = 1_500_000
OCR_BINARY = Path(__file__).resolve().parents[2] / '.models' / 'screen-text'


def recognize_screen_text(frame: bytes) -> list[str]:
    try:
        result = subprocess.run(
            [str(OCR_BINARY)], input=frame, capture_output=True, timeout=4, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise HTTPException(503, 'Local screen text recognition is unavailable') from None
    if result.returncode == 2:
        raise HTTPException(422, 'Invalid or oversized JPEG')
    if result.returncode != 0:
        raise HTTPException(503, 'Local screen text recognition failed')
    return json.loads(result.stdout)


def register(app: FastAPI) -> None:
    @app.post('/v1/web-screen/text')
    async def screen_text(request: Request):
        if request.headers.get('content-type', '').lower() != 'image/jpeg':
            raise HTTPException(415, 'Expected a JPEG frame')
        frame = bytearray()
        async for chunk in request.stream():
            if len(frame) + len(chunk) > MAX_FRAME_BYTES:
                raise HTTPException(413, 'Screen frame is too large')
            frame.extend(chunk)
        if not frame.startswith(b'\xff\xd8\xff'):
            raise HTTPException(422, 'Invalid JPEG')
        lines = await run_in_threadpool(recognize_screen_text, bytes(frame))
        return {'lines': lines}
