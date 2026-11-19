from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel


class WireModel(BaseModel):
    # The UI sends snake_case; accept camelCase for direct callers too.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


class Variant(WireModel):
    id: str = Field(default="default", max_length=200)
    target_seconds: Literal[20, 30, 40, 60] = 20
    slang_level: Literal["plain", "mild", "unhinged"] = "mild"
    humour_style: Literal["memes", "analogies", "roasts"] = "memes"
    voice_id: Literal["hype", "chill"] = "hype"
    pacing: float = Field(default=1.1, ge=0.75, le=1.35, allow_inf_nan=False)
    gameplay_type: str = Field(default="runner", max_length=80)
    recap_or_preview: Literal["recap", "preview"] = "recap"
    quiz_count: Literal[0, 1, 2] = 1


class KeyTerm(WireModel):
    term: str = Field(min_length=1, max_length=100)
    broll_prompt: str = Field(default="", max_length=1500)


class Script(WireModel):
    hook: str = Field(default="", max_length=500)
    script: str = Field(min_length=1, max_length=3500)
    key_terms: list[KeyTerm] = Field(default_factory=list, max_length=5)


class MediaRequest(WireModel):
    deck_id: str = Field(min_length=1, max_length=200)
    slide_index: int = Field(ge=0)
    script: Script
    variant: Variant

    @property
    def spoken_text(self) -> str:
        return " ".join(f"{self.script.hook} {self.script.script}".split())

    @model_validator(mode="after")
    def check_spoken_text(self):
        text = self.spoken_text
        if not text or len(text.split()) > 240:
            raise ValueError("Narration must contain 1–240 whitespace-separated words")
        # Delivery directions are owned by the service, not spoken script tokens.
        if "[" in text or "]" in text or "<|" in text:
            raise ValueError("Narration must be spoken words, without audio tags or markup")
        return self


class Caption(WireModel):
    word: str
    start: float = Field(ge=0, allow_inf_nan=False)
    end: float = Field(ge=0, allow_inf_nan=False)


class Broll(WireModel):
    term: str
    url: str
    kind: Literal["video", "image"] = "video"
    at: float | None = None
    duration: float = 2.6


class MediaResponse(WireModel):
    audio_url: str | None = None
    captions: list[Caption]
    duration_sec: float
    broll: list[Broll] = Field(default_factory=list)
    # Optional contract extension, ignored by the existing UI.
    provenance: dict = Field(default_factory=dict)


class VideoSpec(BaseModel):
    prompt: str = Field(min_length=20, max_length=4000)
    category: Literal["runner", "parkour", "kinetic-sand", "marble", "broll"]
    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    width: int = Field(default=1280, ge=256, le=1920)
    height: int = Field(default=1024, ge=256, le=1920)
    frames: int = Field(default=121, ge=33, le=257)
    fps: Literal[24, 25, 30] = 24
    energy: float = Field(default=0.6, ge=0, le=1)
    term: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def dimensions(self):
        if self.width % 64 or self.height % 64:
            raise ValueError("LTX two-stage width and height must be multiples of 64")
        if (self.frames - 1) % 8:
            raise ValueError("LTX frames must be 8*k + 1")
        if self.category == "broll" and not self.term:
            raise ValueError("B-roll requires a key term")
        return self
