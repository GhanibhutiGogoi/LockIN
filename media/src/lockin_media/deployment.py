import json
import os
import platform
import shlex
import shutil
import subprocess
from pathlib import Path

from .settings import model_lock


def setup_runtime(kind: str, root: Path, execute: bool) -> list[list[str]]:
    root = root.resolve()
    if kind == "aligner":
        commands = [
            [
                "uv",
                "sync",
                "--frozen",
                "--project",
                str(root / "runtimes" / "aligner"),
                "--python",
                "3.12",
            ]
        ]
    else:
        name = "fish" if kind == "voice" else "ltx"
        code = model_lock()["code"][name]
        checkout = root / "vendor" / name
        commands = []
        if checkout.exists():
            sha = subprocess.check_output(
                ["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True
            ).strip()
            dirty = subprocess.check_output(
                ["git", "-C", str(checkout), "status", "--porcelain"], text=True
            ).strip()
            if sha != code["revision"] or dirty:
                raise ValueError(f"{checkout} differs from the pinned clean checkout")
        else:
            commands += [
                ["git", "clone", "--filter=blob:none", "--no-checkout", code["url"], str(checkout)],
                ["git", "-C", str(checkout), "checkout", "--detach", code["revision"]],
            ]
        sync = ["uv", "sync", "--project", str(checkout), "--python", "3.12"]
        if kind == "voice":
            sync += ["--frozen", "--extra", "cu126"]
        else:
            sync += ["--frozen", "--all-packages", "--extra", "natten", "--no-dev"]
        commands.append(sync)
    if execute:
        if platform.system() != "Linux" and kind != "aligner":
            raise ValueError("Real GPU profiles target Linux; use mock or an SSH tunnel on macOS")
        for command in commands:
            print(shlex.join(command), flush=True)
            subprocess.run(command, check=True)
    return commands


def download(kind: str, root: Path):
    from huggingface_hub import snapshot_download

    groups = ["video", "detail"] if kind == "video" else [kind]
    for group in groups:
        spec = model_lock()[group]
        patterns = list(spec["files"].values()) if "files" in spec else None
        snapshot_download(
            repo_id=spec["repo"],
            revision=spec["revision"],
            local_dir=root / spec["directory"],
            allow_patterns=patterns,
        )
        # Record exactly what was requested; the download is not an inference test.
        (root / spec["directory"] / "lockin-source.json").write_text(json.dumps(spec, indent=2))


def launch_voice(
    root: Path, models: Path, devices: str, port: int, host: str = "127.0.0.1"
) -> None:
    checkout = root.resolve() / "vendor" / "fish"
    checkpoint = models / model_lock()["voice"]["directory"]
    if not (checkpoint / "config.json").is_file():
        raise ValueError("Voice weights missing; run download voice")
    command = [
        str(checkout / ".venv" / "bin" / "python"),
        "tools/api_server.py",
        "--listen",
        f"{host}:{port}",
        "--llama-checkpoint-path",
        str(checkpoint),
        "--device",
        devices,
        "--workers",
        "1",
        "--max-text-length",
        "5000",
    ]
    os.chdir(checkout)
    os.execv(command[0], command)


def launch_aligner(root: Path, models: Path, port: int, host: str = "127.0.0.1"):
    interpreter = root.resolve() / "runtimes" / "aligner" / ".venv" / "bin" / "python"
    os.environ["LOCKIN_ALIGNER_MODEL"] = str(models / model_lock()["aligner"]["directory"])
    command = [
        str(interpreter),
        "-m",
        "uvicorn",
        "lockin_media.aligner:create_app",
        "--factory",
        "--host",
        host,
        "--port",
        str(port),
        "--workers",
        "1",
    ]
    os.execv(command[0], command)


def doctor() -> dict:
    report = {
        "platform": platform.platform(),
        "executables": {name: shutil.which(name) for name in ("uv", "ffmpeg", "ffprobe")},
        "model_inference_verified": False,
    }
    if shutil.which("nvidia-smi"):
        r = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=index,name,memory.total,compute_cap,driver_version",
                "--format=csv,noheader",
            ],
            capture_output=True,
            text=True,
            timeout=15,
        )
        report["gpus"] = r.stdout.strip() if r.returncode == 0 else r.stderr.strip()
    else:
        report["gpus"] = "No nvidia-smi: mock API works, GPU inference is unavailable"
    return report
