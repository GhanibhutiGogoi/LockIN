"""Compose a local gameplay recording, score and word-aligned narration."""

import random
import re
import shutil
import subprocess
import textwrap
from pathlib import Path

from .audio import duration
from .storage import Store

HEADER = Path(__file__).with_name("caption-style.ass").read_text()


def check_ffmpeg():
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg or not shutil.which("ffprobe"):
        raise ValueError("Install FFmpeg and ffprobe on the workstation")

    missing = []
    for option, kind, required in (
        ("-filters", "filter", ("ass",)),
        ("-encoders", "encoder", ("libx264", "aac")),
    ):
        try:
            result = subprocess.run(
                [ffmpeg, "-hide_banner", option],
                check=True,
                capture_output=True,
                text=True,
                errors="replace",
                timeout=3,
            )
        except (OSError, subprocess.SubprocessError) as e:
            raise ValueError(f"Could not inspect FFmpeg {option} on the workstation") from e
        # The second column is the registered name. Descriptions and similarly
        # named alternatives such as libx264rgb cannot satisfy the renderer.
        names = {parts[1] for line in result.stdout.splitlines() if len(parts := line.split()) >= 2}
        missing.extend(f"{name} {kind}" for name in required if name not in names)
    if missing:
        raise ValueError("Install an FFmpeg build with the missing " + ", ".join(missing))


def stamp(seconds):
    c = round(100 * seconds)
    return f"{c // 360000}:{c // 6000 % 60:02}:{c // 100 % 60:02}.{c % 100:02}"


def write_captions(path, captions, speed, target):
    lines = [HEADER]
    group = []
    groups = []
    for i, cap in enumerate(captions):
        word = cap["word"]
        if group and (len(group) >= 3 or sum(len(w) for _, w in group) + len(word) > 15):
            groups.append(group)
            group = []
        group.append((i, word))
        if re.search(r"[.!?,]$", word):
            groups.append(group)
            group = []
    if group:
        groups.append(group)
    for group in groups:
        for i, _ in group:
            start = captions[i]["start"] / speed if i else 0
            end = captions[i + 1]["start"] / speed if i + 1 < len(captions) else target
            if stamp(end) == stamp(start):
                continue
            words = []
            for j, word in group:
                # Disallow ASS control syntax coming from the content provider.
                text = re.sub(r"[{}\\]", "", word.upper())
                color = r"{\1c&H65F2EE&}" if i == j else r"{\1c&HFFFFFF&}"
                words.append(color + text)
            lines.append(
                f"Dialogue: 0,{stamp(start)},{stamp(end)},Voice,,0,0,0,,"
                + r"{\pos(360,805)}"
                + " ".join(words)
                + "\n"
            )
    path.write_text("".join(lines))


def compose(store: Store, work: Path, request, captions, key):
    voice = work / "voice.mp3"
    natural = duration(voice)
    target = request.variant.target_seconds
    speed = max(0.85, min(1.35, natural / (target - 0.25)))
    speech_end = natural / speed
    seconds = max(target, round(speech_end + 0.25, 2))
    rng = random.Random(int(key, 16))
    videos = [v for v in store.starter("gameplay") if v["duration_sec"] >= seconds]
    tracks = store.starter("music")
    if not videos or not tracks:
        raise ValueError("Install the local gameplay and music libraries with download-library.sh")
    matches = [v for v in videos if request.variant.gameplay_type in [v["type"], *v["tags"]]]

    def select(entries, chosen_id):
        return next((item for item in entries if item["id"] == chosen_id), None) or rng.choice(
            entries
        )

    game = select(matches or videos, request.script.gameplay_id)
    track = select(tracks, request.script.music_id)
    start = rng.uniform(0, max(0, game["duration_sec"] - seconds))
    music_start = rng.uniform(0, max(0, track["duration_sec"] - seconds))
    subtitle = work / "captions.ass"
    write_captions(subtitle, captions, speed, speech_end)
    if seconds - speech_end >= 2:
        question = (
            request.script.quiz[0].question
            if request.script.quiz
            else "How would you explain this in one sentence?"
        )
        prompt = re.sub(r"[{}\\]", "", " ".join(question.split()))
        if len(prompt) > 155:
            prompt = "What was the main idea?"
        lines = r"\N".join(textwrap.wrap(prompt, width=22))
        with subtitle.open("a") as out:
            out.write(
                f"Dialogue: 0,{stamp(speech_end)},{stamp(seconds)},Voice,,0,0,0,,"
                + r"{\pos(360,700)\fs45}"
                + lines
                + "\n"
            )
    credits = " | ".join(
        f"{a['title']} by {a['creator']}, {a['source']}, {a['license']} {a['license_url']}"
        for a in (game, track)
    )
    mix = (
        f"[1:a]atempo={speed},loudnorm=I=-15:TP=-1.5:LRA=9,aresample=48000,"
        "aformat=channel_layouts=mono,pan=stereo|c0=c0|c1=c0,apad[v];"
        f"[2:a]loudnorm=I=-29:TP=-8:LRA=8,aresample=48000,afade=t=in:d=0.12,"
        f"afade=t=out:st={max(0, seconds - 0.65)}:d=0.65[m];"
        "[v][m]amix=inputs=2:normalize=0,alimiter=limit=0.9:latency=1[a]"
    )
    video = work / "video.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-ss",
            str(start),
            "-i",
            str(store.root / game["url"]),
            "-i",
            str(voice),
            "-stream_loop",
            "-1",
            "-ss",
            str(music_start),
            "-t",
            str(seconds),
            "-i",
            str(store.root / track["url"]),
            "-filter_complex_threads",
            "2",
            "-filter_complex",
            mix,
            "-map",
            "0:v:0",
            "-map",
            "[a]",
            "-vf",
            "fps=30,scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,ass=captions.ass",
            "-t",
            str(seconds),
            "-threads",
            "4",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "19",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-movflags",
            "+faststart",
            "-metadata",
            f"comment=Gameplay cropped, music excerpted and mixed, captions added. {credits}",
            str(video),
        ],
        cwd=work,
        check=True,
        timeout=240,
        capture_output=True,
    )
    for cap in captions:
        cap["start"] /= speed
        cap["end"] /= speed
    return {
        "duration_sec": duration(video),
        "captions": captions,
        "gameplay": game["title"],
        "music": track["title"],
        "bytes": video.stat().st_size,
    }
