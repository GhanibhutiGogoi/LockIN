import hashlib
import json
from importlib.resources import files

import httpx
import pytest
from fastapi.testclient import TestClient

from lockin_media.api import create_app
from lockin_media.library import INDEX, LIMITS, Asset, install
from lockin_media.storage import Store


def catalog():
    manifest = files("lockin_media").joinpath("starter-library.json")
    return [Asset.model_validate(x) for x in json.loads(manifest.read_text())]


def test_shipped_library():
    assets = catalog()
    assert {"parkour", "runner", "obby"} <= {a.category for a in assets}
    for kind, limit in LIMITS.items():
        assert 0 < sum(a.bytes for a in assets if a.kind == kind) <= limit


def test_verified_install_repair_and_api(settings):
    store = Store(settings.data_dir)
    samples = [next(a for a in catalog() if a.kind == kind) for kind in LIMITS]
    assets = [
        a.model_copy(
            update={"bytes": len(a.id), "sha256": hashlib.sha256(a.id.encode()).hexdigest()}
        )
        for a in samples
    ]
    data = {str(a.urls[0]): a.id.encode() for a in assets}
    calls = []

    def respond(req):
        calls.append(str(req.url))
        return httpx.Response(200, content=data[str(req.url)])

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        assert install(store, assets, client)["downloaded"] == 2
        assert install(store, assets, client)["verified"] == 2
        assert len(calls) == 2
        (store.root / "assets" / assets[0].filename).write_bytes(b"damaged")
        assert install(store, assets, client)["downloaded"] == 1
    with TestClient(create_app(settings)) as api:
        for asset in assets:
            (entry,) = api.get("/library/" + asset.kind).json()
            assert entry["creator"] == asset.creator and entry["license_url"]
            response = api.get("/" + entry["url"], headers={"Range": "bytes=0-2"})
            assert response.status_code == 206
            assert response.content == asset.id.encode()[:3]


@pytest.mark.parametrize("failure", ["budget", "size", "checksum"])
def test_failure_keeps_previous_index(settings, failure):
    store = Store(settings.data_dir)
    asset = catalog()[0].model_copy(update={"bytes": 4})
    if failure == "budget":
        asset.bytes = LIMITS[asset.kind] + 1
    index = store.root / INDEX
    index.write_text("[]")

    def respond(req):
        assert failure != "budget", "Preflight must reject before any download"
        return httpx.Response(
            200, stream=httpx.ByteStream(b"12345" if failure == "size" else b"1234")
        )

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises((RuntimeError, ValueError)):
            install(store, [asset], client)
    assert index.read_text() == "[]"
    assert not list((store.root / "assets").iterdir())
    assert not list((store.root / "tmp").iterdir())


def test_update_budgets_final_catalog_and_preserves_previous_until_publish(settings, monkeypatch):
    from types import SimpleNamespace

    store = Store(settings.data_dir)
    template = catalog()[0]
    monkeypatch.setitem(LIMITS, template.kind, 10)
    content = b"oldclip"

    def asset(data):
        return template.model_copy(update={"sha256": hashlib.sha256(data).hexdigest(), "bytes": 7})

    old, new = asset(content), asset(b"newclip")

    def respond(req):
        if content == b"newclip":
            assert (store.root / "assets" / old.filename).read_bytes() == b"oldclip"
            assert store.starter(template.kind)[0]["url"] == "assets/" + old.filename
        return httpx.Response(200, content=content)

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        install(store, [old], client)
        content = b"newclip"
        with monkeypatch.context() as patch:
            patch.setattr(
                "lockin_media.library.shutil.disk_usage", lambda _: SimpleNamespace(free=6)
            )
            with pytest.raises(ValueError, match="7 free bytes"):
                install(store, [new], client)
        assert [p.name for p in (store.root / "assets").iterdir()] == [old.filename]
        assert install(store, [new], client)["downloaded"] == 1
        assert [p.name for p in (store.root / "assets").iterdir()] == [new.filename]
        assert store.starter(template.kind)[0]["url"] == "assets/" + new.filename
