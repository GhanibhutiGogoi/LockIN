import argparse
import json
import os
import tempfile
from pathlib import Path

from filelock import FileLock

from . import deployment
from .audio import duration
from .backends import HttpModels
from .prompts import REFERENCE_TEXT, VIDEO_PRESETS, VOICE_PROFILES, broll_prompt
from .schemas import MediaRequest, VideoSpec
from .service import MediaService
from .settings import Settings, model_lock
from .storage import Store, write_json
from .video import generate_video, publish_video


def parser():
    p = argparse.ArgumentParser(description="LockIn media: local API + isolated model runtimes")
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("doctor")
    serve = sub.add_parser("serve")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8011)
    render = sub.add_parser("render", help="Prewarm/cache a UI-format media request")
    render.add_argument("request", type=Path)
    setup = sub.add_parser("setup-runtime", help="Print install commands; --execute installs")
    setup.add_argument("kind", choices=["voice", "video", "aligner"])
    setup.add_argument("--root", type=Path, default=Path.cwd())
    setup.add_argument("--execute", action="store_true")
    download = sub.add_parser("download", help="Download pinned weights (large)")
    download.add_argument("kind", choices=["voice", "video", "aligner"])
    for kind, port in (("voice", 8021), ("aligner", 8022)):
        launch = sub.add_parser(f"serve-{kind}")
        launch.add_argument("--root", type=Path, default=Path.cwd())
        launch.add_argument("--port", type=int, default=port)
        launch.add_argument("--host", default="127.0.0.1")
        if kind == "voice":
            launch.add_argument("--devices", default="cuda:0,cuda:1,cuda:2,cuda:3")
    voice = sub.add_parser("create-voice", help="Generate a persistent synthetic reference voice")
    voice.add_argument("voice_id", choices=list(VOICE_PROFILES))
    voice.add_argument("--seed", type=int, default=42)
    video = sub.add_parser("generate-video", help="Plan a video job; --execute loads LTX")
    video.add_argument("--preset", choices=list(VIDEO_PRESETS), default="marble")
    video.add_argument("--prompt", help="Override preset, or provide a b-roll concept")
    video.add_argument("--term", help="Generate b-roll for this exact key term")
    video.add_argument("--seed", type=int, default=42)
    video.add_argument("--width", type=int, default=1280)
    video.add_argument("--height", type=int, default=1024)
    video.add_argument("--frames", type=int, default=121)
    video.add_argument("--energy", type=float, default=0.6)
    video.add_argument("--execute", action="store_true")
    publish = sub.add_parser("publish-video", help="Add a reviewed candidate to the UI library")
    publish.add_argument("id")
    return p


def create_voice(s, voice_id, seed):
    store = Store(s.data_dir)
    if s.mode != "real":
        raise ValueError("Set LOCKIN_MODE=real and start Fish before creating a voice")
    metadata = store.root / "voices" / f"{voice_id}.json"
    if metadata.exists():
        raise ValueError("Reference already exists; keep it stable or archive it before replacing")
    backend = HttpModels(s)
    try:
        with FileLock(store.root / "locks" / "narration.lock", timeout=s.queue_timeout):
            if metadata.exists():
                raise ValueError("Reference was created by another process; refusing to replace it")
            with tempfile.TemporaryDirectory(dir=store.root / "tmp") as temp:
                audio = Path(temp) / "reference.wav"
                backend.synthesize(REFERENCE_TEXT, voice_id, "mild", seed, None, audio)
                if not 2 <= duration(audio) <= 30:
                    raise ValueError("Reference must be 2–30 seconds; inspect this generation")
                target = store.root / "voices" / f"{voice_id}.wav"
                os.replace(audio, target)
                write_json(
                    metadata,
                    {
                        "file": target.name,
                        "text": REFERENCE_TEXT,
                        "seed": seed,
                        "synthetic": True,
                        "model": model_lock()["voice"],
                    },
                )
        return {"voice": voice_id, "audio": str(target), "next": "Listen before using in a study"}
    finally:
        backend.close()


def main():
    args, s = parser().parse_args(), Settings()
    if args.command == "serve":
        import uvicorn

        uvicorn.run(
            "lockin_media.api:create_app", factory=True, host=args.host, port=args.port, workers=1
        )
        return
    if args.command == "doctor":
        result = deployment.doctor()
    elif args.command == "setup-runtime":
        result = deployment.setup_runtime(args.kind, args.root, args.execute)
    elif args.command == "download":
        deployment.download(args.kind, s.model_root)
        result = {"downloaded": args.kind, "inference_tested": False}
    elif args.command == "serve-voice":
        deployment.launch_voice(args.root, s.model_root, args.devices, args.port, args.host)
        return
    elif args.command == "serve-aligner":
        deployment.launch_aligner(args.root, s.model_root, args.port, args.host)
        return
    elif args.command == "create-voice":
        result = create_voice(s, args.voice_id, args.seed)
    elif args.command == "render":
        service = MediaService(s)
        try:
            result = service.render(MediaRequest.model_validate_json(args.request.read_text()))
            result = result.model_dump(exclude_none=True)
        finally:
            service.close()
    elif args.command == "generate-video":
        if args.term and not args.prompt:
            raise ValueError("B-roll requires --prompt with the exact script broll_prompt")
        prompt = (
            broll_prompt(args.prompt) if args.term else (args.prompt or VIDEO_PRESETS[args.preset])
        )
        spec = VideoSpec(
            prompt=prompt,
            category="broll" if args.term else args.preset,
            term=args.term,
            seed=args.seed,
            width=args.width,
            height=args.height,
            frames=args.frames,
            energy=args.energy,
        )
        result = generate_video(
            s, spec, execute=args.execute, source_prompt=args.prompt if args.term else None
        )
    elif args.command == "publish-video":
        result = publish_video(s, args.id)
    else:
        raise AssertionError(args.command)
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
