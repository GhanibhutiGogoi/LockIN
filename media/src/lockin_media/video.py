import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from filelock import FileLock

from .audio import duration, run_ffmpeg
from .prompts import PROMPT_VERSION
from .schemas import VideoSpec
from .settings import Settings, model_lock
from .storage import Store, digest, file_digest, write_json


def build_command(s: Settings, spec: VideoSpec, output: Path) -> list[str]:
    """Official DFR CLI; no invented device_map/sharding or ignored negative prompt."""
    lock = model_lock()
    command = [str(s.video_python), "-m", "ltx_pipelines.dfr_pipeline"]
    for group in ("video", "detail"):
        cfg = lock[group]
        for flag, filename in cfg["files"].items():
            command += [f"--{flag}", str(s.model_root / cfg["directory"] / filename)]
    command += [
        "--prompt",
        spec.prompt,
        "--seed",
        str(spec.seed),
        "--width",
        str(spec.width),
        "--height",
        str(spec.height),
        "--num-frames",
        str(spec.frames),
        "--frame-rate",
        str(spec.fps),
        "--spatial-upscalings",
        "1",
        "--temporal-upscalings",
        "0",
        "--offload",
        s.video_offload,
        "--output-path",
        str(output),
    ]
    return command


def prepare_loop(raw: Path, output: Path, fps: int, blend: float = 0.5) -> None:
    """Crossfade tail into head, retaining forward motion; review the seam by eye.

    Output starts at blend seconds. Its tail ends at that same point, removing
    the raw hard cut without playing runners/marbles backwards. Not a guarantee
    of physical continuity or a perfect loop.
    """
    seconds = duration(raw)
    if seconds <= blend * 3:
        raise ValueError("Video is too short to crossfade")
    offset = seconds - 2 * blend
    graph = (
        "[0:v]split=2[body][head];"
        f"[body]trim=start={blend},setpts=PTS-STARTPTS,fps={fps},settb=AVTB[a];"
        f"[head]trim=duration={blend},setpts=PTS-STARTPTS,fps={fps},settb=AVTB[b];"
        f"[a][b]xfade=transition=fade:duration={blend}:offset={offset},format=yuv420p[v]"
    )
    run_ffmpeg(
        [
            "-i",
            str(raw),
            "-filter_complex",
            graph,
            "-map",
            "[v]",
            "-an",
            "-c:v",
            "libx264",
            "-crf",
            "18",
            "-movflags",
            "+faststart",
            str(output),
        ]
    )


def generate_video(
    s: Settings, spec: VideoSpec, *, execute: bool, source_prompt: str | None = None
) -> dict:
    store = Store(s.data_dir)
    identity = {
        "spec": spec.model_dump(),
        "model": model_lock()["video"],
        "detail": model_lock()["detail"],
        "code": model_lock()["code"]["ltx"],
        "prompt_version": PROMPT_VERSION,
        "postprocess": "crossfade-v1",
    }
    asset_id = digest(identity)
    folder = store.root / "review" / asset_id
    raw = folder / "raw.mp4"
    command = build_command(s, spec, raw)
    report = {
        "id": asset_id,
        **identity,
        "command": command,
        "environment": {"CUDA_VISIBLE_DEVICES": s.video_gpus},
        "status": "planned",
        "source_prompt": source_prompt,
    }
    if not execute:
        return report
    if not s.video_python.is_file():
        raise ValueError("LTX environment missing; run setup-runtime video --execute")
    for group in ("video", "detail"):
        cfg = model_lock()[group]
        for filename in cfg["files"].values():
            if not (s.model_root / cfg["directory"] / filename).is_file():
                raise ValueError("LTX weights missing; run download video")
    folder.mkdir(parents=True, exist_ok=True)
    with FileLock(store.root / "locks" / "video.lock", timeout=0):
        metadata = folder / "metadata.json"
        if metadata.exists() and (folder / "candidate.mp4").is_file():
            existing = json.loads(metadata.read_text())
            if existing.get("status") == "needs_review":
                return existing
        write_json(metadata, {**report, "status": "running"})
        env = os.environ.copy()
        env["CUDA_VISIBLE_DEVICES"] = s.video_gpus
        try:
            with (folder / "generation.log").open("w") as log:
                subprocess.run(
                    command,
                    env=env,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    timeout=s.video_timeout,
                    check=True,
                )
            output = folder / "candidate.mp4"
            if spec.category == "broll":
                run_ffmpeg(
                    [
                        "-i",
                        str(raw),
                        "-an",
                        "-c:v",
                        "libx264",
                        "-crf",
                        "18",
                        "-pix_fmt",
                        "yuv420p",
                        "-movflags",
                        "+faststart",
                        str(output),
                    ]
                )
            else:
                prepare_loop(raw, output, spec.fps)
            report.update(
                status="needs_review",
                file=str(output),
                duration_sec=duration(output),
                sha256=file_digest(output),
            )
            write_json(metadata, report)
        except BaseException:
            write_json(
                metadata, {**report, "status": "failed", "log": str(folder / "generation.log")}
            )
            raise
    return report


def publish_video(s: Settings, asset_id: str) -> dict:
    if len(asset_id) != 64 or any(c not in "0123456789abcdef" for c in asset_id):
        raise ValueError("Expected the 64-character generation id")
    store = Store(s.data_dir)
    folder = store.root / "review" / asset_id
    entry = json.loads((folder / "metadata.json").read_text())
    source = folder / "candidate.mp4"
    if entry["status"] != "needs_review" or file_digest(source) != entry["sha256"]:
        raise ValueError("Candidate is incomplete or changed since generation")
    destination = store.root / "assets" / f"{asset_id}.mp4"
    with tempfile.NamedTemporaryFile(dir=store.root / "tmp", delete=False) as stream:
        temp = Path(stream.name)
    try:
        shutil.copyfile(source, temp)
        os.replace(temp, destination)
    finally:
        temp.unlink(missing_ok=True)
    spec = entry["spec"]
    published = {
        "id": asset_id,
        "file": destination.name,
        "category": spec["category"],
        "energy": spec["energy"],
        "term": spec["term"],
        "source_prompt": entry.get("source_prompt"),
        "ai_generated": True,
        "model": entry["model"],
        "sha256": entry["sha256"],
    }
    write_json(store.root / "library" / f"{asset_id}.json", published)
    return published
