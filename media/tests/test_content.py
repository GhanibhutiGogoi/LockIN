import json

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from lockin_media.api import create_app
from lockin_media.content import MAX_JSON_BYTES
from lockin_media.settings import Settings


def test_discovery_and_unconfigured_scripts(settings):
    with TestClient(create_app(settings)) as client:
        health = client.get("/healthz").json()
        assert health["service"] == "lockin-media"
        assert health["capabilities"] == {"media": True, "scripts": False, "deck_import": False}
        assert client.post("/scripts", json={}).status_code == 503


def test_gateway_uses_only_configured_upstream_and_server_credentials(settings, monkeypatch):
    settings.content_url = "http://content.internal/v1/"
    settings.content_api_key = Settings(content_api_key="private-token").content_api_key
    seen = []

    def upstream(request):
        seen.append(request)
        return httpx.Response(200, json={"hook": "From the actual content service"})

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(upstream), **kwargs),
    )
    with TestClient(create_app(settings)) as client:
        assert client.get("/healthz").json()["capabilities"]["scripts"] is True
        payload = {"slide": {"text": "An actual slide"}, "variant": {"target_seconds": 20}}
        response = client.post("/scripts", json=payload, headers={"Cookie": "browser-secret=yes"})
        assert response.json() == {"hook": "From the actual content service"}
        assert str(seen[0].url) == "http://content.internal/v1/scripts"
        assert json.loads(seen[0].content) == payload
        assert seen[0].headers["Authorization"] == "Bearer private-token"
        assert "cookie" not in seen[0].headers
        assert "private-token" not in response.text
        assert client.post("/feedback/wrong-fact", json={"retracted": True}).status_code == 200
        assert seen[-1].url.path == "/v1/feedback/wrong-fact"


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(500, text="secret"),
        httpx.Response(200, text="<html>"),
        httpx.Response(302, headers={"Location": "http://elsewhere"}),
    ],
)
def test_gateway_errors_do_not_expose_upstream(settings, monkeypatch, response):
    settings.content_url = "http://content.internal/"
    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(lambda r: response), **kwargs),
    )
    with TestClient(create_app(settings)) as client:
        result = client.post("/scripts", json={})
        assert result.status_code == 502
        assert "secret" not in result.text and "content.internal" not in result.text


def test_gateway_rejects_invalid_and_large_requests(settings):
    settings.content_url = "http://content.internal/"
    with TestClient(create_app(settings)) as client:
        assert client.post("/scripts", content=b"invalid").status_code == 400
        assert client.post("/scripts", content=b"x" * (MAX_JSON_BYTES + 1)).status_code == 413


@pytest.mark.parametrize(
    "url", ["file:///tmp/data", "http://user:pass@host", "https://host/?token=secret"]
)
def test_upstream_requires_plain_http_base(url):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, content_url=url)
