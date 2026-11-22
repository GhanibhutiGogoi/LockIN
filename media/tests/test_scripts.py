import json
import shlex
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).parents[1] / "scripts"


@pytest.mark.parametrize(
    "name,args,expected",
    [
        ("setup-system.sh", [], "ffmpeg"),
        ("setup.sh", ["api"], "python -m lockin_media.library"),
        ("download-library.sh", [], "python -m lockin_media.library"),
        ("setup.sh", ["all"], "setup-runtime video --execute"),
        ("download-models.sh", [], "download video"),
        ("download-models.sh", ["voice"], "download voice"),
        ("start-local.sh", [], "serve-voice --devices cuda:0,cuda:1,cuda:2,cuda:3"),
        ("start-server.sh", [], "docker compose --profile real up --build -d"),
        ("initialize-voices.sh", ["local"], "create-voice hype"),
        ("initialize-voices.sh", ["server"], "create-voice chill"),
        (
            "generate-video.sh",
            ["--preset", "marble", "--execute"],
            "generate-video --preset marble --execute",
        ),
        ("generate-video.sh", [], "generate-video"),
    ],
)
def test_scripts_plan_without_installing_or_downloading(name, args, expected, tmp_path):
    result = subprocess.run(
        ["bash", str(SCRIPTS / name), *args, "--dry-run"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
    assert expected in "\n".join(" ".join(shlex.split(line)) for line in result.stdout.splitlines())
    assert not list(tmp_path.iterdir())


def test_bad_model_name_cannot_start_a_download(tmp_path):
    result = subprocess.run(
        ["bash", str(SCRIPTS / "download-models.sh"), "unknown", "--dry-run"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert "lockin-media download" not in result.stdout


def test_mock_compose_starts_without_library_download():
    if (
        not shutil.which("docker")
        or subprocess.run(["docker", "compose", "version"], capture_output=True).returncode
    ):
        pytest.skip("Docker Compose is unavailable")
    result = subprocess.run(
        ["docker", "compose", "--profile", "mock", "config", "--format", "json"],
        cwd=SCRIPTS.parent,
        capture_output=True,
        text=True,
        check=True,
        timeout=20,
    )
    services = json.loads(result.stdout)["services"]
    assert set(services) == {"mock"}
    assert not services["mock"].get("depends_on")
