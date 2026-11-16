import json
import subprocess
from pathlib import Path


def run_ffmpeg(arguments: list[str], timeout: float = 60) -> None:
    result = subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *arguments],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(f"FFmpeg failed: {result.stderr[-1500:]}")


def duration(path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        capture_output=True,
        text=True,
        timeout=15,
        check=True,
    )
    return float(json.loads(result.stdout)["format"]["duration"])


def pace_audio(source: Path, output: Path, pacing: float) -> None:
    # Time-stretch before alignment: the timestamps describe the delivered speed.
    run_ffmpeg(
        [
            "-i",
            str(source),
            "-vn",
            "-af",
            f"atempo={pacing}",
            "-ac",
            "1",
            "-ar",
            "24000",
            "-c:a",
            "pcm_s16le",
            str(output),
        ]
    )


def encode_soundtrack(voice: Path, output: Path, music: Path | None = None) -> None:
    args = ["-i", str(voice)]
    if music:
        if not music.is_file():
            raise ValueError(f"Music file does not exist: {music}")
        args += [
            "-stream_loop",
            "-1",
            "-i",
            str(music),
            "-filter_complex",
            "[0:a]asplit=2[voice][key];[1:a]volume=0.12[music];"
            "[music][key]sidechaincompress=threshold=0.02:ratio=8:"
            "attack=20:release=250[ducked];"
            "[voice][ducked]amix=inputs=2:duration=first:normalize=0,"
            "alimiter=limit=0.95:latency=1[out]",
            "-map",
            "[out]",
        ]
    else:
        args += ["-map", "0:a:0"]
    args += ["-c:a", "libmp3lame", "-b:a", "192k", "-write_xing", "1", str(output)]
    run_ffmpeg(args)
