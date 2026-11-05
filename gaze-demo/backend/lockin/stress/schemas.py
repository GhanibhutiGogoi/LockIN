from typing import Literal
from pydantic import Field,model_validator
from ..schemas import Strict
from .features import SCHEMA,validate_values


class StartStress(Strict):
    mode:Literal['live','replay']='replay'


class FeatureFrame(Strict):
    t_ms:float=Field(ge=0,le=14400000)
    valid:bool=False
    feature_schema:Literal[SCHEMA]=SCHEMA
    values:list[float]|None=Field(default=None,max_length=52)

    @model_validator(mode='after')
    def valid_scores(self):
        if self.valid:validate_values(self.values)
        elif self.values is not None:raise ValueError('invalid frames must not carry usable scores')
        return self


class ReplayState(Strict):
    t_ms:float=Field(ge=0,le=14400000)
    state:Literal['possible_tension','no_clear_tension','unknown']


class EventAction(Strict):
    kind:Literal['shown','dismiss']
    t_ms:float=Field(ge=0,le=14400000)


class Feedback(Strict):
    helpful:bool
    before:int|None=Field(default=None,ge=0,le=10)
    after:int|None=Field(default=None,ge=0,le=10)
    note:str=Field(default='',max_length=1000)

    @model_validator(mode='after')
    def rating_pair(self):
        if (self.before is None)!=(self.after is None):raise ValueError('provide both retrospective ratings or neither')
        return self


class Exclusion(Strict):
    excluded:bool


class SelfReport(Strict):
    rating:int=Field(ge=0,le=10,strict=True)
