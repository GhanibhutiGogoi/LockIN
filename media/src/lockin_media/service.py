import os
import tempfile

from filelock import FileLock

from .alignment import mock_captions, normalize, to_captions
from .audio import duration, encode_soundtrack, pace_audio
from .backends import HttpModels
from .prompts import PROMPT_VERSION
from .schemas import Broll, MediaRequest, MediaResponse
from .settings import Settings, model_lock
from .storage import Store, digest, file_digest, write_json


class MediaService:
    def __init__(self, settings: Settings, backend=None):
        self.settings = settings
        self.store = Store(settings.data_dir)
        self.backend = backend or HttpModels(settings)

    def render(self, req: MediaRequest) -> MediaResponse:
        s, root = self.settings, self.settings.data_dir
        reference = self.store.voice(req.variant.voice_id) if s.mode == "real" else None
        music_hash = file_digest(s.music_file) if s.music_file else None
        key = digest(
            {
                "schema": 1,
                "request": req.model_dump(),
                "mode": s.mode,
                "models": model_lock(),
                "prompts": PROMPT_VERSION,
                "reference": {k: v for k, v in (reference or {}).items() if k != "path"},
                "music": music_hash,
            }
        )
        cache_path = root / "cache" / f"{key}.json"

        def cached():
            if not cache_path.exists():
                return None
            data = MediaResponse.model_validate_json(cache_path.read_text())
            if data.audio_url and not (root / data.audio_url).is_file():
                return None
            return data

        response = cached()
        if response is None:
            # One producer per process/host data directory. Duplicate calls recheck
            # the cache after acquiring the lock. No unbounded inference queue.
            with FileLock(root / "locks" / "narration.lock", timeout=s.queue_timeout):
                response = cached()
                if response is None:
                    response = self._produce(req, key, reference)
                    write_json(cache_path, response.model_dump(exclude_none=True))
        # Library changes do not require regenerating narration. Match a b-roll
        # prompt as well as its term so ambiguous terms don't reuse wrong visuals.
        response.broll = self._broll(req, response)
        return response

    def _produce(self, req, key, reference):
        text, s = req.spoken_text, self.settings
        if s.mode == "mock":
            captions = mock_captions(text, req.variant.pacing)
            return MediaResponse(
                captions=captions,
                duration_sec=captions[-1].end + 0.2,
                provenance={"mode": "mock", "timing": "estimated", "model_inference": False},
            )
        with tempfile.TemporaryDirectory(dir=s.data_dir / "tmp") as temp:
            from pathlib import Path

            temp = Path(temp)
            raw, paced, mp3 = temp / "raw.wav", temp / "paced.wav", temp / "final.mp3"
            self.backend.synthesize(
                text,
                req.variant.voice_id,
                req.variant.slang_level,
                int(key[:8], 16) % (2**31),
                reference,
                raw,
            )
            if not 0 < duration(raw) <= 180:
                raise ValueError(
                    "Narration duration outside 0–180 seconds; inspect the model output"
                )
            pace_audio(raw, paced, req.variant.pacing)
            voice_duration = duration(paced)
            captions = to_captions(text, self.backend.align(text, paced), voice_duration)
            encode_soundtrack(paced, mp3, s.music_file)
            output_duration = duration(mp3)
            os.replace(mp3, s.data_dir / "assets" / f"{key}.mp3")
        return MediaResponse(
            audio_url=f"assets/{key}.mp3",
            captions=captions,
            duration_sec=output_duration,
            provenance={
                "mode": "real",
                "voice": model_lock()["voice"],
                "aligner": model_lock()["aligner"],
                "prompt_version": PROMPT_VERSION,
                "reference_sha256": reference["sha256"],
                "timing": "forced-aligned",
                "target_seconds": req.variant.target_seconds,
                "actual_seconds": output_duration,
            },
        )

    def _broll(self, req, response):
        entries, result = self.store.entries(), []
        words = [normalize(c.word) for c in response.captions]
        for key_term in req.script.key_terms:
            entry = next(
                (
                    e
                    for e in entries
                    if e["category"] == "broll"
                    and e.get("term") == key_term.term
                    and e.get("source_prompt") == key_term.broll_prompt
                ),
                None,
            )
            if entry is None:
                continue
            term = [normalize(w) for w in key_term.term.split()]
            at = next(
                (
                    response.captions[i].start
                    for i in range(len(words))
                    if words[i : i + len(term)] == term
                ),
                None,
            )
            if at is not None:
                result.append(Broll(term=key_term.term, url=f"assets/{entry['file']}", at=at))
        return result

    def close(self):
        self.backend.close()
