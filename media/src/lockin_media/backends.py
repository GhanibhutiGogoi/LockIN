from pathlib import Path

import httpx
import msgpack

from .prompts import directed_text
from .settings import Settings


class HttpModels:
    """Speak to isolated, persistent model servers; importing this needs no torch."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = httpx.Client(timeout=settings.request_timeout, trust_env=False)

    def close(self):
        self.client.close()

    def synthesize(
        self,
        text: str,
        voice_id: str,
        slang_level: str,
        seed: int,
        reference: dict | None,
        output: Path,
    ) -> None:
        body = {
            "text": directed_text(text, voice_id, slang_level),
            "format": "wav",
            "streaming": False,
            "normalize": False,
            "single_chunk": False,
            "seed": seed,
            "temperature": 0.7,
            "top_p": 0.7,
            "top_k": 30,
            "max_new_tokens": 1024,
            "use_memory_cache": "on",
            "references": [],
        }
        if reference:
            body["references"] = [
                {"audio": reference["path"].read_bytes(), "text": reference["text"], "speaker": 0}
            ]
        headers = {"Content-Type": "application/msgpack"}
        key = self.settings.fish_api_key.get_secret_value()
        if key:
            headers["Authorization"] = f"Bearer {key}"
        response = self.client.post(
            self.settings.fish_url.rstrip("/") + "/v1/tts",
            content=msgpack.packb(body, use_bin_type=True),
            headers=headers,
        )
        response.raise_for_status()
        if len(response.content) > 32 * 1024 * 1024 or not response.content.startswith(b"RIFF"):
            raise ValueError("Fish server did not return a bounded WAV response")
        output.write_bytes(response.content)

    def align(self, text: str, audio: Path) -> list[dict]:
        with audio.open("rb") as stream:
            response = self.client.post(
                self.settings.aligner_url.rstrip("/") + "/align",
                data={"text": text},
                files={"audio": ("voice.wav", stream, "audio/wav")},
            )
        response.raise_for_status()
        return response.json()["words"]

    def readiness(self) -> dict:
        out = {}
        for name, url in (
            ("voice", self.settings.fish_url.rstrip("/") + "/v1/health"),
            ("aligner", self.settings.aligner_url.rstrip("/") + "/healthz"),
        ):
            try:
                r = self.client.get(url, timeout=2)
                out[name] = r.is_success
            except httpx.HTTPError:
                out[name] = False
        return out
