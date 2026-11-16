from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Gaze(Strict):
    valid: bool = False
    calibrated: bool = False
    on_screen: bool | None = None
    x: FiniteFloat | None = None
    y: FiniteFloat | None = None


class Screen(Strict):
    kind: Literal['study','entertainment','other','unknown'] = 'unknown'
    task_related: bool | None = None
    confidence: float = Field(default=0,ge=0,le=1)
    context: str = Field(default='',max_length=2000)


class Observation(Strict):
    t_ms: float = Field(ge=0)
    gaze: Gaze = Field(default_factory=Gaze)
    screen: Screen = Field(default_factory=Screen)
    activity: float = Field(default=0,ge=0,le=1)
    source: Literal['model','manual','replay'] = 'manual'


class NewUser(Strict):
    name: str = Field(min_length=1,max_length=80)


class Start(Strict):
    goal: str = Field(min_length=1,max_length=2000)
    study_context: str = Field(default='',max_length=2000)
    mode: Literal['live','replay'] = 'live'
    style: Literal['plain','analogy','humor'] = 'plain'


class Media(Strict):
    event_id: str = Field(min_length=1,max_length=100)
    kind: Literal['play','progress','pause','ended','abort']
    t_ms: float = Field(ge=0)
    position_s: float = Field(default=0,ge=0,le=3600)


class Answer(Strict):
    t_ms: float = Field(ge=0)
    answer: str = Field(min_length=1,max_length=2000)


class Correction(Strict):
    false_alarm: bool
    note: str = Field(default='',max_length=2000)


class Annotation(Strict):
    start_ms: float = Field(ge=0)
    end_ms: float = Field(gt=0)
    label: Literal['on-task','off-task','unknown']
    note: str = Field(default='',max_length=2000)


class Frame(Strict):
    t_ms: float = Field(ge=0)
    gaze: Gaze
    activity: float = Field(ge=0,le=1)
    image: str = Field(max_length=2000000)
    consent: bool = False
