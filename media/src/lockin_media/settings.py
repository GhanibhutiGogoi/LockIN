import json
from importlib.resources import files
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def model_lock() -> dict:
    return json.loads(files("lockin_media").joinpath("models.json").read_text())


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LOCKIN_", env_file=".env", extra="ignore")

    mode: Literal["mock", "real"] = "mock"
    data_dir: Path = Path("data")
    model_root: Path = Path("models")
    cors_origins: list[str] = [
        "http://localhost:5180",
        "http://127.0.0.1:5180",
        "http://localhost:5181",
        "http://127.0.0.1:5181",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    fish_url: str = "http://127.0.0.1:8021"
    aligner_url: str = "http://127.0.0.1:8022"
    fish_api_key: SecretStr = SecretStr("")
    voice_devices: str = "cuda:0,cuda:1,cuda:2,cuda:3"
    content_url: str = ""
    content_api_key: SecretStr = SecretStr("")
    request_timeout: float = Field(default=45, gt=0, le=3600)
    queue_timeout: float = Field(default=3, ge=0, le=60)
    video_python: Path = Path("vendor/ltx/.venv/bin/python")
    video_gpus: str = "0"
    video_offload: Literal["cpu", "disk", "none"] = "cpu"
    video_timeout: int = Field(default=7200, gt=0)
    music_file: Path | None = None

    @field_validator("content_url")
    @classmethod
    def content_base_url(cls, value):
        value = value.strip()
        if not value:
            return ""
        parsed = urlsplit(value)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("LOCKIN_CONTENT_URL must be an HTTP(S) base URL without credentials")
        return value.rstrip("/") + "/"

    @field_validator("music_file", mode="before")
    @classmethod
    def empty_music(cls, value):
        return None if value == "" else value

    @field_validator("data_dir", "model_root", "video_python", "music_file")
    @classmethod
    def absolute(cls, value):
        return value.expanduser().resolve() if value is not None else value
