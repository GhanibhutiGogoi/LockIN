import base64
import json

from fastapi.testclient import TestClient

from lockin_media import live, studio


def test_live_reuses_voice_without_encoding_and_serves_only_installed_assets(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCKIN_DATA_DIR", str(tmp_path))
    (tmp_path / "assets").mkdir()
    for name in ("game.mp4", "song.mp3"):
        (tmp_path / "assets" / name).write_bytes(b"installed asset")
    entries = [
        {
            "id": "game",
            "kind": "gameplay",
            "category": "runner",
            "tags": [],
            "file": "game.mp4",
            "title": "Game",
        },
        {
            "id": "song",
            "kind": "music",
            "category": "music",
            "tags": [],
            "file": "song.mp3",
            "title": "Song",
        },
    ]
    (tmp_path / "installed-starter.json").write_text(json.dumps(entries))
    calls = []

    def record(*args):
        calls.append(args)
        return {
            "audio_base64": base64.b64encode(b"recorded audio").decode(),
            "captions": [{"word": "Hello!", "start": 0, "end": 0.5}],
            "timings_ms": {"tts": 12, "alignment": 8},
        }

    monkeypatch.setattr(studio, "read_voice", record)
    monkeypatch.setattr(live, "duration", lambda _: 1)
    monkeypatch.setattr(
        studio,
        "compose",
        lambda *_: (_ for _ in ()).throw(AssertionError("Live playback must not encode a video")),
    )
    client = TestClient(studio.create_app(), base_url="http://127.0.0.1")
    req = {
        "voice_url": "https://voice.example/",
        "deck_id": "test",
        "slide_index": 0,
        "variant": {},
        "script": {"script": "Hello!"},
    }
    response = client.post("/media/live", json=req)
    assert response.status_code == 200, response.text
    media = response.json()
    assert "video_url" not in media
    assert media["duration_sec"] == 1  # Actual voice clock, no padded 30-second MP4.
    req["slide_index"] = 1
    assert client.post("/media/live", json=req).json() == media
    assert len(calls) == 1
    assert client.get("/" + media["audio_url"]).content == b"recorded audio"
    partial = client.get("/" + media["audio_url"], headers={"Range": "bytes=0-3"})
    assert partial.status_code == 206
    assert partial.content == b"reco"
    assert client.get("/" + media["live"]["gameplay"]["url"]).content == b"installed asset"
    assert client.get("/library/gameplay").json()[0]["url"].startswith("library/assets/")
    assert client.get("/library/assets/gameplay/unknown").status_code == 404
    assert client.get("/live/not-a-hash/voice.mp3").status_code == 404
    assert (
        client.post(
            "/media/live", json=req, headers={"Origin": "https://unknown.example"}
        ).status_code
        == 403
    )
    assert not list(tmp_path.rglob("video.mp4"))
    traces = [json.loads(line) for line in (tmp_path / "timings.jsonl").read_text().splitlines()]
    assert traces[0]["stages_ms"]["remote_tts"] == 12
    assert "ffmpeg_encode" not in traces[0]["stages_ms"]
    assert traces[1]["metadata"]["narration_cache_hit"] is True


def test_mismatched_narration_is_never_published(tmp_path, monkeypatch):
    from lockin_media.storage import Store

    monkeypatch.setattr(live, "select_assets", lambda *_: {})
    req = studio.RenderRequest.model_validate(
        {
            "voice_url": "https://voice.example/",
            "deck_id": "d",
            "slide_index": 0,
            "variant": {},
            "script": {"script": "Hello!"},
        }
    )
    take = studio.Recording.model_validate(
        {"audio_base64": "YWJj", "captions": [{"word": "wrong", "start": 0, "end": 1}]}
    )
    import pytest

    with pytest.raises(ValueError, match="different text"):
        live.prepare(Store(tmp_path), req, lambda: take)
    assert not list((tmp_path / "live").iterdir())
