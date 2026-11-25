import json
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

from fastapi.testclient import TestClient

from lockin_media import script_cache, script_writer, studio
from lockin_media.storage import Store


def draft():
    return {
        "hook": "Look!",
        "script": "The median splits data.",
        "plain_summary": "Median.",
        "quiz": [],
    }


def request():
    return script_writer.ScriptRequest.model_validate(
        {
            "slide": {"title": "Median", "text": "The median splits ordered data."},
            "variant": {"quiz_count": 0},
        }
    )


def test_cache_deduplicates_and_invalidates(tmp_path, monkeypatch):
    calls = []

    def write(*args):
        calls.append(args)
        return draft()

    monkeypatch.setattr(script_cache, "write_script", write)
    store = Store(tmp_path)
    writer = script_writer.Writer(_env_file=None)
    with ThreadPoolExecutor(2) as pool:
        results = list(
            pool.map(lambda _: script_cache.cached_script(store, writer, request(), {}), range(2))
        )
    assert results[0] == results[1]
    assert len(calls) == 1
    for changed in (
        writer.model_copy(update={"model": "other"}),
        writer.model_copy(update={"reasoning_effort": "minimal"}),
    ):
        script_cache.cached_script(store, changed, request(), {})
    assert len(calls) == 3
    req = request()
    req.slide.text = "Different learning material"
    script_cache.cached_script(store, writer, req, {})
    assert len(calls) == 4


def test_failed_scripts_are_not_cached(tmp_path, monkeypatch):
    def fail(*_):
        raise ValueError("Invalid model JSON")

    import pytest

    monkeypatch.setattr(script_cache, "write_script", fail)
    with pytest.raises(ValueError):
        script_cache.cached_script(Store(tmp_path), script_writer.Writer(), request(), {})
    assert not list((tmp_path / "cache").glob("script-*.json"))


def test_expired_or_corrupt_cache_regenerates_utf8(tmp_path, monkeypatch):
    import os

    calls = []

    def write(*_):
        calls.append(1)
        return {**draft(), "plain_summary": "中位数 📚"}

    monkeypatch.setattr(script_cache, "write_script", write)
    store = Store(tmp_path)
    writer = script_writer.Writer(_env_file=None)
    script_cache.cached_script(store, writer, request(), {})
    cached = next((tmp_path / "cache").glob("script-*.json"))
    assert "📚" in cached.read_text(encoding="utf-8")
    os.utime(cached, (0, 0))
    script_cache.cached_script(store, writer, request(), {})
    cached.write_text("broken", encoding="utf-8")
    script_cache.cached_script(store, writer, request(), {})
    assert len(calls) == 3


def test_real_writer_path_reports_model_and_cache_without_logging_text(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCKIN_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("LOCKIN_LLM_PROVIDER", "codex")
    monkeypatch.setattr(script_writer.Writer, "check", lambda _: None)
    calls = []

    def run(command, **kwargs):
        from pathlib import Path

        calls.append(command)
        assert "Available IDs" not in kwargs["input"]
        (Path(kwargs["cwd"]) / "result.txt").write_text(json.dumps(draft()), encoding="utf-8")
        return SimpleNamespace(stdout="", stderr="model: confirmed-model\nreasoning effort: low\n")

    monkeypatch.setattr(script_writer.subprocess, "run", run)
    client = TestClient(studio.create_app(), base_url="http://127.0.0.1")
    first = client.post("/scripts", json=request().model_dump())
    second = client.post("/scripts", json=request().model_dump())
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert len(calls) == 1
    assert "llm;dur=" in first.headers["Server-Timing"]
    assert "llm;dur=" not in second.headers["Server-Timing"]
    logs = [json.loads(line) for line in (tmp_path / "timings.jsonl").read_text().splitlines()]
    assert logs[0]["metadata"]["actual_model"] == "confirmed-model"
    assert logs[1]["metadata"]["script_cache_hit"] is True
    assert logs[0]["request_id"] != logs[1]["request_id"]
    assert request().slide.text not in json.dumps(logs)


def test_narration_reports_separate_stages(monkeypatch):
    import sys

    from lockin_media import narration

    class Backend:
        voices = {}

        def __init__(self, _):
            pass

        def synthesize(self, *args):
            pass

        def align(self, *_):
            return [{"text": "Hello", "start": 0, "end": 1}]

    monkeypatch.setitem(sys.modules, "lockin_media.kokoro", SimpleNamespace(CpuModels=Backend))
    monkeypatch.setenv("LOCKIN_KOKORO_WEIGHTS", "unused")
    monkeypatch.setattr(narration, "pace_audio", lambda *_: None)
    monkeypatch.setattr(narration, "duration", lambda _: 1)
    monkeypatch.setattr(narration, "encode_soundtrack", lambda _, p: p.write_bytes(b"audio"))
    client = TestClient(narration.create_app())
    response = client.post("/narration", json={"text": "Hello"})
    assert response.status_code == 200
    assert set(response.json()["timings_ms"]) == {
        "queue",
        "tts",
        "pace",
        "audio_probe",
        "alignment",
        "audio_encode",
    }
