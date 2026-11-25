"""Loopback workstation API for script generation, composition and local storage."""

import base64
import json
import re
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from filelock import FileLock, Timeout
from pydantic import BaseModel, Field, HttpUrl, field_validator
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .compose_recap import check_ffmpeg, compose
from .live import assets, prepare
from .schemas import Caption, MediaRequest, Script
from .script_cache import cached_script
from .script_writer import Question, ScriptRequest, Writer
from .settings import Settings
from .storage import Store, digest, write_json
from .timing import annotate, install_timing, remote_durations, stage, timed


class VoiceConnection(BaseModel):
    voice_url: HttpUrl

    @field_validator("voice_url")
    @classmethod
    def base_only(cls, url):
        if url.username or url.password or url.query or url.fragment:
            raise ValueError("Use a base URL without embedded credentials, query or fragment")
        return url

    def endpoint(self, path):
        return str(self.voice_url).rstrip("/") + "/" + path


class RenderScript(Script):
    gameplay_id: str | None = None
    music_id: str | None = None
    quiz: list[Question] = Field(default_factory=list, max_length=2)


class RenderRequest(MediaRequest, VoiceConnection):
    script: RenderScript


class Recording(BaseModel):
    duration_sec: float | None = Field(default=None, gt=0, le=180, allow_inf_nan=False)
    timings_ms: dict[str, float] = Field(default_factory=dict)
    audio_base64: str = Field(min_length=1, max_length=8_000_000)
    captions: list[Caption] = Field(min_length=1, max_length=240)


class FactFlag(BaseModel):
    deck_id: str = Field(min_length=1, max_length=200)
    slide_index: int = Field(ge=0)
    variant_id: str = Field(max_length=200)
    note: str = Field(default="", max_length=1000)
    retracted: bool = False


def read_voice(connection, path, payload=None):
    with httpx.Client(timeout=httpx.Timeout(120, connect=8), trust_env=False) as client:
        with client.stream(
            "POST" if payload else "GET", connection.endpoint(path), json=payload
        ) as response:
            response.raise_for_status()
            body = bytearray()
            for chunk in response.iter_bytes():
                body.extend(chunk)
                if len(body) > 8_100_000:
                    raise ValueError("Voice response exceeded the size limit")
    return json.loads(body)


def create_app():
    settings, writer = Settings(), Writer()
    store = Store(settings.data_dir)
    root = store.root / "recaps"
    root.mkdir(exist_ok=True)
    app = FastAPI(title="LockIN local studio")
    install_timing(app, store.root / "timings.jsonl")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "HEAD", "POST", "DELETE"],
        allow_headers=["Content-Type", "Range"],
        expose_headers=["Server-Timing", "X-Request-ID"],
    )
    app.add_middleware(
        TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]", "testserver"]
    )

    @app.middleware("http")
    async def trusted_origin(request: Request, call_next):
        # CORS alone allows simple cross-origin requests to reach a handler.
        origin = request.headers.get("origin")
        if (
            origin
            and origin not in settings.cors_origins
            and origin != str(request.base_url).rstrip("/")
        ):
            return JSONResponse({"detail": "Unrecognized workstation origin"}, status_code=403)
        return await call_next(request)

    @app.post("/connection")
    def check(req: VoiceConnection):
        try:
            writer.check()
            if not store.starter("gameplay") or not store.starter("music"):
                raise ValueError(
                    "Install the local starter library with media/scripts/download-library.sh"
                )
            check_ffmpeg()
            ready = read_voice(req, "readyz")
            if (
                ready.get("service") != "lockin-narration"
                or ready.get("api_version") != 1
                or not ready.get("ready")
            ):
                raise ValueError("Use the base address of the LockIN narration API")
            return {
                "writer": writer.provider,
                "configured_model": writer.effective_model or "CLI default",
                "gameplay": len(store.starter("gameplay")),
                "music": len(store.starter("music")),
            }
        except httpx.HTTPError as e:
            raise HTTPException(
                503, "Cannot reach the narration API. Check its address or SSH tunnel."
            ) from e
        except ValueError as e:
            raise HTTPException(422, str(e)) from e

    @app.post("/scripts")
    def scripts(req: ScriptRequest):
        try:
            catalog = {
                kind: {item["id"]: [item["title"], *item["tags"]] for item in store.starter(kind)}
                for kind in ("gameplay", "music")
            }
            return cached_script(store, writer, req, catalog)
        except (
            ValueError,
            KeyError,
            IndexError,
            OSError,
            subprocess.SubprocessError,
            httpx.HTTPError,
        ) as e:
            raise HTTPException(
                502,
                f"Script failed. Check the local {writer.provider} credentials and retry.",
            ) from e

    @app.get("/library/{kind}")
    def library(kind: str):
        if kind not in ("gameplay", "music"):
            raise HTTPException(404, "Unknown library")
        return assets(store, kind)

    @app.get("/library/assets/{kind}/{asset_id}")
    def library_asset(kind: str, asset_id: str):
        if kind not in ("gameplay", "music"):
            raise HTTPException(404, "Unknown library")
        entry = next((e for e in store.starter(kind) if e["id"] == asset_id), None)
        if not entry:
            raise HTTPException(404, "Unknown asset")
        path = (store.root / entry["url"]).resolve()
        if not path.is_relative_to((store.root / "assets").resolve()) or not path.is_file():
            raise HTTPException(404, "Unknown asset")
        return FileResponse(path, headers={"Cache-Control": "private, max-age=3600"})

    @app.post("/media/live")
    def live_media(req: RenderRequest):
        try:
            return prepare(
                store,
                req,
                lambda: Recording.model_validate(
                    read_voice(
                        req,
                        "narration",
                        {
                            "text": req.spoken_text,
                            "voice_id": req.variant.voice_id,
                            "pacing": req.variant.pacing,
                        },
                    )
                ),
            )
        except (Timeout, httpx.HTTPError) as e:
            raise HTTPException(503, "Narration unavailable or busy") from e
        except (OSError, ValueError, subprocess.SubprocessError) as e:
            raise HTTPException(502, "Live recap preparation failed") from e

    @app.get("/live/{key}/voice.mp3")
    def live_audio(key: str):
        if not re.fullmatch(r"[a-f0-9]{64}", key):
            raise HTTPException(404, "Unknown narration")
        path = store.root / "live" / key / "voice.mp3"
        if not path.is_file():
            raise HTTPException(404, "Unknown narration")
        return FileResponse(
            path, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=3600"}
        )

    @app.post("/media")
    def media(req: RenderRequest):
        key = digest(req.model_dump(mode="json"))
        dest = root / key
        try:
            lock = FileLock(store.root / "locks" / f"recap-{key}.lock", timeout=300)
            with stage("media_queue"):
                lock.acquire()
            try:
                annotate(cache_hit=dest.exists())
                if not dest.exists():
                    with tempfile.TemporaryDirectory(dir=store.root / "tmp") as temp:
                        work = Path(temp)
                        take = Recording.model_validate(
                            timed("narration_request")(read_voice)(
                                req,
                                "narration",
                                {
                                    "text": req.spoken_text,
                                    "voice_id": req.variant.voice_id,
                                    "pacing": req.variant.pacing,
                                },
                            )
                        )
                        remote_durations(take.timings_ms)
                        if [c.word for c in take.captions] != req.spoken_text.split():
                            raise ValueError("The voice API returned captions for different text")
                        (work / "voice.mp3").write_bytes(
                            base64.b64decode(take.audio_base64, validate=True)
                        )
                        info = timed("composition")(compose)(
                            store, work, req, [c.model_dump() for c in take.captions], key
                        )
                        info.update(
                            id=key,
                            title=req.script.hook or f"Slide {req.slide_index + 1}",
                            created=datetime.now(UTC).isoformat(),
                            video_url=f"recaps/{key}/video.mp4",
                        )
                        write_json(work / "metadata.json", info)
                        (work / "voice.mp3").unlink()
                        (work / "captions.ass").unlink()
                        work.rename(dest)
                info = json.loads((dest / "metadata.json").read_text(encoding="utf-8"))
                return {**info, "broll": [], "provenance": {"mode": "real"}}
            finally:
                lock.release()
        except (Timeout, httpx.HTTPError) as e:
            raise HTTPException(
                503, "Narration unavailable or busy. Check the audio API and retry."
            ) from e
        except (OSError, ValueError, subprocess.SubprocessError) as e:
            raise HTTPException(
                502,
                "Composition failed. Check local library files, disk space and FFmpeg with libass.",
            ) from e

    @app.post("/feedback/wrong-fact", status_code=204)
    def flag(req: FactFlag):
        key = digest([req.deck_id, req.slide_index, req.variant_id])
        path = store.root / "review" / f"fact-{key}.json"
        if req.retracted:
            path.unlink(missing_ok=True)
        else:
            write_json(path, req.model_dump())
        return Response(status_code=204)

    @app.get("/recaps")
    def recaps():
        items = []
        for path in root.glob("*/metadata.json"):
            try:
                item = json.loads(path.read_text(encoding="utf-8"))
            except FileNotFoundError:
                continue
            items.append(
                {
                    k: item[k]
                    for k in (
                        "id",
                        "title",
                        "created",
                        "video_url",
                        "bytes",
                        "duration_sec",
                        "gameplay",
                        "music",
                    )
                }
            )
        return sorted(items, key=lambda item: item["created"], reverse=True)

    def recap_dir(key):
        if not re.fullmatch("[a-f0-9]{64}", key):
            raise HTTPException(404, "Unknown recap")
        return root / key

    @app.get("/recaps/{key}/video.mp4", response_class=FileResponse)
    def video(key: str):
        path = recap_dir(key) / "video.mp4"
        if not path.is_file():
            raise HTTPException(404, "Recap was removed")
        return FileResponse(path, media_type="video/mp4")

    @app.delete("/recaps/{key}", status_code=204)
    def delete(key: str):
        dest = recap_dir(key)
        with FileLock(store.root / "locks" / f"recap-{key}.lock", timeout=300):
            if dest.exists():
                with tempfile.TemporaryDirectory(dir=store.root / "tmp") as temp:
                    dest.rename(Path(temp) / "deleted")
        return Response(status_code=204)

    return app
