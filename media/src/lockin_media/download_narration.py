"""Download the exact Kokoro and English alignment weights used by the voice service."""

import os
import tempfile
from pathlib import Path

import httpx

from .storage import file_digest

KOKORO = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
WHISPER = "https://huggingface.co/Systran/faster-whisper-tiny.en/resolve/0d3d19a32d3338f10357c0889762bd8d64bbdeba/"
FILES = {
    "kokoro-v1.0.int8.onnx": "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
    "asr/config.json": "14b1b421a90349bc551b881461426b561a874049cb9e4c4864f2ca384f6a7cc5",
    "asr/model.bin": "1a5afae06a4db91c975c9a9d78be5cc110ee4ea022ad57d55492e4550e936b2a",
    "asr/tokenizer.json": "929c5252409436dce1b38a75d1abbcb5e132d170d8e324e4e04ed915fa2d22df",
    "asr/vocabulary.txt": "ff77588746d3a2595d32ab5b69ffd7b95ce2441ac57533cb66fc3eb575a115cf",
}


def download():
    root = Path(os.environ.get("LOCKIN_KOKORO_WEIGHTS", "models/kokoro")).expanduser()
    with httpx.Client(follow_redirects=True, timeout=90) as client:
        for name, expected in FILES.items():
            path = root / name
            if path.is_file() and file_digest(path) == expected:
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            url = (WHISPER if name.startswith("asr/") else KOKORO) + path.name
            with tempfile.TemporaryDirectory(dir=path.parent) as temp:
                part = Path(temp) / "download"
                with client.stream("GET", url) as response, part.open("wb") as out:
                    response.raise_for_status()
                    for chunk in response.iter_bytes():
                        out.write(chunk)
                if file_digest(part) != expected:
                    raise ValueError(f"Unexpected checksum for {name}")
                part.replace(path)


if __name__ == "__main__":
    download()
