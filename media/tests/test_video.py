import json

import pytest

from lockin_media.audio import duration, run_ffmpeg
from lockin_media.prompts import VIDEO_PRESETS
from lockin_media.schemas import VideoSpec
from lockin_media.storage import Store, file_digest, write_json
from lockin_media.video import generate_video, prepare_loop, publish_video


@pytest.mark.parametrize("kw", [{"frames": 120}, {"width": 701}, {"height": 513}])
def test_invalid_ltx_shapes_fail_before_loading_models(kw):
    with pytest.raises(ValueError):
        VideoSpec(prompt=VIDEO_PRESETS["marble"], category="marble", **kw)


def test_plan_has_pinned_components_and_no_inference(settings):
    spec = VideoSpec(prompt=VIDEO_PRESETS["runner"], category="runner")
    result = generate_video(settings, spec, execute=False)
    command = result["command"]
    assert result["status"] == "planned"
    assert "ltx_pipelines.dfr_pipeline" in command
    assert "--offload" in command and "cpu" in command
    assert "--detailing-lora" in command
    assert "--negative-prompt" not in command  # Distilled DFR does not take one.
    assert "--quantization" not in command
    assert not list((settings.data_dir / "assets").iterdir())


def test_loop_processing_is_forward_only_and_publish_requires_review(settings):
    store = Store(settings.data_dir)
    raw = settings.data_dir / "tmp" / "raw.mp4"
    run_ffmpeg(
        [
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=128x128:rate=24:duration=3",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(raw),
        ]
    )
    candidate = settings.data_dir / "tmp" / "candidate.mp4"
    prepare_loop(raw, candidate, 24)
    assert duration(candidate) == pytest.approx(2.5, abs=0.1)
    assert not store.gameplay()
    asset_id = "a" * 64
    folder = settings.data_dir / "review" / asset_id
    folder.mkdir()
    (folder / "candidate.mp4").write_bytes(candidate.read_bytes())
    write_json(
        folder / "metadata.json",
        {
            "status": "needs_review",
            "sha256": file_digest(candidate),
            "model": {"id": "fixture"},
            "spec": {"category": "marble", "energy": 0.5, "term": None},
        },
    )
    publish_video(settings, asset_id)
    assert store.gameplay()[0]["url"] == f"assets/{asset_id}.mp4"
    metadata = json.loads((folder / "metadata.json").read_text())
    metadata["status"] = "failed"
    write_json(folder / "metadata.json", metadata)
    with pytest.raises(ValueError):
        publish_video(settings, asset_id)


def test_publish_rejects_paths(settings):
    with pytest.raises(ValueError):
        publish_video(settings, "../../private")
