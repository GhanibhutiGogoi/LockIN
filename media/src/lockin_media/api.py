import logging
import subprocess
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from filelock import Timeout

from .content import content_routes
from .prompts import VOICE_PROFILES
from .schemas import MediaRequest, MediaResponse
from .service import MediaService
from .settings import Settings

log = logging.getLogger(__name__)


def create_app(settings: Settings | None = None, service: MediaService | None = None) -> FastAPI:
    s = settings or Settings()
    service = service or MediaService(s)

    @asynccontextmanager
    async def lifespan(app):
        yield
        service.close()

    app = FastAPI(title="LockIn media", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_methods=["GET", "POST", "HEAD"],
        allow_headers=["Content-Type", "Range"],
        expose_headers=["Accept-Ranges", "Content-Range", "Content-Length"],
    )
    # Only final media are public. Prompts, voice references and cache JSON stay private.
    app.mount("/assets", StaticFiles(directory=s.data_dir / "assets"), name="assets")
    app.include_router(content_routes(s))

    @app.get("/healthz")
    def health():
        return {
            "service": "lockin-media",
            "api_version": 1,
            "status": "ok",
            "mode": s.mode,
            "gpu_inference_verified": False,
            "capabilities": {"media": True, "scripts": bool(s.content_url), "deck_import": False},
        }

    @app.get("/readyz")
    def ready():
        if s.mode == "mock":
            return {"ready": True, "mode": "mock", "model_inference": False}
        checks = service.backend.readiness()
        for voice_id in VOICE_PROFILES:
            try:
                service.store.voice(voice_id)
                checks[voice_id] = True
            except (ValueError, OSError):
                checks[voice_id] = False
        ok = all(checks.values())
        return JSONResponse(
            {"ready": ok, "mode": "real", "checks": checks}, status_code=200 if ok else 503
        )

    @app.post(
        "/media",
        response_model=MediaResponse,
        response_model_exclude_none=True,
        response_model_by_alias=False,
    )
    def media(req: MediaRequest):
        try:
            return service.render(req)
        except Timeout as e:
            raise HTTPException(
                503, "Narrator busy; prewarm packs before the session", headers={"Retry-After": "3"}
            ) from e
        except (
            ValueError,
            OSError,
            httpx.HTTPError,
            RuntimeError,
            subprocess.SubprocessError,
        ) as e:
            log.warning("Media request failed: %s", type(e).__name__)
            # No private transcripts, server tokens or file paths in public errors.
            raise HTTPException(
                503, "Media generation failed; check model readiness and server logs"
            ) from e

    @app.get("/library/gameplay")
    def gameplay():
        return service.store.gameplay()

    @app.get("/library/music")
    def music():
        return []  # Optional operator-supplied music is mixed into audio_url.

    @app.get("/voices")
    def voices():
        return [{"id": k, "label": v["label"]} for k, v in VOICE_PROFILES.items()]

    return app
