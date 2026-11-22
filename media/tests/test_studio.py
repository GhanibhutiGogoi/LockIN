import base64
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from lockin_media import studio


def test_studio_only_sends_spoken_words_and_publishes_one_deletable_recap(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCKIN_DATA_DIR", str(tmp_path))
    calls = []

    def recording(req, endpoint, payload):
        calls.append((req.endpoint(endpoint), payload))
        return {
            "audio_base64": base64.b64encode(b"example").decode(),
            "captions": [{"word": "Hello!", "start": 0, "end": 0.5}],
        }

    def compose(store, work, req, captions, key):
        assert (work / "voice.mp3").read_bytes() == b"example"
        (work / "video.mp4").write_bytes(b"finished MP4")
        (work / "captions.ass").touch()
        return dict(duration_sec=30, captions=captions, gameplay="game", music="track", bytes=12)

    monkeypatch.setattr(studio, "read_voice", recording)
    monkeypatch.setattr(studio, "compose", compose)
    client = TestClient(studio.create_app(), base_url="http://127.0.0.1")
    request = {
        "voice_url": "https://voice.example/api",
        "deck_id": "private-deck-id",
        "slide_index": 3,
        "variant": {},
        "script": {"script": "Hello!"},
    }
    result = client.post("/media", json=request)
    assert result.status_code == 200, result.text
    clip = result.json()
    assert client.post("/media", json=request).json() == clip
    assert calls == [
        (
            "https://voice.example/api/narration",
            {"text": "Hello!", "voice_id": "hype", "pacing": 1.1},
        )
    ]
    assert [v["id"] for v in client.get("/recaps").json()] == [clip["id"]]
    assert client.get("/" + clip["video_url"]).content == b"finished MP4"
    delete_url = "/recaps/" + clip["id"]
    assert (
        client.delete(delete_url, headers={"Origin": "https://unknown.example"}).status_code == 403
    )
    assert client.delete(delete_url).status_code == 204
    assert client.get("/" + clip["video_url"]).status_code == 404
    assert client.get("/recaps").json() == []
    assert not list((tmp_path / "tmp").iterdir())

    def fail(*args):
        raise ValueError("composition failed")

    monkeypatch.setattr(studio, "compose", fail)
    assert client.post("/media", json=request).status_code == 502
    assert client.get("/recaps").json() == []
    assert not list((tmp_path / "tmp").iterdir())


def test_token_writer_sends_current_slide_and_keeps_token_in_header(monkeypatch):
    from lockin_media import script_writer

    writer = script_writer.Writer(
        provider="api", model="test", api_key="fixture", base_url="https://gateway.example/v1"
    )
    calls = []

    def post(url, **kwargs):
        calls.append((url, kwargs))
        draft = {
            "hook": "Look!",
            "script": "It falls.",
            "plain_summary": "Gravity.",
            "quiz": [],
            "gameplay_id": "run",
            "music_id": "beat",
        }
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={"choices": [{"message": {"content": json.dumps(draft)}}]},
        )

    monkeypatch.setattr(script_writer.httpx, "post", post)
    req = script_writer.ScriptRequest.model_validate(
        {
            "slide": {"text": "Gravity.", "title": "Orbit"},
            "neighbour_titles": ["Private future slide"],
            "variant": {"quiz_count": 0},
        }
    )
    result = script_writer.write_script(
        writer, req, {"gameplay": {"run": ["Running"]}, "music": {"beat": ["Beat"]}}
    )
    assert result["music_id"] == "beat"
    url, args = calls[0]
    assert url == "https://gateway.example/v1/chat/completions"
    assert args["headers"]["Authorization"] == "Bearer fixture"
    assert "fixture" not in str(args["json"])
    assert "Private future slide" not in str(args["json"])


@pytest.mark.parametrize(
    ("filters", "encoders", "missing"),
    [
        (
            " ... subtitles V->V Uses libass",
            " V....D libx264 H.264\n A..... aac AAC",
            ["ass filter"],
        ),
        (
            " ... ass V->V",
            " V....D libx264rgb H.264\n A..... libfdk_aac AAC",
            ["libx264 encoder", "aac encoder"],
        ),
        (" ... ass V->V", " V....D libx264 H.264\n A..... aac AAC", []),
    ],
)
def test_connection_names_missing_ffmpeg_capabilities(
    tmp_path, monkeypatch, filters, encoders, missing
):
    monkeypatch.setenv("LOCKIN_DATA_DIR", str(tmp_path / "data"))
    from lockin_media import compose_recap

    monkeypatch.setattr(compose_recap.shutil, "which", lambda name: name)
    monkeypatch.setattr(compose_recap.subprocess, "run", lambda args, **kwargs:
                        SimpleNamespace(stdout=filters if args[-1] == "-filters" else encoders))
    monkeypatch.setattr(studio.Writer, "check", lambda self: None)
    monkeypatch.setattr(studio.Store, "starter", lambda self, kind: [{"id": "fixture"}])

    def ready(*_):
        assert not missing, "An incompatible workstation should fail before calling the voice host"
        return {"service": "lockin-narration", "api_version": 1, "ready": True}

    monkeypatch.setattr(studio, "read_voice", ready)
    with TestClient(studio.create_app(), base_url="http://127.0.0.1") as client:
        result = client.post("/connection", json={"voice_url": "https://voice.example/"})
        if missing:
            assert result.status_code == 422
            assert all(item in result.json()["detail"] for item in missing)
        else:
            assert result.status_code == 200


def test_studio_accepts_windows_gaze_origin(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCKIN_DATA_DIR", str(tmp_path))
    client = TestClient(studio.create_app(), base_url="http://127.0.0.1")
    response = client.get("/recaps", headers={"Origin": "http://127.0.0.1:5181"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5181"


def test_cli_writer_uses_utf8_for_chinese_source_and_output(monkeypatch):
    from pathlib import Path
    from lockin_media import script_writer

    monkeypatch.setattr(script_writer.Writer, "check", lambda self: None)
    draft = {"hook": "A surprise!", "script": "The median splits the data.",
             "plain_summary": "中位数", "quiz": []}

    def run(command, **kwargs):
        assert kwargs["encoding"] == "utf-8"
        assert "数据" in kwargs["input"]
        (Path(kwargs["cwd"]) / "result.txt").write_text(json.dumps(draft, ensure_ascii=False), encoding="utf-8")
        return SimpleNamespace(stdout="")

    monkeypatch.setattr(script_writer.subprocess, "run", run)
    req = script_writer.ScriptRequest.model_validate({
        "slide": {"text": "数据中的中位数", "title": "Data"}, "variant": {"quiz_count": 0}})
    result = script_writer.write_script(script_writer.Writer(provider="codex"), req, {})
    assert result["plain_summary"] == "中位数"
