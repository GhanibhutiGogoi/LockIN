import json
import wave
from pathlib import Path

import pytest

from lockin_media.schemas import MediaRequest
from lockin_media.settings import Settings
from lockin_media.storage import Store, write_json


def write_wav(path, seconds=2.0, rate=24000):
    with wave.open(str(path), "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(rate)
        stream.writeframes(b"\x00\x00" * int(seconds * rate))


@pytest.fixture
def request_data():
    return json.loads((Path(__file__).parents[1] / "examples" / "rescue.json").read_text())


@pytest.fixture
def media_request(request_data):
    return MediaRequest.model_validate(request_data)


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, data_dir=tmp_path, mode="mock")


@pytest.fixture
def real_settings(tmp_path):
    s = Settings(_env_file=None, data_dir=tmp_path, mode="real", queue_timeout=5)
    Store(tmp_path)
    for voice in ("hype", "chill"):
        write_wav(tmp_path / "voices" / f"{voice}.wav")
        write_json(
            tmp_path / "voices" / f"{voice}.json",
            {"file": f"{voice}.wav", "text": f"Reference for {voice}"},
        )
    return s


class FakeModels:
    """Exercises our orchestration with synthetic silence, never neural inference."""

    def __init__(self):
        self.calls = 0
        self.fail_alignment = False

    def synthesize(self, text, voice_id, slang_level, seed, reference, output):
        self.calls += 1
        write_wav(output, seconds=len(text.split()) * 0.1)

    def align(self, text, audio):
        with wave.open(str(audio), "rb") as stream:
            total = stream.getnframes() / stream.getframerate()
        words = text.split()
        if self.fail_alignment:
            words[0] = "different"
        return [
            {"text": word, "start": i * total / len(words), "end": (i + 1) * total / len(words)}
            for i, word in enumerate(words)
        ]

    def readiness(self):
        return {"voice": True, "aligner": True}

    def close(self):
        pass
