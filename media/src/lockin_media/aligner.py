"""Run only in runtimes/aligner; never imported by the lightweight API."""

import os
import threading
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile


def create_app():
    lock = threading.Lock()
    state = {}

    @asynccontextmanager
    async def lifespan(app):
        import torch
        from qwen_asr import Qwen3ForcedAligner

        device = os.environ.get("LOCKIN_ALIGNER_DEVICE", "cpu")
        model_path = Path(os.environ["LOCKIN_ALIGNER_MODEL"]).resolve()
        if not model_path.is_dir():
            raise RuntimeError("Download the pinned aligner checkpoint before starting")
        # CPU by default: reserve GPU memory for the distributed voice model.
        dtype = torch.float32 if device == "cpu" else torch.bfloat16
        if device != "cpu" and not torch.cuda.is_bf16_supported():
            raise RuntimeError("GPU aligner profile requires BF16; use LOCKIN_ALIGNER_DEVICE=cpu")
        state["model"] = Qwen3ForcedAligner.from_pretrained(
            str(model_path),
            dtype=dtype,
            device_map=device,
            attn_implementation="eager",
        )
        yield
        state.clear()

    app = FastAPI(title="LockIn private aligner", lifespan=lifespan)

    @app.get("/healthz")
    def health():
        return {"ready": "model" in state}

    @app.post("/align")
    def align(text: Annotated[str, Form(max_length=4000)], audio: Annotated[UploadFile, File()]):
        import soundfile as sf
        import torch

        data = audio.file.read(32 * 1024 * 1024 + 1)
        if len(data) > 32 * 1024 * 1024:
            raise HTTPException(413, "Audio too large")
        waveform, sr = sf.read(BytesIO(data), dtype="float32")
        if waveform.ndim != 1 or not 0 < len(waveform) / sr <= 180:
            raise HTTPException(422, "Expected mono audio, at most 180 seconds")
        if not lock.acquire(blocking=False):
            raise HTTPException(503, "Aligner busy")
        try:
            with torch.inference_mode():
                result = state["model"].align(audio=(waveform, sr), text=text, language="English")
            return {
                "words": [
                    {"text": w.text, "start": float(w.start_time), "end": float(w.end_time)}
                    for w in result[0]
                ]
            }
        finally:
            lock.release()

    return app
