"""Prepare browser-composed recaps without encoding or mixing a video."""

import base64
import json
import tempfile
from pathlib import Path
from urllib.parse import quote

from filelock import FileLock

from .audio import duration
from .storage import digest, write_json
from .timing import annotate, remote_durations, stage, timed


def assets(store, kind):
    return [
        {**entry, "url": f"library/assets/{kind}/{quote(entry['id'], safe='')}"}
        for entry in store.starter(kind)
    ]


def select_assets(store, request):
    games, tracks = assets(store, "gameplay"), assets(store, "music")
    if not games or not tracks:
        raise ValueError("Install the local gameplay and music libraries")
    matches = [g for g in games if request.variant.gameplay_type in [g["type"], *g["tags"]]]
    game = next((g for g in games if g["id"] == request.script.gameplay_id), (matches or games)[0])
    music = next((m for m in tracks if m["id"] == request.script.music_id), tracks[0])
    return {"gameplay": game, "music": music}


def prepare(store, request, record):
    layers = select_assets(store, request)
    # Reuse narration across slides/styles when the actual spoken text and voice match.
    key = digest(
        [
            1,
            str(request.voice_url),
            request.spoken_text,
            request.variant.voice_id,
            request.variant.pacing,
        ]
    )
    root = store.root / "live"
    root.mkdir(exist_ok=True)
    dest = root / key
    lock = FileLock(store.root / "locks" / f"live-{key}.lock", timeout=150)
    with stage("media_queue"):
        lock.acquire()
    try:
        annotate(playback_mode="live", narration_cache_hit=dest.exists())
        if not dest.exists():
            take = timed("narration_request")(record)()
            remote_durations(take.timings_ms)
            if [c.word for c in take.captions] != request.spoken_text.split():
                raise ValueError("The voice API returned captions for different text")
            with tempfile.TemporaryDirectory(dir=store.root / "tmp") as temp:
                work = Path(temp)
                audio = work / "voice.mp3"
                audio.write_bytes(base64.b64decode(take.audio_base64, validate=True))
                seconds = timed("voice_probe")(duration)(audio)
                captions = [c.model_dump() for c in take.captions]
                if seconds <= 0 or any(c["end"] > seconds + 0.25 for c in captions):
                    raise ValueError("Caption times exceed narration duration")
                write_json(work / "metadata.json", {"duration_sec": seconds, "captions": captions})
                work.rename(dest)
        info = json.loads((dest / "metadata.json").read_text(encoding="utf-8"))
        return {
            **info,
            "audio_url": f"live/{key}/voice.mp3",
            "live": layers,
            "broll": [],
            "provenance": {"mode": "real", "playback": "browser"},
        }
    finally:
        lock.release()
