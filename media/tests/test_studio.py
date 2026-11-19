import base64
import json

import httpx
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
