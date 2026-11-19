"""Stateless Kokoro voice API. All per-request files expire with the response."""

import base64
import os
import tempfile
from pathlib import Path
from threading import BoundedSemaphore
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .alignment import to_captions
from .audio import duration, encode_soundtrack, pace_audio


class NarrationRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000, pattern=r"\S")
    voice_id: Literal["hype", "chill"] = "hype"
    pacing: float = Field(default=1, ge=0.75, le=1.35, allow_inf_nan=False)


def create_app():
    from .kokoro import CpuModels

    backend = CpuModels(Path(os.environ["LOCKIN_KOKORO_WEIGHTS"]))
    slot = BoundedSemaphore()
    app = FastAPI(title="LockIN narration")

    @app.get("/readyz")
    def ready():
        return {
            "service": "lockin-narration",
            "api_version": 1,
            "ready": True,
            "voices": list(backend.voices),
        }

    @app.post("/narration")
    def record(req: NarrationRequest):
        if len(req.text.split()) > 240:
            raise HTTPException(422, "Narration may contain up to 240 words")
        if not slot.acquire(timeout=3):
            raise HTTPException(503, "Narrator busy. Try again shortly.")
        try:
            with tempfile.TemporaryDirectory() as scratch:
                raw, paced, audio = (
                    Path(scratch) / n for n in ("raw.wav", "paced.wav", "voice.mp3")
                )
                backend.synthesize(req.text, req.voice_id, raw)
                pace_audio(raw, paced, req.pacing)
                seconds = duration(paced)
                captions = to_captions(req.text, backend.align(req.text, paced), seconds)
                encode_soundtrack(paced, audio)
                return {
                    "audio_base64": base64.b64encode(audio.read_bytes()).decode("ascii"),
                    "captions": [c.model_dump() for c in captions],
                    "duration_sec": seconds,
                }
        finally:
            slot.release()

    return app
