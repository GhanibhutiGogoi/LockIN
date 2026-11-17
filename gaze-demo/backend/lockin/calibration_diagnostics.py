"""Persist metadata-only Web gaze calibration attempts on this machine."""
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Annotated, Literal
from uuid import UUID

from fastapi import FastAPI
from pydantic import Field

from .schemas import Strict


Count = Annotated[int, Field(ge=0, le=1_000_000)]
Dimension = Annotated[int, Field(ge=0, le=32768)]
Duration = Annotated[int, Field(ge=0, le=86_400_000)]
Finite = Annotated[float, Field(allow_inf_nan=False)]
Pair = tuple[Finite, Finite]


class SampleSummary(Strict):
    index: int = Field(ge=1, le=12)
    mode: Literal['calibration', 'validation', 'quick-check']
    target: Pair
    sampleCount: int = Field(ge=1, le=7)
    rawSamples: list[Pair] = Field(max_length=7)
    rawMedian: Pair
    rawMad: Pair
    rawRange: Pair
    mappedMedian: Pair
    unclippedMedian: Pair
    predicted: Pair
    clippedSamples: int = Field(ge=0, le=7)
    durationMs: float = Field(ge=0, allow_inf_nan=False)
    errorNormalized: Finite | None
    errorPx: Finite | None


class Fit(Strict):
    method: Literal['median-7-affine-v1']
    inputSingularValues: Pair
    inputConditionNumber: Finite | None
    matrix: tuple[tuple[Finite, Finite, Finite], tuple[Finite, Finite, Finite]] | None
    pointErrors: list[Finite] = Field(max_length=9)
    rmse: Finite | None


class Viewport(Strict):
    width: Dimension
    height: Dimension
    pixelRatio: float = Field(gt=0, le=16)


class Point(Strict):
    mode: Literal['calibration', 'validation', 'quick-check']
    index: int = Field(ge=1, le=12)
    total: int = Field(ge=1, le=12)
    count: int = Field(ge=0, le=32)
    elapsedMs: Duration


class Frames(Strict):
    usable: Count
    noFace: Count
    eyesUnavailable: Count
    noGaze: Count


class Validation(Strict):
    passed: bool
    meanErrorPx: float = Field(ge=0)
    maxErrorPx: float = Field(ge=0)
    maxNormalizedError: float = Field(ge=0)
    threshold: float = Field(gt=0)
    pointErrorsPx: list[Annotated[float, Field(ge=0)]] = Field(max_length=3)


class Tracker(Strict):
    issue: str | None = Field(default=None, max_length=64, pattern=r'^[a-z_]+$')
    frames: Frames
    camera: tuple[Dimension, Dimension] | None = None
    validation: Validation | None = None
    method: Literal['median-7-affine-v1'] | None = None
    fit: Fit | None = None
    points: list[SampleSummary] = Field(default_factory=list, max_length=18)


class Attempt(Strict):
    schemaVersion: Literal[1, 2] = 1
    attemptId: UUID
    startedAt: int = Field(gt=0)
    durationMs: Duration
    outcome: Literal['passed', 'failed', 'skipped', 'interrupted']
    stage: Literal['camera', 'model', 'calibration']
    cameraStatus: Literal['off', 'asking', 'on', 'paused', 'blocked', 'missing', 'skipped']
    cameraError: str | None = Field(default=None, max_length=64, pattern=r'^[A-Za-z]+$')
    model: Literal['blazegaze', 'eyetheia']
    viewport: Viewport
    points: list[Point] = Field(max_length=18)
    tracker: Tracker | None


def register(app: FastAPI, directory: Path) -> None:
    @app.post('/v1/web-screen/calibration-diagnostics', status_code=204)
    def save_calibration_diagnostic(attempt: Attempt):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        destination = directory / f'{attempt.startedAt}-{attempt.attemptId}.json'
        with NamedTemporaryFile(dir=directory, mode='w', encoding='utf-8', delete=False) as stream:
            temporary = Path(stream.name)
            try:
                stream.write(attempt.model_dump_json(indent=2) + '\n')
                stream.close()
                temporary.replace(destination)
            finally:
                temporary.unlink(missing_ok=True)
