"""Compare MP4 encoding with live preparation using a previously generated recap.

No model is called. The recording already includes music from the original MP4;
this is an isolated assembly benchmark, not a new narration-quality evaluation.
"""

import argparse
import base64
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from time import perf_counter
from unittest.mock import patch

from lockin_media import live
from lockin_media.compose_recap import compose
from lockin_media.settings import Settings
from lockin_media.storage import Store
from lockin_media.studio import Recording, RenderRequest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    script, media = fixture["script"]["result"], fixture["media"]["result"]
    store = Store(Settings().data_dir)
    source = (store.root / media["video_url"]).resolve()
    if not source.is_relative_to(store.root) or not source.is_file():
        raise ValueError("The verified recap must exist inside the media data directory")
    req = RenderRequest.model_validate(
        {
            "voice_url": "http://127.0.0.1:18114/",
            "deck_id": "assembly-benchmark",
            "slide_index": 0,
            "script": script,
            "variant": script["variant"],
        }
    )
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        voice = root / "voice.mp3"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(source), "-vn", str(voice)],
            check=True,
            timeout=60,
        )
        work = root / "compiled"
        work.mkdir()
        shutil.copyfile(voice, work / "voice.mp3")
        start = perf_counter()
        compose(store, work, req, [dict(c) for c in media["captions"]], "0" * 64)
        compiled_seconds = perf_counter() - start
        take = Recording.model_validate(
            {
                "audio_base64": base64.b64encode(voice.read_bytes()).decode(),
                "captions": media["captions"],
            }
        )
        layers = live.select_assets(store, req)
        with patch.object(live, "select_assets", return_value=layers):
            live_store = Store(root / "live-data")
            start = perf_counter()
            result = live.prepare(live_store, req, lambda: take)
            live_seconds = perf_counter() - start
        report = {
            "reused_recording": True,
            "includes_llm_or_tts": False,
            "compiled_seconds": round(compiled_seconds, 3),
            "live_seconds": round(live_seconds, 3),
            "narration_seconds": result["duration_sec"],
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report))


if __name__ == "__main__":
    main()
