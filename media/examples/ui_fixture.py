"""Browser smoke-test server: synthetic MP4 + silent MP3, never model output.

Run from media/: uv run python examples/ui_fixture.py
Uses a disposable data directory so fixtures cannot enter the real library/cache.
"""

import subprocess
import tempfile
from pathlib import Path

import uvicorn

from lockin_media.api import create_app
from lockin_media.service import MediaService
from lockin_media.settings import Settings
from lockin_media.storage import write_json


class FixtureService(MediaService):
    def _produce(self, req, key, reference):
        response = super()._produce(req, key, reference)
        response.audio_url = f"assets/{key}.mp3"
        response.provenance["fixture"] = "silent audio; estimated captions; no model inference"
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=24000:cl=mono",
                "-t",
                str(response.duration_sec),
                "-c:a",
                "libmp3lame",
                str(self.settings.data_dir / response.audio_url),
            ],
            check=True,
            timeout=30,
        )
        return response


def main():
    with tempfile.TemporaryDirectory(prefix="lockin-ui-fixture-") as temp:
        settings = Settings(_env_file=None, mode="mock", data_dir=Path(temp))
        service = FixtureService(settings)
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=640x360:rate=24",
                "-t",
                "3",
                "-an",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                str(settings.data_dir / "assets" / "synthetic-ui-fixture.mp4"),
            ],
            check=True,
            timeout=30,
        )
        for category in ("runner", "parkour", "kinetic-sand", "marble"):
            write_json(
                settings.data_dir / "library" / f"{category}.json",
                {
                    "id": f"synthetic-fixture-{category}",
                    "category": category,
                    "file": "synthetic-ui-fixture.mp4",
                    "energy": 0.5,
                },
            )
        print("SYNTHETIC UI FIXTURE: silent MP3 + test-pattern MP4; no models loaded.", flush=True)
        uvicorn.run(create_app(settings, service), host="127.0.0.1", port=8011)


if __name__ == "__main__":
    main()
