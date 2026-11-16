from concurrent.futures import ThreadPoolExecutor

import pytest
from conftest import FakeModels
from fastapi.testclient import TestClient

from lockin_media.alignment import AlignmentError
from lockin_media.api import create_app
from lockin_media.service import MediaService
from lockin_media.storage import write_json


def test_mock_matches_ui_contract_and_identifies_estimated_timings(settings, request_data):
    with TestClient(create_app(settings)) as client:
        r = client.post("/media", json=request_data)
        assert r.status_code == 200
        result = r.json()
        text = request_data["script"]["hook"] + " " + request_data["script"]["script"]
        assert [c["word"] for c in result["captions"]] == text.split()
        assert "audio_url" not in result
        assert result["provenance"]["mode"] == "mock"
        assert result["provenance"]["model_inference"] is False
        assert client.get("/library/gameplay").json() == []
        assert client.get("/readyz").json()["mode"] == "mock"


@pytest.mark.parametrize("voice,pacing", [("missing", 1), ("hype", 0), ("hype", 4)])
def test_rejects_unsupported_variants(settings, request_data, voice, pacing):
    request_data["variant"].update(voice_id=voice, pacing=pacing)
    with TestClient(create_app(settings)) as client:
        assert client.post("/media", json=request_data).status_code == 422


def test_real_audio_range_and_cache(real_settings, request_data):
    backend = FakeModels()
    service = MediaService(real_settings, backend)
    with TestClient(create_app(real_settings, service)) as client:
        response = client.post("/media", json=request_data)
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["provenance"]["timing"] == "forced-aligned"
        assert result["captions"][-1]["end"] <= result["duration_sec"]
        asset = client.get("/" + result["audio_url"], headers={"Range": "bytes=0-31"})
        assert asset.status_code == 206
        assert len(asset.content) == 32
        assert "Content-Range" in asset.headers
        assert client.post("/media", json=request_data).json() == result
        assert backend.calls == 1
        assert client.get("/cache/anything.json").status_code == 404
        assert client.get("/voices/hype.wav").status_code == 404


def test_voice_speed_and_text_invalidate_cache(real_settings, media_request):
    backend = FakeModels()
    service = MediaService(real_settings, backend)
    outputs = [service.render(media_request).audio_url]
    for voice, speed in (("chill", 1.1), ("hype", 1.2)):
        req = media_request.model_copy(deep=True)
        req.variant.voice_id, req.variant.pacing = voice, speed
        outputs.append(service.render(req).audio_url)
    req = media_request.model_copy(deep=True)
    req.script.hook = "Another introduction."
    outputs.append(service.render(req).audio_url)
    assert len(set(outputs)) == backend.calls == 4


def test_duplicate_requests_synthesize_once(real_settings, media_request):
    backend = FakeModels()
    service = MediaService(real_settings, backend)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(service.render, [media_request, media_request]))
    assert results[0].audio_url == results[1].audio_url
    assert backend.calls == 1


def test_failed_alignment_does_not_publish_audio(real_settings, media_request):
    backend = FakeModels()
    backend.fail_alignment = True
    service = MediaService(real_settings, backend)
    with pytest.raises(AlignmentError):
        service.render(media_request)
    assert not list((real_settings.data_dir / "assets").iterdir())
    assert not list((real_settings.data_dir / "cache").iterdir())


def test_library_changes_do_not_regenerate_voice(real_settings, media_request):
    backend = FakeModels()
    service = MediaService(real_settings, backend)
    assert not service.render(media_request).broll
    term = media_request.script.key_terms[0]
    (real_settings.data_dir / "assets" / "broll.mp4").write_bytes(b"fixture")
    entry = {
        "id": "broll",
        "file": "broll.mp4",
        "category": "broll",
        "term": term.term,
        "source_prompt": term.broll_prompt,
        "energy": 0.2,
    }
    write_json(real_settings.data_dir / "library" / "broll.json", entry)
    result = service.render(media_request)
    assert len(result.broll) == 1 and result.broll[0].at is not None
    assert backend.calls == 1
    entry["source_prompt"] = "Different scientific meaning"
    write_json(real_settings.data_dir / "library" / "broll.json", entry)
    assert not service.render(media_request).broll


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:5180",
        "http://127.0.0.1:5180",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
)
def test_cors_is_limited_to_configured_ui(settings, origin):
    with TestClient(create_app(settings)) as client:
        r = client.options(
            "/media",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert r.status_code == 200
        assert r.headers["access-control-allow-origin"] == origin
        assert (
            client.get("/library/gameplay", headers={"Origin": origin}).headers[
                "access-control-allow-origin"
            ]
            == origin
        )
        r = client.get("/healthz", headers={"Origin": "https://unrelated.example"})
        assert "access-control-allow-origin" not in r.headers


def test_missing_reference_fails_in_real_mode(real_settings, request_data):
    (real_settings.data_dir / "voices" / "hype.json").unlink()
    service = MediaService(real_settings, FakeModels())
    with TestClient(create_app(real_settings, service)) as client:
        assert client.get("/readyz").status_code == 503
        assert client.post("/media", json=request_data).status_code == 503
