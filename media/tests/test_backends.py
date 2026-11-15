import httpx
import msgpack

from lockin_media.backends import HttpModels


def test_fish_native_wire_format_keeps_directions_out_of_caption_script(settings, tmp_path):
    calls = []

    def handler(req):
        calls.append(req)
        assert req.url.path == "/v1/tts"
        assert req.headers["content-type"] == "application/msgpack"
        body = msgpack.unpackb(req.content, raw=False)
        assert body["text"].startswith("[") and body["text"].endswith("Hello, bestie!")
        assert body["references"][0]["audio"] == b"reference bytes"
        assert body["references"][0]["speaker"] == 0
        assert body["format"] == "wav" and not body["streaming"]
        assert not body["single_chunk"] and not body["normalize"]
        return httpx.Response(200, content=b"RIFFsynthetic-wire-fixture")

    model = HttpModels(settings)
    model.client.close()
    model.client = httpx.Client(transport=httpx.MockTransport(handler))
    reference = tmp_path / "ref.wav"
    reference.write_bytes(b"reference bytes")
    model.synthesize(
        "Hello, bestie!",
        "hype",
        "mild",
        42,
        {"path": reference, "text": "The reference transcript"},
        tmp_path / "out.wav",
    )
    assert len(calls) == 1
    model.close()
